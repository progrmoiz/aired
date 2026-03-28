import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { getPage } from '../core/client.js'

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

export function makeInfoCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('info')
    .description('Show page metadata (title, size, reads, expiry)')
    .argument('<id>', 'Page ID')
    .action(async (id) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      try {
        const page = await withSpinner('Fetching...', () => getPage(baseUrl, id), opts)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(page, null, 2) + '\n')
        } else {
          const url = `${baseUrl}/p/${id}`
          process.stdout.write('\n')
          process.stdout.write(pc.dim('ID:      ') + pc.bold(page.id) + '\n')
          process.stdout.write(pc.dim('Title:   ') + (page.title ?? '(untitled)') + '\n')
          process.stdout.write(pc.dim('URL:     ') + url + '\n')
          process.stdout.write(pc.dim('Size:    ') + formatSize(page.size) + '\n')
          process.stdout.write(pc.dim('Reads:   ') + String(page.readCount) + '\n')
          process.stdout.write(pc.dim('Expires: ') + formatExpiry(page.expiresAt) + '\n')
        }
      } catch (err) {
        outputError({ code: 'API', message: (err as Error).message }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })
}
