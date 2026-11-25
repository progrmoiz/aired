import type { GlobalOpts } from './config.js'
import { outputError, ExitCode } from './output.js'
import { apiKeyFromEnv } from '../core/client.js'

/**
 * Whether AIRED_API_KEY is set to a usable key. A set-but-wrong value prints
 * the reason and exits, so a CI job never publishes anonymously by mistake.
 */
export function apiKeyConfigured(opts: GlobalOpts): boolean {
  try {
    return apiKeyFromEnv() !== null
  } catch (err) {
    outputError({ code: 'VALIDATION', message: (err as Error).message }, opts)
    process.exit(ExitCode.VALIDATION_ERROR)
  }
}
