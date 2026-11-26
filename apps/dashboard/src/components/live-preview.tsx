// A tile's top: the owner's real page, drawn small, once the tile scrolls
// into view. The HTML comes from /api/me/pages/:id/preview, which doesn't
// count a view or ask for the PIN. Until it arrives, or when the page is too
// big or can't be fetched, the kind cover shows instead.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PagePreview } from '@/components/page-preview'
import { cn } from '@/lib/utils'

type Entry = { state: 'ready'; html: string } | { state: 'none' }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<Entry>>()

function loadPreview(id: string): Promise<Entry> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  let p = inflight.get(id)
  if (!p) {
    p = fetch(`/api/me/pages/${encodeURIComponent(id)}/preview`, { credentials: 'same-origin' })
      .then(async (res): Promise<Entry> => (res.status === 200 ? { state: 'ready', html: await res.text() } : { state: 'none' }))
      .catch((): Entry => ({ state: 'none' }))
      .then((e) => { cache.set(id, e); inflight.delete(id); return e })
    inflight.set(id, p)
  }
  return p
}

/** Forget a page's preview (after it's deleted or replaced). */
export const forgetPreview = (id: string) => cache.delete(id)

export function LivePreview({ id, title, fallback, enabled = true }: { id: string; title: string; fallback: ReactNode; enabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [entry, setEntry] = useState<Entry | undefined>(() => cache.get(id))
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!enabled || entry) return
    const el = box.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((items) => {
      if (!items.some((i) => i.isIntersecting)) return
      io.disconnect()
      void loadPreview(id).then((e) => { if (alive) setEntry(e) })
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [id, enabled, entry])

  const ready = enabled && entry?.state === 'ready'
  return (
    <div ref={box} className="relative">
      <div className={cn('transition-opacity duration-300', ready && shown && 'opacity-0')} aria-hidden={ready && shown ? true : undefined}>{fallback}</div>
      {ready && (
        <div className={cn('absolute inset-0 opacity-0 transition-opacity duration-300', shown && 'opacity-100')}>
          <PagePreview page={{ title, html: entry.html }} scripts onLoad={() => setShown(true)} className="h-full" />
        </div>
      )}
    </div>
  )
}
