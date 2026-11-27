import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { setPageOptions } from '../core/client.js'
import { getToken, getRecord, saveToken } from '../core/store.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { parseTtl } from '../lib/duration.js'
import { printPageDetails } from '../lib/page-details.js'
import { accessFromOnly } from '../lib/access-flags.js'

interface SetOpts {
  title?: string
  clearTitle?: boolean
  pin?: string
  clearPin?: boolean
  ttl?: string
  permanent?: boolean
  reads?: string
  clearReads?: boolean
  only?: string
  public?: boolean
}


/**
 * The PATCH body for the flags given, or an error message. Bounds are
 * checked again (and decided) by the server.
 */
export function changeFromFlags(o: SetOpts): { change: Record<string, unknown> } | { error: string } {
  const change: Record<string, unknown> = {}
  if (o.title !== undefined && o.clearTitle) return { error: 'Use --title or --clear-title, not both.' }
  if (o.pin !== undefined && o.clearPin) return { error: 'Use --pin or --clear-pin, not both.' }
  if (o.reads !== undefined && o.clearReads) return { error: 'Use --reads or --clear-reads, not both.' }
  if (o.ttl !== undefined && o.permanent) return { error: 'Use --ttl or --permanent, not both.' }
  if (o.only !== undefined && o.public) return { error: 'Use --only or --public, not both.' }
  if ((o.only !== undefined || o.public) && (o.pin !== undefined || o.clearPin)) {
    return { error: '--only and --public replace the PIN. Use them without --pin or --clear-pin.' }
  }
  if (o.title !== undefined) change['title'] = o.title
  if (o.clearTitle) change['title'] = null
  if (o.pin !== undefined) change['pin'] = o.pin
  if (o.clearPin) change['pin'] = null
  if (o.ttl !== undefined) {
    const seconds = parseTtl(o.ttl)
    if (seconds === null) return { error: `Invalid --ttl '${o.ttl}'. Use a number of seconds, or 30m, 24h, 7d.` }
    change['ttl'] = seconds
  }
  if (o.permanent) change['permanent'] = true
  if (o.reads !== undefined) {
    const n = Number(o.reads)
    if (!Number.isInteger(n) || n < 1) return { error: `Invalid --reads '${o.reads}'. Use a whole number, 1 or more.` }
    change['reads'] = n
  }
  if (o.clearReads) change['reads'] = null
  if (o.only !== undefined) {
    const parsed = accessFromOnly(o.only)
    if ('error' in parsed) return parsed
    change['access'] = parsed.access
  }
  if (o.public) change['access'] = { mode: 'public' }
  if (Object.keys(change).length === 0) {
    return { error: 'Nothing to change. Pass --title, --pin, --clear-pin, --only, --public, --ttl, --permanent, --reads or --clear-reads.' }
  }
  return { change }
}

export function makeSetCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('set')
    .description("Change who can open a page, its expiry, view limit or title without re-uploading it")
    .argument('<id>', 'Page ID')
    .option('-t, --title <title>', 'New title')
    .option('--clear-title', 'Remove the title')
    .option('-p, --pin <pin>', 'Set or change the PIN (4 to 64 characters)')
    .option('--clear-pin', 'Remove the PIN')
    .option('--only <people>', 'Only these people can open it: emails and @domains, comma-separated. Each gets a code by email. Replaces the list')
    .option('--public', 'Anyone with the link can open it (removes the PIN and the list)')
    .option('--ttl <duration>', 'Expire this long from now: 30m, 24h, 7d (up to a year)')
    .option('--permanent', 'Never expire')
    .option('--reads <n>', 'Gone after this many views')
    .option('--clear-reads', 'Remove the view limit')
    .action(async (id: string, cmdOpts: SetOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      const parsed = changeFromFlags(cmdOpts)
      if ('error' in parsed) {
        outputError({ code: 'VALIDATION', message: parsed.error }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      // As update and delete: a stored update token wins; else the session or API key must own the page.
      // Who can open it (--only, --public) is for the signed-in owner only.
      const changesAccess = 'access' in parsed.change
      const token = getToken(id)
      const session = getSession()
      if (changesAccess && session === null && !apiKeyConfigured(opts)) {
        outputError({ code: 'VALIDATION', message: "Changing who can open a page needs sign-in. Run 'aired login' first." }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      if (token === null && session === null && !apiKeyConfigured(opts)) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens, or sign in with 'aired login'.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      try {
        const page = await withSpinner('Saving...', () => setPageOptions(baseUrl, id, parsed.change, token ?? '', session?.jwt), opts)
        // Keep the stored record's title in step.
        const record = getRecord(id)
        if (record !== null && 'title' in parsed.change) saveToken(id, record.token, { title: page.title, url: record.url })

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(page, null, 2) + '\n')
        } else {
          const what = page.changed && page.changed.length > 0 ? page.changed.join(', ') : 'nothing'
          process.stdout.write(pc.green('Changed ') + what + '\n')
          printPageDetails(page)
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
