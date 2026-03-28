import { DEFAULT_API_URL } from './constants.js'

export interface GlobalOpts {
  apiUrl?: string
  json?: boolean
  quiet?: boolean
  verbose?: boolean
}

export function resolveApiUrl(opts: GlobalOpts): string {
  return opts.apiUrl ?? process.env['AIRED_API_URL'] ?? DEFAULT_API_URL
}
