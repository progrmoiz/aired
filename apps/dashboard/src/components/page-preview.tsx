import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** What a preview needs: the page's title (for the frame's label) and its HTML. */
export type PreviewSource = { title: string; html: string }

/** A live, sandboxed render of the page, scaled to fit (pages are drawn at 1200×800). */
/** `scripts` lets the page's JavaScript run (still an opaque origin: no cookies, no access to the dashboard). */
export function PagePreview({ page, className, interactive = false, scripts = false, onLoad }: { page: PreviewSource; className?: string; interactive?: boolean; scripts?: boolean; onLoad?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.25)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1200))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className={cn('relative aspect-[3/2] w-full overflow-hidden bg-white', className)}>
      <iframe
        title={`Preview of ${page.title}`}
        srcDoc={page.html}
        sandbox={scripts ? 'allow-scripts' : ''}
        onLoad={onLoad}
        tabIndex={interactive ? 0 : -1}
        aria-hidden={interactive ? undefined : true}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{ width: 1200, height: 800, transform: `scale(${scale})` }}
      />
    </div>
  )
}

/** Deterministic QR-like pattern for the mockups (not a scannable code). */
export function QrPlaceholder({ seed, className }: { seed: string; className?: string }) {
  const n = 25
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const cells: boolean[] = []
  for (let i = 0; i < n * n; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177); cells.push(((h >>> 7) & 3) === 0 || ((h >>> 3) & 7) < 3) }
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) if (inBox(ox, oy)) {
      const dx = x - ox, dy = y - oy
      return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) ? 1 : 0
    }
    return -1
  }
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className={className} role="img" aria-label="QR code for the link (illustration)">
      <rect width={n} height={n} fill="white" />
      {cells.map((on, i) => {
        const x = i % n, y = Math.floor(i / n)
        const f = finder(x, y)
        return (f === 1 || (f === -1 && on)) ? <rect key={i} x={x} y={y} width={1} height={1} fill="black" /> : null
      })}
    </svg>
  )
}
