// A tile's top: the page's stored screenshot, blurred up from the tiny
// placeholder the page list sends. Pages without one yet (older pages, or
// one still being drawn) show the live owner preview and ask the server to
// draw them; the kind cover is the last resort.
//
// Nothing here is re-fetched when the tile re-mounts (tab, filter, sort or
// layout switch): the image URL carries its version, so the browser keeps it
// for good, and the module-level sets remember what has already loaded.
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { LivePreview } from '@/components/live-preview'
import { mutate, type TileInfo } from '@/lib/api'
import { cn } from '@/lib/utils'

const tileSrc = (id: string, v: string) => `/api/me/pages/${encodeURIComponent(id)}/tile?v=${encodeURIComponent(v)}`

/** Tile images that have loaded once this session: shown sharp at once after a re-mount. */
const loaded = new Set<string>()
/** Images that failed (deleted or replaced since the list loaded): use the live preview. */
const broken = new Set<string>()

/* ─── Backfill: tiles drawn after the list loaded ─── */

const drawnLater = new Map<string, TileInfo>()
const listeners = new Set<() => void>()
const asked = new Set<string>()
let queue: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let busy = false

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

/** Queue a page with no screenshot for the server to draw (it draws a few at a time, within its daily budget). */
export function requestTile(id: string) {
  if (asked.has(id)) return
  asked.add(id)
  queue.push(id)
  if (!timer && !busy) timer = setTimeout(flush, 400)
}

async function flush() {
  timer = null
  if (busy || queue.length === 0) return
  busy = true
  const ids = queue.slice(0, 20)
  queue = queue.slice(20)
  let drew = 0
  try {
    const res = await mutate('POST', '/api/me/pages/shots', { ids })
    if (res.ok) {
      const { tiles = {} } = (await res.json()) as { tiles?: Record<string, TileInfo | null> }
      for (const [id, t] of Object.entries(tiles)) if (t) { drawnLater.set(id, t); drew++ }
      if (drew > 0) listeners.forEach((fn) => fn())
    }
  } catch { /* offline: those pages keep their live preview */ }
  busy = false
  // Keep going while the server is drawing; stop when it draws nothing (budget spent, or all tried today).
  const left = ids.filter((id) => !drawnLater.has(id))
  if (drew > 0) queue = [...left, ...queue]
  if (drew > 0 && queue.length > 0) timer = setTimeout(flush, 400)
}

function useDrawnLater(id: string) {
  return useSyncExternalStore(subscribe, () => drawnLater.get(id))
}

/** Forget a page's tile (after it's deleted). */
export function forgetTile(id: string) { drawnLater.delete(id); asked.delete(id) }

/* ─── The tile image ─── */

function TileImage({ src, lqip, onError }: { src: string; lqip: string; onError: () => void }) {
  const ref = useRef<HTMLImageElement>(null)
  const instant = useRef(loaded.has(src)).current
  const [done, setDone] = useState(instant)
  // A cached image can be complete before React attaches onLoad.
  useLayoutEffect(() => {
    const img = ref.current
    if (!done && img?.complete && img.naturalWidth > 0) { loaded.add(src); setDone(true) }
  }, [src, done])
  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted">
      <img src={lqip} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 size-full scale-110 object-cover object-top blur-xl" />
      <img
        ref={ref}
        src={src}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={() => { loaded.add(src); setDone(true) }}
        onError={onError}
        className={cn('absolute inset-0 size-full object-cover object-top', !instant && 'transition-[opacity,filter] duration-500 ease-out', done ? 'opacity-100 blur-0' : 'opacity-0 blur-sm')}
      />
    </div>
  )
}

export function PageThumb({ id, title, tile, enabled = true, fallback }: {
  id: string; title: string; tile: TileInfo | null | undefined; enabled?: boolean; fallback: ReactNode
}) {
  const later = useDrawnLater(id)
  const info = later ?? tile ?? null
  const src = info ? tileSrc(id, info.v) : null
  const [, rerender] = useState(0)
  const onError = useCallback(() => { if (src) { broken.add(src); rerender((n) => n + 1) } }, [src])
  const ask = useCallback(() => requestTile(id), [id])

  if (!enabled) return <>{fallback}</>
  if (info && src && !broken.has(src)) return <TileImage src={src} lqip={info.lqip} onError={onError} />
  return <LivePreview id={id} title={title} fallback={fallback} onVisible={info ? undefined : ask} />
}
