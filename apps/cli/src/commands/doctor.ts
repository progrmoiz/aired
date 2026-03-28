import { Command } from 'commander'
import pc from 'picocolors'
import * as fs from 'node:fs'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson } from '../lib/output.js'
import { VERSION } from '../lib/constants.js'
import { checkConnectivity } from '../core/client.js'
import { getStorePath, listTokens } from '../core/store.js'

export function makeDoctorCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('doctor')
    .description('Run diagnostic checks')
    .action(async () => {
      const opts = globalOpts()
      const json = shouldOutputJson(opts)
      const checks: Array<{ name: string; status: string; message: string }> = []

      // Check 1: CLI version
      checks.push({ name: 'CLI Version', status: 'pass', message: `v${VERSION}` })

      // Check 2: Node.js version
      const major = parseInt(process.version.slice(1), 10)
      checks.push({
        name: 'Node.js',
        status: major >= 20 ? 'pass' : 'fail',
        message: process.version,
      })

      // Check 3: Token store
      const storePath = getStorePath()
      let storeExists = false
      try {
        fs.accessSync(storePath, fs.constants.R_OK)
        storeExists = true
      } catch {
        // doesn't exist yet, that's fine
      }
      const tokenCount = storeExists ? listTokens().length : 0
      checks.push({
        name: 'Token Store',
        status: 'pass',
        message: storeExists
          ? `${tokenCount} token${tokenCount === 1 ? '' : 's'} at ${storePath}`
          : 'Not created yet (publish a page first)',
      })

      // Check 4: API connectivity
      const baseUrl = resolveApiUrl(opts)
      let connected = false
      try {
        connected = await checkConnectivity(baseUrl)
      } catch {
        // network error
      }
      checks.push({
        name: 'API',
        status: connected ? 'pass' : 'fail',
        message: connected ? baseUrl : `Cannot reach ${baseUrl}`,
      })

      if (json) {
        process.stdout.write(
          JSON.stringify({ ok: checks.every((c) => c.status === 'pass'), checks }, null, 2) + '\n',
        )
      } else {
        for (const c of checks) {
          const icon = c.status === 'pass' ? pc.green('✓') : pc.red('✗')
          process.stderr.write(`${icon} ${c.name}: ${c.message}\n`)
        }
      }
    })
}
