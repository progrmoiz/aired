import { Command, InvalidArgumentError } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { getPage, getSlideStats, type SlideStats } from '../core/client.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { renderTable } from '../lib/table.js'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Never (permanent)'
  const d = new Date(expiresAt)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function parseDays(v: string): number {
  if (v !== '7' && v !== '30' && v !== '90') throw new InvalidArgumentError('Use 7, 30 or 90.')
  return Number(v)
}

/** "8s", "1m 20s". */
function seconds(s: number | null): string {
  if (s === null) return '-'
  const r = Math.round(s)
  return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m${r % 60 ? ` ${r % 60}s` : ''}`
}

/** A deck's per-slide numbers as lines for the terminal. */
export function slideLines(st: SlideStats): string {
  if (st.viewers === 0) return `Nobody has gone through this deck in the last ${st.days} days. A slide counts once someone keeps it on screen for a second; your own views don't count.\n`
  const pct = Math.round((st.finished / st.viewers) * 100)
  const out = [pc.bold(`Slides, last ${st.days} days`) + pc.dim(`  (${st.from} to ${st.to}, UTC)`), `${st.viewers} started, ${st.finished} reached the end (${pct}%)`]
  if (st.biggest_drop !== null) out.push(`Most people stopped after slide ${st.biggest_drop}`)
  out.push('')
  out.push(
    renderTable(
      st.slides.map((s) => ({
        slide: String(s.slide),
        title: (s.title ?? '').slice(0, 40),
        reached: String(s.reached),
        typical: seconds(s.median_seconds),
        stopped: s.drop_off ? String(s.drop_off) + (s.slide === st.biggest_drop ? ' <' : '') : '',
      })),
      [
        { key: 'slide', header: '#' },
        { key: 'title', header: 'Title' },
        { key: 'reached', header: 'Reached' },
        { key: 'typical', header: 'Typical' },
        { key: 'stopped', header: 'Stopped here' },
      ],
    ),
  )
  return out.join('\n') + '\n'
}

export function makeInfoCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('info')
    .description('Show page metadata (title, size, reads, expiry); --slides adds how far people get through your deck (Pro)')
    .argument('<id>', 'Page ID')
    .option('--slides', "For your own deck: per slide, how many people reached it, the typical time on it and where they stopped (Pro; needs 'aired login' or AIRED_API_KEY)")
    .option('--days <n>', 'With --slides: 7, 30 or 90 days (default 30)', parseDays, 30)
    .action(async (id: string, cmdOpts: { slides?: boolean; days: number }) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      if (cmdOpts.slides === true) {
        const session = getSession()
        if (session === null && !apiKeyConfigured(opts)) {
          outputError({ code: 'VALIDATION', message: "Per-slide numbers are for your own decks. Sign in with 'aired login' (or set AIRED_API_KEY) first." }, opts)
          process.exit(ExitCode.VALIDATION_ERROR)
        }
        try {
          const st = await withSpinner('Fetching...', () => getSlideStats(baseUrl, id, cmdOpts.days, session?.jwt), opts)
          process.stdout.write(shouldOutputJson(opts) ? JSON.stringify(st, null, 2) + '\n' : '\n' + slideLines(st))
        } catch (err) {
          const e = err as Error & { apiCode?: string | null }
          const message = e.apiCode === 'plan_limit' ? `${e.message} See ${baseUrl}/pricing?ref=cli-slides` : e.message
          outputError({ code: 'API', message }, opts)
          process.exit(ExitCode.API_ERROR)
        }
        return
      }

      try {
        const page = await withSpinner('Fetching...', () => getPage(baseUrl, id), opts)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(page, null, 2) + '\n')
        } else {
          const url = `${baseUrl}/p/${id}`
          process.stdout.write('\n')
          process.stdout.write(pc.dim('ID:      ') + pc.bold(page.id) + '\n')
          // A PIN page's title and views stay hidden from public metadata;
          // its owner sees them in the dashboard or with the get_page tool.
          const hidden = page.pinProtected === true || page.restricted === true
          const why = page.restricted === true ? '(hidden: private page)' : '(hidden: PIN-protected)'
          process.stdout.write(pc.dim('Title:   ') + (hidden ? pc.dim(why) : page.title ?? '(untitled)') + '\n')
          process.stdout.write(pc.dim('URL:     ') + url + '\n')
          process.stdout.write(pc.dim('Size:    ') + formatSize(page.size) + '\n')
          process.stdout.write(pc.dim('Reads:   ') + (hidden ? pc.dim(why) : String(page.readCount)) + '\n')
          process.stdout.write(pc.dim('Expires: ') + formatExpiry(page.expiresAt) + '\n')
        }
      } catch (err) {
        outputError({ code: 'API', message: (err as Error).message }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
