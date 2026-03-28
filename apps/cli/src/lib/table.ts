import pc from 'picocolors'

export interface TableColumn {
  key: string
  header: string
  width?: number
}

export function renderTable(rows: Record<string, unknown>[], columns: TableColumn[]): string {
  if (rows.length === 0) return ''
  const widths = columns.map((col) => {
    const hLen = col.header.length
    const maxLen = rows.reduce((m, r) => Math.max(m, String(r[col.key] ?? '').length), 0)
    return col.width ?? Math.max(hLen, maxLen)
  })
  const lines: string[] = []
  lines.push(columns.map((c, i) => pc.bold(c.header.padEnd(widths[i]))).join('  '))
  lines.push(pc.dim(widths.map(w => '-'.repeat(w)).join('  ')))
  for (const row of rows) {
    lines.push(columns.map((c, i) => String(row[c.key] ?? '').padEnd(widths[i])).join('  '))
  }
  return lines.join('\n')
}
