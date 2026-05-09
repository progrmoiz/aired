import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { deletePage } from '../core/client.js'
import { getToken, removeToken } from '../core/store.js'
import { getSession } from '../core/session.js'

export function makeDeleteCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('delete')
    .description('Delete a page using the stored token')
    .argument('<id>', 'Page ID')
    .action(async (id) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      // Precedence (R6): local update_token wins; fallback to session JWT
      const token = getToken(id)
      const session = getSession()

      if (token === null && session === null) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      const effectiveToken = token ?? ''
      const jwt = session?.jwt

      try {
        await withSpinner('Deleting...', () => deletePage(baseUrl, id, effectiveToken, jwt), opts)
        removeToken(id)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ ok: true, id }, null, 2) + '\n')
        } else {
          process.stdout.write(pc.green('Deleted') + ` page ${pc.bold(id)}\n`)
        }
      } catch (err) {
        outputError({ code: 'API', message: (err as Error).message }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
