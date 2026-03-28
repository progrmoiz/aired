import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { renderTable } from '../lib/table.js'
import { listTokens, pruneExpired } from '../core/store.js'

export function makeTokensCommand(globalOpts: () => GlobalOpts): Command {
  const cmd = new Command('tokens')
    .description('List stored tokens')
    .action(async () => {
      const opts = globalOpts()
      const tokens = listTokens()

      if (tokens.length === 0) {
        if (shouldOutputJson(opts)) {
          process.stdout.write('[]\n')
        } else {
          process.stdout.write('No tokens stored. Publish a page first.\n')
        }
        return
      }

      if (shouldOutputJson(opts)) {
        const output = tokens.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          created: t.created,
        }))
        process.stdout.write(JSON.stringify(output, null, 2) + '\n')
        return
      }

      const rows = tokens.map((t) => ({
        id: t.id,
        title: t.title ?? pc.dim('(untitled)'),
        url: t.url,
        created: new Date(t.created).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      }))

      process.stdout.write(
        renderTable(rows, [
          { key: 'id', header: 'ID' },
          { key: 'title', header: 'Title' },
          { key: 'url', header: 'URL' },
          { key: 'created', header: 'Created' },
        ]) + '\n',
      )
    })

  cmd
    .command('prune')
    .description('Remove tokens for pages that no longer exist')
    .action(async () => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      try {
        const pruned = await withSpinner('Checking pages...', () => pruneExpired(baseUrl), opts)

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ pruned }, null, 2) + '\n')
        } else {
          if (pruned === 0) {
            process.stdout.write('Nothing to prune. All pages are still alive.\n')
          } else {
            process.stdout.write(pc.green(`Pruned ${pruned} expired token${pruned === 1 ? '' : 's'}.\n`))
          }
        }
      } catch (err) {
        outputError({ code: 'API', message: (err as Error).message }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })

  return cmd
}
