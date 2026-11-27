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
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { inlineLocalImages, isMarkdownPath, type PageContent } from '../core/markdown.js'
import { contentLines } from '../lib/content-lines.js'

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Never (permanent)'
  const d = new Date(expiresAt)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function makeUpdateCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('update')
    .description('Update an existing page using the stored token')
    .argument('<id>', 'Page ID')
    .argument('<file>', 'Path to the new HTML or Markdown (.md) file')
    .option('-t, --title <title>', 'New title')
    .option('--deck', 'Show as slides: Markdown split on --- lines, or HTML <section> slides')
    .option('--markdown', 'Treat the file as Markdown (automatic for .md files)')
    .option('-m, --message <note>', "A short note kept with this version in the page's history")
    .action(async (id, file, cmdOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      // Precedence (R6): local update_token wins; fallback to session JWT
      const token = getToken(id)
      const session = getSession()

      if (token === null && session === null && !apiKeyConfigured(opts)) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      // Precedence: local token wins; fallback to JWT-only path
      const effectiveToken = token ?? ''
      const jwt = session?.jwt

      let html: string
      const markdown = cmdOpts.markdown === true || isMarkdownPath(file)
      try {
        html = await readFile(resolve(file), 'utf-8')
        if (markdown) html = inlineLocalImages(html, resolve(file))
      } catch (err) {
        outputError({ code: 'VALIDATION', message: `Cannot read file '${file}': ${(err as Error).message}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      try {
        const result = await withSpinner(
          'Updating...',
          () => {
            const deck = cmdOpts.deck === true
            const content: PageContent = markdown ? { markdown: html, ...(deck ? { deck } : {}) } : deck ? { html, deck } : { html }
            return updatePage(baseUrl, id, content, effectiveToken, { title: cmdOpts.title, message: cmdOpts.message }, jwt)
          },
          opts,
        )

        // The server returns a token only when it authorised the update with
        // one. An update through the signed-in session (for example with a
        // token a claim already retired) returns none: keep the record as is.
        if (typeof result.update_token === 'string') {
          saveToken(result.id, result.update_token, {
            title: cmdOpts.title ?? null,
            url: result.url,
          })
        }

        if (shouldOutputJson(opts)) {
          // Leave the token out: it's already stored, and --json output tends
          // to end up in agent transcripts.
          const { update_token: _token, ...shown } = result
          process.stdout.write(JSON.stringify(shown, null, 2) + '\n')
        } else {
          process.stdout.write(pc.green('Updated!') + ' ' + pc.bold(result.url) + '\n')
          process.stdout.write(pc.dim('Expires: ') + formatExpiry(result.expiresAt) + '\n')
          if (typeof result.version === 'number') {
            process.stdout.write(pc.dim('Version: ') + `${result.version} ` + pc.dim(`(the previous one is kept: aired versions ${id})`) + '\n')
          }
          for (const line of contentLines(result)) process.stdout.write(line + '\n')
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
