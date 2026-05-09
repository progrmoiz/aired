import { Command } from 'commander'
import pc from 'picocolors'
import type { GlobalOpts } from '../lib/config.js'
import { shouldOutputJson } from '../lib/output.js'
import { getSession } from '../core/session.js'

export function makeWhoamiCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('whoami')
    .description('Show the currently signed-in user')
    .action(() => {
      const opts = globalOpts()
      const session = getSession()

      if (session === null) {
        process.stdout.write('Not signed in. Run `aired login`\n')
        process.exit(0)
      }

      if (shouldOutputJson(opts)) {
        const output: Record<string, unknown> = {
          login: session.user.login,
          savedAt: session.savedAt,
        }
        if (opts.verbose && session.user.email !== null) {
          output['email'] = session.user.email
        }
        process.stdout.write(JSON.stringify(output, null, 2) + '\n')
        return
      }

      process.stdout.write(`@${session.user.login}\n`)

      if (opts.verbose) {
        if (session.user.email !== null) {
          process.stdout.write(pc.dim('Email:    ') + session.user.email + '\n')
        }
        process.stdout.write(pc.dim('Saved at: ') + session.savedAt + '\n')
      }
    })
}
