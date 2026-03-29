import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { publishHTML } from '../core/client.js'
import { saveToken } from '../core/store.js'
import { isDirectory, bundleDirectory } from '../core/bundler.js'

function parseTtl(ttl: string): number | null {
  const match = /^(\d+)(h|d|m)?$/i.exec(ttl)
  if (!match) return null
  const n = parseInt(match[1]!, 10)
  const unit = (match[2] ?? 's').toLowerCase()
  if (unit === 'h') return n * 3600
  if (unit === 'd') return n * 86400
  if (unit === 'm') return n * 60
  return n
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    process.stdin.on('error', reject)
  })
}

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Never (permanent)'
  const d = new Date(expiresAt)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function makePublishCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('publish')
    .alias('p')
    .description('Publish an HTML file or directory (or pipe via stdin)')
    .argument('[file]', 'Path to HTML file or directory (omit to read stdin)')
    .option('-t, --title <title>', 'Custom title')
    .option('-p, --pin <pin>', 'PIN-protect the page')
    .option('--ttl <duration>', 'Expiry duration: 1h, 24h, 7d, 30d')
    .option('--permanent', 'No expiry')
    .option('--reads <n>', 'Max read count before page is gone')
    .action(async (file, cmdOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      let html: string
      if (file === undefined || file === '-') {
        if (process.stdin.isTTY) {
          outputError({ code: 'VALIDATION', message: 'Provide a file path, directory, or pipe HTML via stdin' }, opts)
          process.exit(ExitCode.VALIDATION_ERROR)
        }
        html = await readStdin()
      } else {
        const resolved = resolve(file)
        if (await isDirectory(resolved)) {
          try {
            html = await withSpinner('Bundling directory...', () => bundleDirectory(resolved), opts)
          } catch (err) {
            outputError({ code: 'VALIDATION', message: (err as Error).message }, opts)
            process.exit(ExitCode.VALIDATION_ERROR)
          }
        } else {
          try {
            html = await readFile(resolved, 'utf-8')
          } catch (err) {
            outputError({ code: 'VALIDATION', message: `Cannot read file '${file}': ${(err as Error).message}` }, opts)
            process.exit(ExitCode.VALIDATION_ERROR)
          }
        }
      }

      // Warn if bundled HTML is large
      const sizeBytes = new TextEncoder().encode(html).byteLength
      const sizeMB = sizeBytes / (1024 * 1024)
      if (sizeMB > 2) {
        if (!shouldOutputJson(opts)) {
          process.stderr.write(pc.yellow(`Warning: bundled HTML is ${sizeMB.toFixed(1)} MB (limit: 2 MB). Upload may fail.\n`))
        }
      }

      const publishOpts: Parameters<typeof publishHTML>[2] = {}
      if (cmdOpts.title !== undefined) publishOpts.title = cmdOpts.title
      if (cmdOpts.pin !== undefined) publishOpts.pin = cmdOpts.pin
      if (cmdOpts.permanent === true) {
        publishOpts.permanent = true
      } else if (cmdOpts.ttl !== undefined) {
        const ttlSeconds = parseTtl(cmdOpts.ttl)
        if (ttlSeconds === null || ttlSeconds <= 0) {
          outputError({ code: 'VALIDATION', message: `Invalid --ttl value '${cmdOpts.ttl}'. Use formats like 1h, 24h, 7d, 30d` }, opts)
          process.exit(ExitCode.VALIDATION_ERROR)
        }
        publishOpts.ttl = ttlSeconds
      }
      if (cmdOpts.reads !== undefined) {
        const reads = parseInt(cmdOpts.reads, 10)
        if (isNaN(reads) || reads <= 0) {
          outputError({ code: 'VALIDATION', message: '--reads must be a positive integer' }, opts)
          process.exit(ExitCode.VALIDATION_ERROR)
        }
        publishOpts.reads = reads
      }

      try {
        const result = await withSpinner('Publishing...', () => publishHTML(baseUrl, html, publishOpts), opts)

        saveToken(result.id, result.update_token, {
          title: cmdOpts.title ?? null,
          url: result.url,
        })

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        } else {
          process.stdout.write('\n')
          process.stdout.write(pc.green('Published!') + ' ' + pc.bold(result.url) + '\n')
          process.stdout.write(pc.dim('Token:   ') + result.update_token + '\n')
          process.stdout.write(pc.dim('Expires: ') + formatExpiry(result.expiresAt) + '\n')
          process.stdout.write('\n')
          process.stdout.write(pc.dim('Update:  ') + `npx aired update ${result.id} new-file.html\n`)
          process.stdout.write(pc.dim('Delete:  ') + `npx aired delete ${result.id}\n`)
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
