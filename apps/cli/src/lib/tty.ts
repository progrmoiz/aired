export function isInteractive(): boolean {
  if (!process.stdout.isTTY) return false
  if (process.env.CI) return false
  if (process.env.TERM === 'dumb') return false
  return true
}
