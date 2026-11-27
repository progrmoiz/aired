import pc from 'picocolors'
import type { PageDetails } from '../core/types.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`
}

function formatExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return 'Never (permanent)'
  return new Date(expiresAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function accessLine(page: PageDetails): string {
  const mode = page.access ?? (page.hasPin ? 'pin' : 'public')
  if (mode === 'pin') return 'PIN'
  if (mode === 'public') return 'anyone with the link'
  const people = page.allowed ? [...page.allowed.emails, ...page.allowed.domains.map((d) => `@${d}`)] : []
  return people.length > 0 ? `only ${people.join(', ')}` : 'only the people on its list'
}

/** A page's settings for a person to read (aired set). Never the PIN: only whether it's on. */
export function printPageDetails(page: PageDetails): void {
  const views = page.reads !== null ? `${page.readCount} of ${page.reads}` : String(page.readCount)
  const lines = [
    ['ID:      ', pc.bold(page.id)],
    ['Title:   ', page.title ?? '(untitled)'],
    ['URL:     ', page.url],
    ['Size:    ', formatBytes(page.size)],
    ['Views:   ', views],
    ['Access:  ', accessLine(page)],
    ['Expires: ', formatExpiry(page.expiresAt)],
  ]
  if (page.allowPdf !== undefined) lines.push(['PDF:     ', page.allowPdf ? 'viewers can download it' : 'only you (aired pdf)'])
  if (page.project !== null) lines.push(['Project: ', page.project])
  for (const [label, value] of lines) process.stdout.write(pc.dim(label!) + value + '\n')
}
