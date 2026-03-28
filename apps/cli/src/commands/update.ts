import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { updatePage } from '../core/client.js'
import { getToken, saveToken } from '../core/store.js'

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Never (permanent)'
  const d = new Date(expiresAt)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function makeUpdateCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('update')
    .description('Update an existing page using the stored token')
    .argument('<id>', 'Page ID')
    .argument('<file>', 'Path to new HTML file')
    .option('-t, --title <title>', 'New title')
    .action(async (id, file, cmdOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      const token = getToken(id)
      if (token === null) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      let html: string
      try {
        html = await readFile(resolve(file), 'utf-8')
      } catch (err) {
        outputError({ code: 'VALIDATION', message: `Cannot read file '${file}': ${(err as Error).message}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      try {
        const result = await withSpinner('Updating...', () => updatePage(baseUrl, id, html, token, { title: cmdOpts.title }), opts)

        saveToken(result.id, result.update_token, {
          title: cmdOpts.title ?? null,
          url: result.url,
        })

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        } else {
          process.stdout.write(pc.green('Updated!') + ' ' + pc.bold(result.url) + '\n')
          process.stdout.write(pc.dim('Expires: ') + formatExpiry(result.expiresAt) + '\n')
        }
      } catch (err) {
        const error = err as NodeJS.ErrnoException & Error
        if (error.code === 'RATE_LIMITED') {
          outputError({ code: 'RATE_LIMIT', message: error.message }, opts)
          process.exit(ExitCode.RATE_LIMITED)
        }
        outputError({ code: 'API', message: error.message }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
