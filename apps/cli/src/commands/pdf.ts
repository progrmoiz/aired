import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { exportPdf } from '../core/client.js'
import { getToken } from '../core/store.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { USER_AGENT } from '../lib/constants.js'
import type { PdfExport } from '../core/types.js'

interface PdfOpts {
  out?: string
  notes?: boolean
  paper?: string
}

/** --paper as the API takes it, or null when it isn't a4 or letter. */
export function parsePaperFlag(v: string | undefined): 'a4' | 'letter' | undefined | null {
  if (v === undefined) return undefined
  const p = v.toLowerCase()
  return p === 'a4' || p === 'letter' ? p : null
}

/** What the PDF is, in one line. */
export function pdfSummary(r: PdfExport): string {
  const pages = `${r.pages} page${r.pages === 1 ? '' : 's'}`
  const what = r.kind === 'deck' ? `${pages}, one slide per page${r.notes ? ' with speaker notes' : ''}` : `${pages}, ${r.paper === 'letter' ? 'Letter' : 'A4'}`
  const kb = Math.max(1, Math.round(r.bytes / 1024))
  return `${what}, ${kb} KB`
}

export function makePdfCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('pdf')
    .description('Download a published page as a PDF (decks: one slide per page)')
    .argument('<id>', 'Page ID')
    .option('-o, --out <file>', 'Where to save it (default: a name from the page title, here)')
    .option('--notes', 'Decks: add a page of speaker notes after each slide (your own decks, signed in)')
    .option('--paper <size>', 'a4 or letter (default: Letter in the US and Canada, A4 elsewhere). Decks print at slide size')
    .action(async (id: string, cmdOpts: PdfOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      const paper = parsePaperFlag(cmdOpts.paper)
      if (paper === null) {
        outputError({ code: 'VALIDATION', message: `Invalid --paper '${cmdOpts.paper}'. Use a4 or letter.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      // As check: a stored update token wins; else the session or API key must own the page.
      // Notes are for the signed-in owner only.
      const token = getToken(id)
      const session = getSession()
      const signedIn = session !== null || apiKeyConfigured(opts)
      if (cmdOpts.notes && !signedIn) {
        outputError({ code: 'VALIDATION', message: "Speaker notes need sign-in. Run 'aired login' first." }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      if (token === null && !signedIn) {
        outputError({ code: 'VALIDATION', message: `No token found for page '${id}'. Run 'aired tokens' to list stored tokens, or sign in with 'aired login'.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      let result: PdfExport
      try {
        result = await withSpinner('Making the PDF...', () =>
          exportPdf(baseUrl, id, { token: token ?? '', jwt: session?.jwt, notes: cmdOpts.notes === true, ...(paper !== undefined ? { paper } : {}) }), opts)
      } catch (err) {
        const error = err as NodeJS.ErrnoException & Error & { status?: number }
        if (error.code === 'RATE_LIMITED' || error.status === 502 || error.status === 503) {
          outputError({ code: error.code === 'RATE_LIMITED' ? 'RATE_LIMIT' : 'UNAVAILABLE', message: error.message }, opts)
          process.exit(ExitCode.RATE_LIMITED)
        }
        outputError({ code: 'API', message: error.message }, opts)
        process.exit(ExitCode.API_ERROR)
      }

      const file = cmdOpts.out ?? result.filename
      try {
        const resp = await fetch(result.download_url, { headers: { 'User-Agent': USER_AGENT } })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        writeFileSync(file, Buffer.from(await resp.arrayBuffer()))
      } catch (err) {
        outputError({ code: 'API', message: `Couldn't download the PDF: ${(err as Error).message}. The link works until ${result.expires_at}: ${result.download_url}` }, opts)
        process.exit(ExitCode.API_ERROR)
      }

      if (shouldOutputJson(opts)) {
        process.stdout.write(JSON.stringify({ ...result, file }, null, 2) + '\n')
      } else {
        process.stdout.write(`${pc.green('✓ Saved')} ${file} ${pc.dim(`(${pdfSummary(result)})`)}\n`)
        if (result.footer) process.stdout.write(pc.dim('  Free PDFs have a small "Made with aired" line. Pro removes it.\n'))
      }
    })
}
