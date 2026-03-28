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

// Handle --mcp flag before Commander parses
if (process.argv.includes('--mcp')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')

  const mcpEntry = path.resolve(__dirname, '../../mcp/dist/index.js')

  const child = spawn(process.execPath, [mcpEntry], {
    stdio: 'inherit',
    env: process.env,
  })

  child.on('error', (err: Error) => {
    process.stderr.write(`MCP server failed to start: ${err.message}\n`)
    process.stderr.write('Make sure @aired/mcp is built: pnpm --filter @aired/mcp build\n')
    process.exit(1)
  })

  child.on('exit', (code: number | null) => {
    process.exit(code ?? 0)
  })
} else {
  const program = new Command()
    .name(CLI_NAME)
    .version(VERSION, '-v, --version')
    .description('Publish HTML artifacts to shareable URLs instantly')
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

  if (process.argv.length <= 2) {
    process.stderr.write(banner() + '\n')
    program.help()
  } else {
    program.parse(process.argv)
  }
}
