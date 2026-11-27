import pc from 'picocolors'
import type { PublishResult } from '../core/types.js'

/** What the CLI says about a doc or a deck after publishing it. */
export function contentLines(result: PublishResult): string[] {
  if (result.kind === 'doc') return [pc.dim('Kind:    ') + 'Doc (rendered from Markdown)']
  if (result.kind !== 'deck') return []
  const lines = [
    pc.dim('Slides:  ') + `${result.slides ?? 0}` + pc.dim('  (arrow keys, swipe, F for full screen)'),
    pc.dim('Slide 2: ') + `${result.url}#/2`,
  ]
  if (result.presenter_url !== undefined && (result.slides_with_notes ?? 0) > 0) {
    lines.push(pc.dim('Notes:   ') + result.presenter_url + pc.dim('  (only you, signed in)'))
  }
  return lines
}
