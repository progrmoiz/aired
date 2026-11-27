import { Command } from 'commander'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'
import { withSpinner } from '../lib/spinner.js'
import { sendFeedback } from '../core/client.js'
import { getSession } from '../core/session.js'
import { apiKeyConfigured } from '../lib/api-key-env.js'
import { isInteractive } from '../lib/tty.js'

const KINDS = ['bug', 'friction', 'idea'] as const
const IMPACTS = ['blocked', 'worked_around', 'minor'] as const

interface FeedbackOpts {
  kind?: string
  impact?: string
  page?: string
  tool?: string
  yes?: boolean
}

/**
 * aired feedback: tell the aired team about a bug, friction or a missing
 * feature (POST /api/feedback, the same as the send_feedback MCP tool). In a
 * terminal it asks for what's missing and confirms before sending; in a
 * script or agent the message and --kind are required and nothing is asked.
 */
export function makeFeedbackCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('feedback')
    .description('Send feedback about aired to the aired team (bug, friction or idea)')
    .argument('[message]', 'What happened and what you expected (10 to 2000 characters, never page HTML)')
    .option('-k, --kind <kind>', 'bug, friction or idea')
    .option('-i, --impact <impact>', 'blocked, worked_around or minor')
    .option('--page <id>', 'The page it is about, if any')
    .option('--tool <name>', 'The command or tool you were using, e.g. publish')
    .option('-y, --yes', 'Send without asking first')
    .action(async (messageArg: string | undefined, cmdOpts: FeedbackOpts) => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)
      const interactive = isInteractive() && !shouldOutputJson(opts)

      let kind = cmdOpts.kind
      let message = messageArg
      if (kind !== undefined && !(KINDS as readonly string[]).includes(kind)) {
        outputError({ code: 'VALIDATION', message: `--kind must be one of: ${KINDS.join(', ')}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      if (cmdOpts.impact !== undefined && !(IMPACTS as readonly string[]).includes(cmdOpts.impact)) {
        outputError({ code: 'VALIDATION', message: `--impact must be one of: ${IMPACTS.join(', ')}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      if (interactive) {
        if (kind === undefined) {
          const picked = await p.select({
            message: 'What kind of feedback?',
            options: [
              { value: 'bug', label: 'Bug', hint: 'something broke' },
              { value: 'friction', label: 'Friction', hint: 'it worked, but was harder than it should be' },
              { value: 'idea', label: 'Idea', hint: 'something missing' },
            ],
          })
          if (p.isCancel(picked)) process.exit(ExitCode.SUCCESS)
          kind = picked as string
        }
        if (message === undefined) {
          const typed = await p.text({
            message: 'What happened?',
            validate: (v) => (v.trim().length < 10 ? 'At least 10 characters' : v.length > 2000 ? 'At most 2000 characters' : undefined),
          })
          if (p.isCancel(typed)) process.exit(ExitCode.SUCCESS)
          message = typed as string
        }
        if (!cmdOpts.yes) {
          const ok = await p.confirm({ message: 'Send this to the aired team? It is not a support channel: there is no reply.' })
          if (p.isCancel(ok) || ok !== true) process.exit(ExitCode.SUCCESS)
        }
      }

      if (kind === undefined || message === undefined) {
        outputError({ code: 'VALIDATION', message: 'Pass the message and --kind (bug, friction or idea). Example: aired feedback --kind friction "aired set needed the token twice"' }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      apiKeyConfigured(opts)
      const body: Record<string, unknown> = {
        kind,
        message,
        source: 'cli',
        actor: interactive ? 'person' : 'agent',
      }
      if (cmdOpts.impact !== undefined) body['impact'] = cmdOpts.impact
      if (cmdOpts.page !== undefined) body['page_id'] = cmdOpts.page
      if (cmdOpts.tool !== undefined) body['tool'] = cmdOpts.tool

      try {
        const result = await withSpinner('Sending...', () => sendFeedback(baseUrl, body, getSession()?.jwt), opts)
        if (shouldOutputJson(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        } else {
          process.stdout.write(pc.green('Sent ') + pc.bold(result.id) + '\n' + pc.dim(result.message) + '\n')
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
