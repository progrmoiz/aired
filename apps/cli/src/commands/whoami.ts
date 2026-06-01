import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson } from '../lib/output.js'
import { getSession, clearSession } from '../core/session.js'
import { validateSession } from '../core/client.js'

export function makeWhoamiCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('whoami')
    .description('Show the currently signed-in user')
    .action(async () => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const session = getSession()

      if (session === null) {
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ signedIn: false }, null, 2) + '\n')
        } else {
          process.stdout.write('Not signed in. Run `aired login`\n')
        }
        process.exit(0)
      }

      // Validate against the server — the local session may have been revoked.
      let serverUser: Awaited<ReturnType<typeof validateSession>>
      let offline = false
      try {
        serverUser = await validateSession(baseUrl, session.jwt)
      } catch {
        // Network or unexpected error — fall back to the cached session.
        serverUser = session.user
        offline = true
      }

      if (serverUser === null) {
        // Server rejected the token — the session is dead. Clear it.
        clearSession()
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ signedIn: false, expired: true }, null, 2) + '\n')
        } else {
          process.stdout.write('Session expired. Run `aired login`\n')
        }
        process.exit(0)
      }

      if (shouldOutputJson(opts)) {
        const output: Record<string, unknown> = {
          signedIn: true,
          login: serverUser.login,
          savedAt: session.savedAt,
        }
        if (offline) output['offline'] = true
        if (opts.verbose && serverUser.email !== null) {
          output['email'] = serverUser.email
        }
        process.stdout.write(JSON.stringify(output, null, 2) + '\n')
        return
      }

      process.stdout.write(`@${serverUser.login}\n`)

      if (offline) {
        process.stdout.write(pc.dim('(offline — showing cached session)') + '\n')
      }

      if (opts.verbose) {
        if (serverUser.email !== null) {
          process.stdout.write(pc.dim('Email:    ') + serverUser.email + '\n')
        }
        process.stdout.write(pc.dim('Saved at: ') + session.savedAt + '\n')
      }
    })
}
