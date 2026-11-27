import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import pc from 'picocolors'
import { getTemplate, TEMPLATES } from '@aired/core'
import type { GlobalOpts } from '../lib/config.js'
import { shouldOutputJson, outputError, ExitCode } from '../lib/output.js'

/**
 * `aired new [template] [file]`: write a starter (a deck, a report, a
 * one-pager) to fill in and publish. The same templates as the MCP
 * get_template tool (@aired/core templates.ts).
 */
export function makeNewCommand(globalOpts: () => GlobalOpts): Command {
  return new Command('new')
    .description('Start from a template: deck, deck-html, report or one-pager')
    .argument('[template]', 'Template name (omit to list them)')
    .argument('[file]', 'Where to write it (default: the template\'s own file name)')
    .option('--stdout', 'Print the template instead of writing a file')
    .option('-f, --force', 'Overwrite the file if it exists')
    .action((name: string | undefined, file: string | undefined, cmdOpts: { stdout?: boolean; force?: boolean }) => {
      const opts = globalOpts()
      const json = shouldOutputJson(opts)

      if (name === undefined) {
        if (json) {
          process.stdout.write(JSON.stringify({ templates: TEMPLATES.map(({ name, title, description, format, deck, filename }) => ({ name, title, description, format, deck, filename })) }, null, 2) + '\n')
          return
        }
        process.stdout.write(pc.bold('Templates') + '\n\n')
        const width = Math.max(...TEMPLATES.map((t) => t.name.length))
        for (const t of TEMPLATES) process.stdout.write(`  ${t.name.padEnd(width)}  ${t.description}\n`)
        process.stdout.write('\n' + pc.dim('Start one:  ') + 'aired new deck\n')
        return
      }

      const template = getTemplate(name)
      if (template === null) {
        outputError({ code: 'VALIDATION', message: `No template called '${name}'. Try one of: ${TEMPLATES.map((t) => t.name).join(', ')}` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }

      if (cmdOpts.stdout === true) {
        process.stdout.write(template.content)
        return
      }

      const target = resolve(file ?? template.filename)
      if (existsSync(target) && cmdOpts.force !== true) {
        outputError({ code: 'VALIDATION', message: `${file ?? template.filename} already exists. Pass --force to overwrite it, or give another file name.` }, opts)
        process.exit(ExitCode.VALIDATION_ERROR)
      }
      writeFileSync(target, template.content)

      const shown = file ?? template.filename
      const publish = `aired ${shown}`
      if (json) {
        process.stdout.write(JSON.stringify({ template: template.name, file: target, format: template.format, deck: template.deck, publish }, null, 2) + '\n')
        return
      }
      process.stdout.write(pc.green('Created ') + pc.bold(shown) + pc.dim(`  (${template.title})`) + '\n\n')
      for (const rule of template.rules.slice(0, 4)) process.stdout.write(pc.dim('- ') + rule + '\n')
      process.stdout.write('\n' + pc.dim('Edit it, then publish:  ') + publish + '\n')
    })
}
