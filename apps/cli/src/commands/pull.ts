import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { getPageSource } from '../core/client.js'
import { getToken } from '../core/store.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import type { PageSource } from '../core/types.js'

/** The file a pull writes when no -o is given: <id>.md for Markdown, else <id>.html. */
export function defaultFile(src: Pick<PageSource, 'id' | 'format'>): string {
  return `${src.id}.${src.format === 'markdown' ? 'md' : 'html'}`
}

/** The command that puts an edited copy back, with --deck when the page is a deck. */
export function updateHint(src: Pick<PageSource, 'id' | 'kind'>, file: string): string {
  return `aired update ${src.id} ${file}${src.kind === 'deck' ? ' --deck' : ''}`
}

export function makePullCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('pull')
    .description("Download a page's current source to edit and update it: the Markdown if it was published from Markdown, else the HTML")
    .argument('<id>', 'Page ID')
    .option('-o, --output <file>', 'Where to save it (default <id>.md or <id>.html; - prints it)')
    .option('-f, --force', 'Overwrite the file if it exists')
    .action(async (id: string, cmdOpts: { output?: string; force?: boolean }) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const token = getToken(id)
      const session = getSession()
      if (token === null && session === null && !apiKeyConfigured(opts)) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Only its owner can pull it: sign in with 'aired login', or run this where it was published ('aired tokens' lists the pages you have tokens for).` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      let src: PageSource
      try {
        src = await withSpinner('Downloading...', () => getPageSource(baseUrl, id, token ?? '', session?.jwt), opts)
      } catch (err) {
        const error = err as NodeJS.ErrnoException & Error
        if (error.code === 'RATE_LIMITED') {
          outputError({ code: 'RATE_LIMIT', message: error.message }, opts)
          process.exit(ExitCode.RATE_LIMITED)
        }
        outputError({ code: 'API', message: error.message }, opts)
        process.exit(ExitCode.API_ERROR)
      }

      if (cmdOpts.output === '-') {
        process.stdout.write(src.source.endsWith('\n') ? src.source : src.source + '\n')
        return
      }

      const file = cmdOpts.output ?? defaultFile(src)
      const path = resolve(file)
      if (existsSync(path) && cmdOpts.force !== true) {
        outputError({ code: 'VALIDATION', message: `${file} already exists. Pass --force to overwrite it, or -o <file> to save somewhere else.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      try {
        await writeFile(path, src.source, 'utf-8')
      } catch (err) {
        outputError({ code: 'VALIDATION', message: `Cannot write '${file}': ${(err as Error).message}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      const update = updateHint(src, file)
      if (shouldOutputJson(opts)) {
        process.stdout.write(
          JSON.stringify(
            {
              id: src.id,
              url: src.url,
              title: src.title,
              file: path,
              format: src.format,
              kind: src.kind,
              bytes: Buffer.byteLength(src.source, 'utf-8'),
              ...(src.version !== undefined ? { version: src.version } : {}),
              update,
            },
            null,
            2,
          ) + '\n',
        )
        return
      }
      const what = src.format === 'markdown' ? 'Markdown' : 'HTML'
      process.stdout.write(pc.green('Saved ') + pc.bold(file) + pc.dim(` (${what}${src.kind === 'deck' ? ', a deck with its speaker notes' : ''}${src.version !== undefined ? `, version ${src.version}` : ''})`) + '\n')
      process.stdout.write(pc.dim('Edit it, then put it back: ') + update + '\n')
      process.stdout.write(pc.dim('Anyone with the page open sees the new version within a few seconds.') + '\n')
    })
}
