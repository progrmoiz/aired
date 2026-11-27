import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { checkPage } from '../core/client.js'
import { getToken } from '../core/store.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { USER_AGENT } from '../lib/constants.js'
import type { CheckReport } from '../core/types.js'

interface CheckOpts {
  mobile?: boolean
  strict?: boolean
  screenshot?: string
}

/**
 * Exit codes: 0 works, 1 the page is broken (or has warnings, with --strict),
 * 2 bad input or no access to the page, 3 the check didn't run (rate limit,
 * daily budget, browser busy): try again later. 1 means only "broken".
 */
export function checkExitCode(report: Pick<CheckReport, 'ok' | 'issues'>, strict: boolean): number {
  if (!report.ok) return ExitCode.API_ERROR
  if (strict && report.issues.length > 0) return ExitCode.API_ERROR
  return ExitCode.SUCCESS
}

function printReport(r: CheckReport): void {
  const head = r.ok ? pc.green('✓ Works') : pc.red('✗ Problems')
  process.stdout.write(`${head} ${r.url} ${pc.dim(`(${r.viewport}, ${(r.load_ms / 1000).toFixed(1)} s)`)}\n`)
  for (const i of r.issues) {
    process.stdout.write(`  ${i.severity === 'error' ? pc.red('✗') : pc.yellow('!')} ${i.message}\n`)
  }
  if (r.issues.length === 0) process.stdout.write(pc.dim('  No console errors, failed files or blank screen.\n'))
  for (const f of r.failed_requests.slice(0, 5)) {
    process.stdout.write(pc.dim(`    ${f.status !== null ? f.status : f.error ?? 'failed'}  ${f.url}\n`))
  }
  for (const m of r.console.filter((c) => c.level === 'error').slice(0, 5)) {
    process.stdout.write(pc.dim(`    ${m.text}${m.source ? `  (${m.source})` : ''}\n`))
  }
  if (r.screenshot_url !== null) process.stdout.write(pc.dim('Screenshot (24 h): ') + r.screenshot_url + '\n')
}

export function makeCheckCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('check')
    .description('Open a published page in a browser and report errors, failed files or a blank screen (exits 1 if broken)')
    .argument('<id>', 'Page ID')
    .option('-m, --mobile', 'Check at phone size (390×844) instead of desktop (1280×800)')
    .option('--strict', 'Also exit 1 on warnings (slow, heavy, too wide)')
    .option('-s, --screenshot <file>', 'Save the screenshot as a JPEG here')
    .action(async (id: string, cmdOpts: CheckOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      // As set: a stored update token wins; else the session or API key must own the page.
      const token = getToken(id)
      const session = getSession()
      if (token === null && session === null && !apiKeyConfigured(opts)) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens, or sign in with 'aired login'.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      let report: CheckReport
      try {
        report = await withSpinner('Checking in a browser...', () =>
          checkPage(baseUrl, id, { token: token ?? '', jwt: session?.jwt, viewport: cmdOpts.mobile ? 'mobile' : 'desktop' }), opts)
      } catch (err) {
        const error = err as NodeJS.ErrnoException & Error & { status?: number }
        if (error.code === 'RATE_LIMITED' || error.status === 502 || error.status === 503) {
          outputError({ code: error.code === 'RATE_LIMITED' ? 'RATE_LIMIT' : 'UNAVAILABLE', message: error.message }, opts)
          process.exit(ExitCode.RATE_LIMITED)
        }
        // No access or no such page: not a broken page, so not exit 1.
        outputError({ code: 'API', message: error.message }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      if (cmdOpts.screenshot !== undefined && report.screenshot_url === null) {
        process.stderr.write(pc.yellow('No screenshot this time, so nothing was saved.\n'))
      } else if (cmdOpts.screenshot !== undefined && report.screenshot_url !== null) {
        try {
          const resp = await fetch(report.screenshot_url, { headers: { 'User-Agent': USER_AGENT } })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          writeFileSync(cmdOpts.screenshot, Buffer.from(await resp.arrayBuffer()))
          if (!shouldOutputJson(opts)) process.stderr.write(pc.dim(`Saved ${cmdOpts.screenshot}\n`))
        } catch (err) {
          process.stderr.write(pc.yellow(`Couldn't save the screenshot: ${(err as Error).message}\n`))
        }
      }

      if (shouldOutputJson(opts)) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
      else printReport(report)
      process.exit(checkExitCode(report, cmdOpts.strict === true))
    })
}
