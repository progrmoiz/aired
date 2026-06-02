import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

/**
 * Extract a repository name from a git remote URL.
 * Handles SCP-style (git@host:user/repo.git) and URL-style (https://host/user/repo.git),
 * stripping a trailing .git and any trailing slash. Returns null if nothing usable.
 */
export function repoNameFromUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return null
  // Last path segment after the final '/' or ':' (SCP form uses ':')
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':'))
  const tail = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
  const name = tail.replace(/\.git$/i, '')
  return name.length > 0 ? name : null
}

function runGit(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    })
    const trimmed = out.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/**
 * Detect the project a publish is running inside.
 * Order: git remote origin repo name → git toplevel directory basename → cwd basename.
 * Returns null only if even the cwd basename is empty (e.g. filesystem root).
 */
export function detectProject(cwd: string): string | null {
  // 1. git remote origin URL → repo name
  const remote = runGit(['config', '--get', 'remote.origin.url'], cwd)
  if (remote !== null) {
    const name = repoNameFromUrl(remote)
    if (name !== null) return name
  }

  // 2. git toplevel directory basename
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd)
  if (toplevel !== null) {
    const name = basename(toplevel)
    if (name.length > 0) return name
  }

  // 3. current working directory basename
  const base = basename(cwd)
  return base.length > 0 ? base : null
}
