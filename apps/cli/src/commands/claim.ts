import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { getToken, listTokens } from '../core/store.js'
import { getSession } from '../core/session.js'
import { claimPage, claimBatch } from '../core/client.js'

export function makeClaimCommand(globalOpts: () => GlobalOpts): Command {
  const cmd = new Command('claim')
    .description('Claim pages to your aired account')
    .argument('[id]', 'Page ID to claim')
    .option('--all', 'Claim all locally stored pages')
    .action(async (id: string | undefined, cmdOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      const session = getSession()
      if (session === null) {
        outputError({ code: 'AUTH', message: "Run `aired login` first" }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      if (cmdOpts.all === true) {
        // Claim all local tokens
        const tokens = listTokens()
        if (tokens.length === 0) {
          process.stdout.write('No local tokens to claim.\n')
          return
        }

        const CHUNK_SIZE = 100
        let totalClaimed = 0
        let totalFailed = 0
        const failedIds: string[] = []

        for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
          const chunk = tokens.slice(i, i + CHUNK_SIZE)
          const items = chunk.map((t) => ({ id: t.id, update_token: t.token }))

          try {
            const result = await claimBatch(baseUrl, session.jwt, items)
            totalClaimed += result.claimed.length
            totalFailed += result.failed.length
            failedIds.push(...result.failed)

            if (opts.verbose) {
              for (const claimedId of result.claimed) {
                process.stdout.write(pc.green('claimed') + ` ${claimedId}\n`)
              }
              for (const failedId of result.failed) {
                process.stdout.write(pc.red('failed') + `  ${failedId}\n`)
              }
            }
          } catch (err) {
            outputError({ code: 'API', message: (err as Error).message }, opts)
            process.exit(ExitCode.API_ERROR)
          }
        }

        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ claimed: totalClaimed, failed: totalFailed, failedIds }, null, 2) + '\n')
        } else {
          process.stdout.write(`Claimed ${totalClaimed} · Failed ${totalFailed}\n`)
        }
        return
      }

      // Single page claim
      if (id === undefined) {
        outputError({ code: 'VALIDATION', message: 'Provide a page ID or use --all' }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      const token = getToken(id)
      if (token === null) {
        outputError({ code: 'VALIDATION', message: `No local token for ${id}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      try {
        await claimPage(baseUrl, session.jwt, id, token)
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify({ ok: true, id }, null, 2) + '\n')
        } else {
          process.stdout.write(pc.green('Claimed') + ` ${id}\n`)
        }
      } catch (err) {
        outputError({ code: 'API', message: `Claim failed: ${(err as Error).message}` }, opts)
        process.exit(ExitCode.API_ERROR)
      }
    })

  return cmd
}
