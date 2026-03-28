export function formatCsv(headers: string[], rows: string[][]): string {
  const esc = (c: string) => c.includes(',') || c.includes('"') || c.includes('\n')
    ? `"${c.replace(/"/g, '""')}"` : c
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n') + '\n'
}

export function formatMarkdown(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length), 3))
  const lines: string[] = []
  lines.push('| ' + headers.map((h, i) => h.padEnd(widths[i])).join(' | ') + ' |')
  lines.push('| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |')
  for (const row of rows) {
    lines.push('| ' + headers.map((_, i) => (row[i] ?? '').padEnd(widths[i])).join(' | ') + ' |')
  }
  return lines.join('\n') + '\n'
}
