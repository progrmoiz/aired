// The two themes for the mockups, and a floating bar to switch between them
// and jump between mock screens. The choice lives in the URL (?style=) so a link shows
// the same thing to whoever opens it.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const STYLES = [
  { id: 'midnight', label: 'Midnight', dark: true, swatch: ['#0a0a0b', '#ededef'] },
  { id: 'daylight', label: 'Daylight', dark: false, swatch: ['#f7f7f8', '#111113'] },
] as const

export type StyleId = (typeof STYLES)[number]['id']

const listeners = new Set<() => void>()
/** Read or replace one URL parameter without a reload (null removes it). */
export function setParam(key: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  window.history.replaceState(null, '', url)
  listeners.forEach((l) => l())
}

export function useParam(key: string) {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => new URLSearchParams(window.location.search).get(key),
  )
}

/** The current style (fallback per direction), applied to <html> while mounted. */
export function useStyle(fallback: StyleId): StyleId {
  const raw = useParam('style')
  const style = STYLES.some((s) => s.id === raw) ? (raw as StyleId) : fallback
  useEffect(() => {
    const html = document.documentElement
    const def = STYLES.find((s) => s.id === style)!
    if (style === 'midnight') delete html.dataset.theme
    else html.dataset.theme = style
    html.classList.toggle('dark', def.dark)
    return () => { delete html.dataset.theme; html.classList.add('dark') }
  }, [style])
  return style
}

/** Floating mockup controls: the style swatches, plus anything a direction adds. */
export function StyleBar({ style, children }: { style: StyleId; children?: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Mockup controls" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 print:hidden">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-popover/95 p-1.5 text-sm shadow-pop ring-1 ring-hairline-strong backdrop-blur-md">
        <span className="hidden px-2.5 text-xs font-medium text-subtle sm:inline">Style</span>
        {STYLES.map((s) => (
          <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setParam('style', s.id)}
            className={cn('flex h-8 shrink-0 items-center gap-2 rounded-full px-2.5 text-muted-foreground transition-colors hover:text-foreground', style === s.id && 'bg-tint text-foreground ring-1 ring-hairline-strong')}>
            <span aria-hidden="true" className="relative size-4 overflow-hidden rounded-full ring-1 ring-hairline-strong" style={{ background: s.swatch[0] }}>
              <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: s.swatch[1] }} />
            </span>
            <span className="hidden md:inline">{s.label}</span>
            <span className="sr-only md:hidden">{s.label}</span>
          </button>
        ))}
        {children && <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-hairline-strong" />}
        {children}
      </div>
    </div>
  )
}

/** A text button for the bar (jump to a screen in the mockup). */
export function BarButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn('h-8 shrink-0 rounded-full px-3 text-muted-foreground transition-colors hover:text-foreground', active && 'bg-primary text-primary-foreground hover:text-primary-foreground')}>
      {children}
    </button>
  )
}
