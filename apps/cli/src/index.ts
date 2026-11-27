import { Command } from 'commander'
import { VERSION, CLI_NAME } from './lib/constants.js'
import type { GlobalOpts } from './lib/config.js'
import { banner } from './lib/banner.js'
import { makePublishCommand } from './commands/publish.js'
import { makeUpdateCommand } from './commands/update.js'
import { makeDeleteCommand } from './commands/delete.js'
import { makeInfoCommand } from './commands/info.js'
import { makeTokensCommand } from './commands/tokens.js'
import { makeDoctorCommand } from './commands/doctor.js'
import { makeLoginCommand } from './commands/login.js'
import { makeLogoutCommand } from './commands/logout.js'
import { makeWhoamiCommand } from './commands/whoami.js'
import { makeClaimCommand } from './commands/claim.js'
import { makeSetCommand } from './commands/set.js'
import { makeFeedbackCommand } from './commands/feedback.js'
import { makeCheckCommand } from './commands/check.js'
import { makeNewCommand } from './commands/new.js'

// Handle --mcp flag before Commander parses
if (process.argv.includes('--mcp')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // Published package: dist/mcp.cjs next to dist/cli.cjs. Monorepo dev build: apps/mcp/dist.
  const bundled = path.resolve(__dirname, 'mcp.cjs')
  const mcpEntry = fs.existsSync(bundled) ? bundled : path.resolve(__dirname, '../../mcp/dist/index.js')

  const child = spawn(process.execPath, [mcpEntry], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('error', (err: Error) => {
    process.stderr.write(`MCP server failed to start: ${err.message}\n`)
    process.stderr.write(`Could not start ${mcpEntry}. Reinstall with: npm i -g aired@latest\n`)
    process.exit(1)
  })

  child.on('exit', (code: number | null) => {
    process.exit(code ?? 0)
  })
} else {
  const program = new Command()
    .name(CLI_NAME)
    .version(VERSION, '-v, --version')
    .description('Publish HTML, Markdown docs and slide decks to shareable URLs instantly')
    .option('--api-url <url>', 'Custom API URL (default: https://aired.sh)')
    .option('--json', 'Force JSON output')
    .option('-q, --quiet', 'Suppress stderr, implies --json')
    .option('--verbose', 'Show extended output')

  function getGlobalOpts(): GlobalOpts {
    const opts = program.opts()
    return {
      apiUrl: opts.apiUrl,
      json: opts.json,
      quiet: opts.quiet,
      verbose: opts.verbose,
    }
  }

  // Register commands
  program.addCommand(makePublishCommand(getGlobalOpts), { isDefault: true })
  program.addCommand(makeUpdateCommand(getGlobalOpts))
  program.addCommand(makeDeleteCommand(getGlobalOpts))
  program.addCommand(makeInfoCommand(getGlobalOpts))
  program.addCommand(makeTokensCommand(getGlobalOpts))
  program.addCommand(makeDoctorCommand(getGlobalOpts))
  program.addCommand(makeLoginCommand(getGlobalOpts))
  program.addCommand(makeLogoutCommand(getGlobalOpts))
  program.addCommand(makeWhoamiCommand(getGlobalOpts))
  program.addCommand(makeClaimCommand(getGlobalOpts))
  program.addCommand(makeSetCommand(getGlobalOpts))
  program.addCommand(makeCheckCommand(getGlobalOpts))
  program.addCommand(makeFeedbackCommand(getGlobalOpts))
  program.addCommand(makeNewCommand(getGlobalOpts))

  if (process.argv.length <= 2) {
    process.stderr.write(banner(getGlobalOpts()) + '\n')
    program.help()
  } else {
    program.parse(process.argv)
  }
}
