// A tile's top when the page has no screenshot yet: the owner's real page,
// drawn small, once the tile scrolls into view. The HTML comes from
// /api/me/pages/:id/preview, which doesn't count a view or ask for the PIN.
// Until it arrives a neutral placeholder shows; the kind cover (`fallback`)
// only when the page is too big or can't be fetched.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PagePreview } from '@/components/page-preview'
import { cn } from '@/lib/utils'

type Entry = { state: 'ready'; html: string } | { state: 'none' }
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<Entry>>()
/** Previews that have drawn once: a remount (tab or filter switch) shows them without fading in again. */
const drawn = new Set<string>()

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
export const forgetPreview = (id: string) => { cache.delete(id); drawn.delete(id) }

/** A quiet stand-in while a page's look is on its way: never the kind cover. */
export function NeutralPlaceholder({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('aspect-[3/2] w-full animate-pulse bg-muted', className)} />
}

export function LivePreview({ id, title, fallback, enabled = true, onVisible }: {
  id: string; title: string; fallback: ReactNode; enabled?: boolean
  /** Called once when the tile first comes into view (to ask for a screenshot). */
  onVisible?: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [entry, setEntry] = useState<Entry | undefined>(() => cache.get(id))
  const [shown, setShown] = useState(() => drawn.has(id))
  const instant = useRef(drawn.has(id)).current

  useEffect(() => {
    if (!enabled) return
    const el = box.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((items) => {
      if (!items.some((i) => i.isIntersecting)) return
      io.disconnect()
      onVisible?.()
      if (!cache.has(id)) void loadPreview(id).then((e) => { if (alive) setEntry(e) })
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [id, enabled, onVisible])

  if (!enabled || entry?.state === 'none') return <>{fallback}</>
  const ready = entry?.state === 'ready'
  return (
    <div ref={box} className="relative">
      <NeutralPlaceholder className={cn(ready && shown && 'invisible')} />
      {ready && (
        <div className={cn('absolute inset-0', !instant && 'transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')}>
          <PagePreview page={{ title, html: entry.html }} scripts onLoad={() => { drawn.add(id); setShown(true) }} className="h-full" />
        </div>
      )}
    </div>
  )
}
