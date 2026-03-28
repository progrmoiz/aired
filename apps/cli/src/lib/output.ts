import pc from 'picocolors'
import type { GlobalOpts } from './config.js'

export const enum ExitCode {
  SUCCESS = 0,
  API_ERROR = 1,
  VALIDATION_ERROR = 2,
  RATE_LIMITED = 3,
}

export function shouldOutputJson(opts: GlobalOpts): boolean {
  if (opts.json) return true
  if (opts.quiet) return true
  if (!process.stdout.isTTY) return true
  return false
}

export function outputResult(data: unknown, opts: GlobalOpts): void {
  if (shouldOutputJson(opts)) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else {
    if (typeof data === 'string') {
      process.stdout.write(data + '\n')
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    }
  }
}

export function outputError(
  error: { code: string; message: string },
  opts: GlobalOpts,
): void {
  if (shouldOutputJson(opts)) {
    process.stderr.write(JSON.stringify({ error }, null, 2) + '\n')
  } else {
    process.stderr.write(pc.red(`Error: ${error.message}`) + '\n')
  }
}

export function outputFormatted<T>(data: T, humanFn: () => void, opts: GlobalOpts): void {
  if (shouldOutputJson(opts)) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else {
    humanFn()
  }
}
