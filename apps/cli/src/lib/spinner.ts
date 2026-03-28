import pc from 'picocolors'
import type { GlobalOpts } from './config.js'
import { isInteractive } from './tty.js'
import { shouldOutputJson } from './output.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  opts: GlobalOpts,
): Promise<T> {
  const show = isInteractive() && !shouldOutputJson(opts)
  let i = 0
  let timer: ReturnType<typeof setInterval> | undefined

  if (show) {
    process.stderr.write(`${FRAMES[0]} ${message}`)
    timer = setInterval(() => {
      i = (i + 1) % FRAMES.length
      process.stderr.write(`\r${FRAMES[i]} ${message}`)
    }, 80)
  }

  try {
    const result = await fn()
    if (timer) clearInterval(timer)
    if (show) process.stderr.write(`\r${pc.green('✓')} ${message}\n`)
    return result
  } catch (err) {
    if (timer) clearInterval(timer)
    if (show) process.stderr.write(`\r${pc.red('✗')} ${message}\n`)
    throw err
  }
}
