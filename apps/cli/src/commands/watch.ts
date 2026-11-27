import { watch as watchPath, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { outputError, ExitCode, shouldOutputJson } from '../lib/output.js'
import { publishHTML, updatePage } from '../core/client.js'
import { getToken, saveToken } from '../core/store.js'
import { getSession } from '../core/session.js'
import { isDirectory, bundleDirectory } from '../core/bundler.js'
import { detectProject } from '../core/project.js'
import { inlineLocalImages, isMarkdownPath, type PageContent } from '../core/markdown.js'

/** How long a file has to stay unchanged before it's sent: editors write in bursts. */
const SETTLE_MS = 400

/** Paths a folder watch ignores: version control, dependencies, editor swap files. */
export function ignoredPath(rel: string): boolean {
  const parts = rel.split(/[\\/]/)
  if (parts.some((p) => p === '.git' || p === 'node_modules' || p === '.DS_Store')) return true
  const name = parts[parts.length - 1] ?? ''
  return name.endsWith('~') || name.endsWith('.swp') || name.endsWith('.swx') || name.startsWith('.#') || name === '4913'
}

function stamp(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function makeWatchCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('watch')
    .description('Publish a file or folder, then update the page every time you save it. Open tabs reload by themselves')
    .argument('<path>', 'An HTML or Markdown (.md) file, or a folder')
    .option('--id <id>', 'Update this existing page instead of publishing a new one')
    .option('-t, --title <title>', 'Title')
    .option('--deck', 'Show as slides: Markdown split on --- lines, or HTML <section> slides')
    .option('--markdown', 'Treat the file as Markdown (automatic for .md files)')
    .action(async (target: string, cmdOpts: { id?: string; title?: string; deck?: boolean; markdown?: boolean }) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const path = resolve(target)
      const dir = await isDirectory(path)
      const markdown = !dir && (cmdOpts.markdown === true || isMarkdownPath(path))
      const jwt = getSession()?.jwt
      const quiet = shouldOutputJson(opts)
      const say = (line: string) => {
        if (!quiet) process.stderr.write(line + '\n')
      }
      const event = (e: Record<string, unknown>) => {
        if (quiet) process.stdout.write(JSON.stringify(e) + '\n')
      }

      const read = async (): Promise<PageContent> => {
        if (dir) {
          const html = await bundleDirectory(path)
          return cmdOpts.deck === true ? { html, deck: true } : { html }
        }
        let text = await readFile(path, 'utf-8')
        if (markdown) {
          text = inlineLocalImages(text, path)
          return { markdown: text, ...(cmdOpts.deck === true ? { deck: true } : {}) }
        }
        return cmdOpts.deck === true ? { html: text, deck: true } : { html: text }
      }

      let id = cmdOpts.id
      let last: string
      try {
        const content = await read()
        last = JSON.stringify(content)
        if (id === undefined) {
          const project = detectProject(process.cwd())
          const result = await publishHTML(baseUrl, content, { ...(cmdOpts.title !== undefined ? { title: cmdOpts.title } : {}), ...(project !== null ? { project } : {}) }, jwt)
          saveToken(result.id, result.update_token, { title: cmdOpts.title ?? null, url: result.url })
          id = result.id
          say(pc.green('Published ') + pc.bold(result.url))
          event({ event: 'published', id: result.id, url: result.url, version: result.version ?? null })
        } else {
          if (getToken(id) === null && jwt === undefined && process.env['AIRED_API_KEY'] === undefined) {
            outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Sign in with 'aired login', or watch without --id to publish a new page.` }, opts)
            process.exit(ExitCode.VALIDATION_ERROR)
          }
          const result = await updatePage(baseUrl, id, content, getToken(id) ?? '', { ...(cmdOpts.title !== undefined ? { title: cmdOpts.title } : {}) }, jwt)
          say(pc.green('Updated ') + pc.bold(result.url) + (result.version !== undefined ? pc.dim(` v${result.version}`) : ''))
          event({ event: 'updated', id, url: result.url, version: result.version ?? null })
        }
      } catch (err) {
        outputError({ code: 'API', message: (err as Error).message }, opts)
        process.exit(ExitCode.API_ERROR)
      }
      const pageId = id

      say(pc.dim(`Watching ${dir ? `${basename(path)}/` : basename(path)}. Every save updates the page (each one is kept as a version). Ctrl-C to stop.`))

      let timer: NodeJS.Timeout | null = null
      let sending = false
      let again = false
      const send = async () => {
        if (sending) {
          again = true
          return
        }
        sending = true
        try {
          const content = await read()
          const now = JSON.stringify(content)
          if (now === last) return
          const result = await updatePage(baseUrl, pageId, content, getToken(pageId) ?? '', {}, jwt)
          last = now
          say(pc.dim(stamp()) + ' ' + pc.green('Updated') + (result.version !== undefined ? pc.dim(` v${result.version}`) : ''))
          event({ event: 'updated', id: pageId, url: result.url, version: result.version ?? null })
        } catch (err) {
          // A half-written file or a blip: say so and keep watching.
          say(pc.dim(stamp()) + ' ' + pc.red(`Not updated: ${(err as Error).message}`))
          event({ event: 'error', id: pageId, message: (err as Error).message })
        } finally {
          sending = false
          if (again) {
            again = false
            schedule()
          }
        }
      }
      const schedule = () => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void send()
        }, SETTLE_MS)
      }

      let watcher: FSWatcher
      try {
        // A file is watched through its folder: many editors save by writing
        // a new file and renaming it over the old one, which ends a watch on
        // the file itself.
        watcher = dir
          ? watchPath(path, { recursive: true }, (_type, name) => {
              if (typeof name === 'string' && ignoredPath(name)) return
              schedule()
            })
          : watchPath(dirname(path), (_type, name) => {
              if (name === null || name === basename(path)) schedule()
            })
      } catch (err) {
        outputError({ code: 'VALIDATION', message: `Cannot watch '${target}': ${(err as Error).message}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      const stop = () => {
        watcher.close()
        say(pc.dim('Stopped watching.'))
        process.exit(ExitCode.SUCCESS)
      }
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
    })
}
