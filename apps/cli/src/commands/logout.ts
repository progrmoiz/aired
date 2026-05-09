import { Command } from 'commander'
import type { GlobalOpts } from '../lib/config.js'
import { resolveApiUrl } from '../lib/config.js'
import { getSession, clearSession } from '../core/session.js'
import { logoutSession } from '../core/client.js'

export function makeLogoutCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('logout')
    .description('Sign out of your aired account')
    .action(async () => {
      const opts = globalOpts()
      const baseUrl = resolveApiUrl(opts)

      const session = getSession()
      if (session === null) {
        process.stdout.write('Not signed in.\n')
        process.exit(0)
      }

      try {
        await logoutSession(baseUrl, session.jwt)
      } catch {
        // Always clear session regardless of server response
      }

      clearSession()
      process.stdout.write('Logged out.\n')
      process.exit(0)
    })
}
