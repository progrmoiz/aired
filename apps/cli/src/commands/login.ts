import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Command } from 'commander'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import type { AuthTokenResult } from '../core/client.js'
import { cliExchangeCode, requestDeviceCode, pollDeviceToken } from '../core/client.js'
import { saveSession } from '../core/session.js'

// Use node:crypto directly since the CLI supports Node 20+ and crypto global is available,
// but using randomUUID from node:crypto is more explicit and avoids any global resolution issues.
function generateState(): string {
  return randomUUID()
}

function openBrowser(url: string): void {
  const platform = process.platform
  let cmd: string

  if (platform === 'darwin') {
    cmd = `open "${url}"`
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`
  } else {
    cmd = `xdg-open "${url}"`
  }

  exec(cmd, (err) => {
    if (err) {
      process.stderr.write(`Could not open browser. Please open this URL manually:\n${url}\n`)
    }
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

async function browserFlow(baseUrl: string): Promise<void> {
  const state = generateState()
  const MIN_PORT = 49152
  const MAX_PORT = 65535

  let port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT
  let attempts = 0
  const maxAttempts = 3

  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    const tryListen = () => {
      server.listen(port, '127.0.0.1', () => {
        resolve()
      })

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts - 1) {
          attempts++
          port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT
          server.removeAllListeners('error')
          tryListen()
        } else {
          reject(err)
        }
      })
    }
    tryListen()
  }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write("Could not bind localhost listener. Run 'aired login --device' instead.\n")
      process.exit(1)
    }
    throw err
  })

  const callbackUrl = `${baseUrl}/auth/cli?port=${port}&state=${encodeURIComponent(state)}`
  process.stderr.write(`\nTo sign in, open this URL in your browser:\n\n  ${callbackUrl}\n\nAttempting to open it in your default browser...\n\n`)
  openBrowser(callbackUrl)

  const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  const timeoutHandle = setTimeout(() => {
    server.close()
    process.stderr.write('Login timed out. Try again.\n')
    process.exit(1)
  }, TIMEOUT_MS)

  await new Promise<void>((resolve, reject) => {
    server.on('request', (req, res) => {
      // Validate Host header to prevent DNS rebinding
      const host = req.headers['host'] ?? ''
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Bad Request')
        return
      }

      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

      // Ignore favicon and other non-callback requests
      if (reqUrl.pathname !== '/' && reqUrl.pathname !== '') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
        return
      }

      const code = reqUrl.searchParams.get('code') ?? ''
      const receivedState = reqUrl.searchParams.get('state') ?? ''

      // No code parameter — probably a stray request, ignore and keep listening
      if (code === '' && receivedState === '') {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing parameters')
        return
      }

      if (!timingSafeEqual(receivedState, state)) {
        // State mismatch — likely a stale browser tab from a previous login
        // attempt. Reject this callback but keep listening for the correct one.
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid state. This is likely a stale browser tab. Close it and try again.')
        process.stderr.write('Ignored callback with mismatched state (likely a stale tab). Still waiting for the correct callback.\n')
        return
      }

      // Respond with friendly HTML
      const html = `<!DOCTYPE html>
<html><head><title>aired</title></head>
<body style="font-family:sans-serif;text-align:center;padding:4rem;">
<h2>You can close this tab. The CLI is finishing up.</h2>
</body></html>`
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)

      clearTimeout(timeoutHandle)
      server.close()

      // Exchange code for token
      cliExchangeCode(baseUrl, code, state)
        .then((result) => {
          saveSession(result.jwt, result.user)
          process.stdout.write(`Logged in as @${result.user.login}\n`)
          resolve()
        })
        .catch((err: Error) => {
          process.stderr.write(`Login failed: ${err.message}\n`)
          reject(err)
        })
    })
  })
}

async function deviceFlow(baseUrl: string): Promise<void> {
  let deviceInfo: Awaited<ReturnType<typeof requestDeviceCode>>
  try {
    deviceInfo = await requestDeviceCode(baseUrl)
  } catch (err) {
    process.stderr.write(`Failed to start device login: ${(err as Error).message}\n`)
    process.exit(1)
  }

  const { user_code, verification_uri, interval, device_code } = deviceInfo
  process.stderr.write(`Open ${verification_uri} and enter code: ${user_code}\n`)

  const pollInterval = Math.max(interval, 2)
  const TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
  const deadline = Date.now() + TIMEOUT_MS

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  while (Date.now() < deadline) {
    await wait(pollInterval * 1000)

    const result = await pollDeviceToken(baseUrl, device_code)

    if (result.status === 200) {
      const data = result.data as AuthTokenResult
      saveSession(data.jwt, data.user)
      process.stdout.write(`Logged in as @${data.user.login}\n`)
      return
    }

    if (result.status === 202) {
      // Still pending, keep polling
      continue
    }

    // Error cases
    const errorData = result.data as { error: string } | null
    const errorCode = errorData?.error ?? ''

    if (errorCode === 'max_attempts') {
      process.stderr.write('Too many attempts. Please try again.\n')
      process.exit(1)
    }

    if (errorCode === 'device_code_expired') {
      process.stderr.write('Device code expired. Please run `aired login --device` again.\n')
      process.exit(1)
    }

    process.stderr.write(`Login failed: ${errorCode || `HTTP ${result.status}`}\n`)
    process.exit(1)
  }

  process.stderr.write('Device login timed out. Please try again.\n')
  process.exit(1)
}

export function makeLoginCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('login')
    .description('Sign in to your aired account')
    .option('--device', 'Use device code flow instead of browser')
    .action(async (cmdOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      if (cmdOpts.device === true) {
        await deviceFlow(baseUrl)
      } else {
        await browserFlow(baseUrl)
      }
    })
}
