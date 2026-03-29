import { readFile, stat, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Datauri = require('datauri/sync') as (filePath: string) => { content: string }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packToStringModule = require('@joplin/htmlpack/packToString') as { default: Function }
const packToString = packToStringModule.default as (
  baseDir: string,
  inputHtml: string,
  fs: {
    exists(path: string): Promise<boolean>
    readFileText(path: string): Promise<string>
    readFileDataUri(path: string): Promise<string>
  },
) => Promise<string>

/**
 * Checks if a path is a directory.
 */
export async function isDirectory(inputPath: string): Promise<boolean> {
  try {
    const s = await stat(inputPath)
    return s.isDirectory()
  } catch {
    return false
  }
}

/**
 * Finds index.html in a directory. Returns the full path or null.
 */
export async function findIndexHtml(dirPath: string): Promise<string | null> {
  const candidate = join(dirPath, 'index.html')
  try {
    await access(candidate, constants.R_OK)
    return candidate
  } catch {
    return null
  }
}

/**
 * Bundles a directory into a single self-contained HTML string.
 * Inlines all local CSS, JS, images, and fonts as data URIs.
 * External URLs (CDN, http://) are left untouched.
 */
export async function bundleDirectory(dirPath: string): Promise<string> {
  const indexPath = await findIndexHtml(dirPath)
  if (!indexPath) {
    throw new Error(`No index.html found in ${dirPath}`)
  }

  const baseDir = dirname(indexPath)
  const inputHtml = await readFile(indexPath, 'utf-8')

  const bundled = await packToString(baseDir, inputHtml, {
    async exists(filePath: string): Promise<boolean> {
      try {
        await access(filePath, constants.R_OK)
        return true
      } catch {
        return false
      }
    },
    async readFileText(filePath: string): Promise<string> {
      return readFile(filePath, 'utf-8')
    },
    async readFileDataUri(filePath: string): Promise<string> {
      const result = Datauri(filePath)
      return result.content
    },
  })

  return bundled
}
