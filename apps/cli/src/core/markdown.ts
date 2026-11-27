import { dirname, isAbsolute, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Datauri = require('datauri/sync') as (filePath: string) => { content: string }

/** What `aired` sends: HTML, or Markdown that aired renders (a doc, or slides with deck). */
export type PageContent = { html: string } | { markdown: string; deck?: boolean } | { html: string; deck: boolean }

/** A Markdown file, by its name. */
export function isMarkdownPath(file: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(file)
}

/** Images up to this size are put into the page; bigger ones are left as links. */
const MAX_IMAGE_BYTES = 1024 * 1024

/**
 * Local images in Markdown (`![alt](./chart.png)`) put into the page as data
 * URLs, so they show once published. Web links, missing files and big files
 * are left as they are.
 */
export function inlineLocalImages(md: string, file: string): string {
  const base = dirname(resolve(file))
  return md.replace(/(!\[[^\]]*\]\()\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g, (all, open: string, src: string, title: string | undefined) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) return all
    const path = isAbsolute(src) ? src : resolve(base, decodeURI(src))
    try {
      if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size > MAX_IMAGE_BYTES) return all
      const uri = Datauri(path).content
      return uri ? `${open}${uri}${title ?? ''})` : all
    } catch {
      return all
    }
  })
}
