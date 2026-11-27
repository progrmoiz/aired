import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { renderTable } from '../lib/table.js'
import { getPageDetails, listOwnPages } from '../core/client.js'
import { listTokens } from '../core/store.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'

/** One page as `aired list` shows it, and as --json prints it. */
export interface ListedPage {
  id: string
  title: string | null
  url: string
  updated_at: string | null
  views: number | null
  project: string | null
  access: 'public' | 'pin' | 'people' | null
  expires_at: string | null
  /** Signed out: the stored token no longer opens the page (deleted, expired or claimed away). */
  gone?: boolean
}

const MAX_LIMIT = 1000
/** The API lists at most 50 a call. */
const PAGE_SIZE = 50
/** Detail lookups at once when listing from stored tokens. */
const AT_ONCE = 6

/** "3 Nov 2026, 14:05", or "" when unknown. */
function when(iso: string | null): string {
  if (iso === null) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** The signed-in account's pages, following the API's cursor until `limit`. */
async function accountPages(baseUrl: string, jwt: string | undefined, project: string | undefined, limit: number): Promise<{ pages: ListedPage[]; more: boolean }> {
  const pages: ListedPage[] = []
  let cursor: string | undefined
  for (;;) {
    const res = await listOwnPages(baseUrl, { jwt, project, limit: Math.min(PAGE_SIZE, limit - pages.length), cursor })
    for (const p of res.pages) {
      pages.push({
        id: p.id,
        title: p.title,
        url: `${baseUrl}/p/${p.id}`,
        updated_at: p.updatedAt ?? p.createdAt,
        views: p.readCount,
        project: p.project,
        access: p.access ?? (p.hasPin ? 'pin' : 'public'),
        expires_at: p.expiresAt,
      })
    }
    if (res.cursor === null || res.pages.length === 0) return { pages, more: false }
    if (pages.length >= limit) return { pages, more: true }
    cursor = res.cursor
  }
}

/** Signed out: the pages this machine holds update tokens for, with what their tokens can read. */
async function tokenPages(baseUrl: string, project: string | undefined, limit: number): Promise<{ pages: ListedPage[]; more: boolean }> {
  const tokens = listTokens().sort((a, b) => b.created.localeCompare(a.created))
  const out: ListedPage[] = new Array(tokens.length)
  let next = 0
  const worker = async () => {
    while (next < tokens.length) {
      const i = next++
      const t = tokens[i]!
      try {
        const d = await getPageDetails(baseUrl, t.id, t.token)
        out[i] = {
          id: d.id,
          title: d.title,
          url: d.url,
          updated_at: d.updatedAt ?? d.createdAt,
          views: d.readCount,
          project: d.project,
          access: d.access ?? (d.hasPin ? 'pin' : 'public'),
          expires_at: d.expiresAt,
        }
      } catch (err) {
        const status = (err as { status?: number }).status
        const gone = status === 401 || status === 403 || status === 404
        out[i] = { id: t.id, title: t.title, url: t.url, updated_at: t.created, views: null, project: null, access: null, expires_at: null, ...(gone ? { gone: true } : {}) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, tokens.length) }, worker))
  const wanted = project === undefined ? out : out.filter((p) => p.project === project)
  return { pages: wanted.slice(0, limit), more: wanted.length > limit }
}

export function makeListCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('list')
    .alias('ls')
    .description('List your pages: id, title, link, last update and views (signed out: the pages you have tokens for)')
    .option('-p, --project <name>', 'Only pages in this project')
    .option('-n, --limit <n>', 'How many pages to show, at most 1000', '20')
    .action(async (cmdOpts: { project?: string; limit: string }) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const limit = Number(cmdOpts.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        outputError({ code: 'VALIDATION', message: `--limit must be a whole number from 1 to ${MAX_LIMIT}.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      const session = getSession()
      const signedIn = session !== null || apiKeyConfigured(opts)
      try {
        const { pages, more } = await withSpinner(
          'Loading...',
          () => (signedIn ? accountPages(baseUrl, session?.jwt, cmdOpts.project, limit) : tokenPages(baseUrl, cmdOpts.project, limit)),
          opts,
        )
        const source = signedIn ? 'account' : 'tokens'
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ source, pages, more }, null, 2) + '\n')
          return
        }
        if (pages.length === 0) {
          const none = cmdOpts.project !== undefined ? `No pages in project '${cmdOpts.project}'.` : signedIn ? 'No pages yet. Publish one: aired page.html' : 'No pages on this machine yet. Publish one (aired page.html), or sign in (aired login) to list your account.'
          process.stdout.write(none + '\n')
          return
        }
        const rows = pages.map((p) => ({
          id: p.id,
          title: p.gone === true ? pc.dim('(gone)') : p.title ?? pc.dim('(untitled)'),
          updated: when(p.updated_at),
          views: p.views === null ? '' : String(p.views),
          url: p.url,
        }))
        process.stdout.write(
          renderTable(rows, [
            { key: 'id', header: 'ID' },
            { key: 'title', header: 'Title' },
            { key: 'updated', header: 'Updated' },
            { key: 'views', header: 'Views' },
            { key: 'url', header: 'URL' },
          ]) + '\n',
        )
        if (more) process.stdout.write(pc.dim(`More pages: aired list --limit ${Math.min(limit * 2, MAX_LIMIT)}`) + '\n')
        if (!signedIn) process.stdout.write(pc.dim('Pages from tokens on this machine. Sign in (aired login) to list your account.') + '\n')
        process.stdout.write(pc.dim('Edit one: aired pull <id>, change it, then aired update <id> <file>') + '\n')
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
