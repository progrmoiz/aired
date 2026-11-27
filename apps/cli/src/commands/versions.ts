import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { listVersions, restoreVersion, type PageVersionInfo } from '../core/client.js'
import { getToken } from '../core/store.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { renderTable } from '../lib/table.js'

/** The stored token and session for a page, or exit when there's neither (as set and check do). */
function credentials(id: string, opts: GlobalOpts): { token: string; jwt?: string } {
  const token = getToken(id)
  const session = getSession()
  if (token === null && session === null && !apiKeyConfigured(opts)) {
    outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens, or sign in with 'aired login'.` }, opts)
    process.exit(ExitCode.VALIDATION_ERROR)
  }
  return { token: token ?? '', ...(session !== null ? { jwt: session.jwt } : {}) }
}

function fail(err: unknown, opts: GlobalOpts): never {
  const error = err as NodeJS.ErrnoException & Error
  if (error.code === 'RATE_LIMITED') {
    outputError({ code: 'RATE_LIMIT', message: error.message }, opts)
    process.exit(ExitCode.RATE_LIMITED)
  }
  outputError({ code: 'API', message: error.message }, opts)
  process.exit(ExitCode.API_ERROR)
}

/** "3 Nov, 14:05", or "before history" for content published before versions were kept. */
function when(iso: string | null): string {
  if (iso === null) return 'before history'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function who(v: PageVersionInfo): string {
  if (v.actor === 'unknown') return ''
  return v.client !== null ? `${v.actor} (${v.client})` : v.actor
}

/** One table row per version, the live one marked. */
export function versionRows(versions: PageVersionInfo[]): Record<string, string>[] {
  return versions.map((v) => ({
    version: `${v.version}${v.current ? ' live' : ''}`,
    when: when(v.created_at),
    by: who(v),
    size: v.size >= 1024 ? `${Math.round(v.size / 1024)} KB` : `${v.size} B`,
    note: [v.restored_from !== null ? `restored from ${v.restored_from}` : '', v.message ?? '', v.message === null && v.title !== null ? v.title : '']
      .filter((s) => s !== '')
      .join(' · '),
  }))
}

export function makeVersionsCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('versions')
    .description("List a page's history: every version kept, newest first")
    .argument('<id>', 'Page ID')
    .action(async (id: string) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const { token, jwt } = credentials(id, opts)
      try {
        const result = await withSpinner('Loading...', () => listVersions(baseUrl, id, token, jwt), opts)
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }
        process.stdout.write(pc.bold(result.url) + '\n\n')
        process.stdout.write(
          renderTable(versionRows(result.versions), [
            { key: 'version', header: 'Version' },
            { key: 'when', header: 'Published' },
            { key: 'by', header: 'By' },
            { key: 'size', header: 'Size' },
            { key: 'note', header: 'Note' },
          ]) + '\n\n',
        )
        process.stdout.write(pc.dim(result.kept.summary) + '\n')
        const older = result.versions.find((v) => !v.current)
        if (older !== undefined) process.stdout.write(pc.dim(`Put one back: aired restore ${id} ${older.version}`) + '\n')
      } catch (err) {
        fail(err, opts)
      }
    })
}

export function makeRestoreCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('restore')
    .description('Put an earlier version of a page back. It goes live as a new version, so this can be undone the same way')
    .argument('<id>', 'Page ID')
    .argument('<version>', "Version number, from 'aired versions'")
    .option('-m, --message <note>', "A short note kept with this version in the page's history")
    .action(async (id: string, version: string, cmdOpts: { message?: string }) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const n = Number(version)
      if (!Number.isInteger(n) || n < 1) {
        outputError({ code: 'VALIDATION', message: `Invalid version '${version}'. Use a number from 'aired versions ${id}'.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      const { token, jwt } = credentials(id, opts)
      try {
        const result = await withSpinner('Restoring...', () => restoreVersion(baseUrl, id, n, { token, ...(jwt !== undefined ? { jwt } : {}), message: cmdOpts.message }), opts)
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
          return
        }
        process.stdout.write(pc.green('Restored ') + `version ${result.restored_from}` + (result.version !== null ? ` as version ${result.version}` : '') + ' ' + pc.bold(result.url) + '\n')
        process.stdout.write(pc.dim(`The version it replaced is kept. Undo: aired restore ${id} ${result.version !== null ? result.version - 1 : '<version>'}`) + '\n')
      } catch (err) {
        fail(err, opts)
      }
    })
}
