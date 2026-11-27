// Views per day as a smooth area line, drawn in the text colour so it reads
// in every theme. The busiest day carries the icon of where most of its
// views came from. Hover, or focus and use the arrow keys, to read a day.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { SourceIcon } from '@/components/source-icon'
import { dayWords, shortDay, sourceName, type Report } from '@/lib/analytics'
import { plural } from '@/lib/format'

const PAD = { left: 36, right: 12, top: 34, bottom: 26 }

/** 0, then a round number at or above `max` (1, 2 or 5 × 10ⁿ). */
function niceMax(max: number): number {
  if (max <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}

/** A monotone cubic path through the points (Fritsch–Carlson): smooth, never overshoots below zero. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`
  const dx: number[] = [], slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0])
    slope.push((pts[i + 1]![1] - pts[i]![1]) / dx[i]!)
  }
  const t: number[] = [slope[0]!]
  for (let i = 1; i < n - 1; i++) t.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2)
  t.push(slope[n - 2]!)
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i]! / slope[i]!, b = t[i + 1]! / slope[i]!, h = Math.hypot(a, b)
    if (h > 3) { t[i] = (3 * a * slope[i]!) / h; t[i + 1] = (3 * b * slope[i]!) / h }
  }
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = dx[i]! / 3
    d += `C${x0 + h},${y0 + t[i]! * h} ${x1 - h},${y1 - t[i + 1]! * h} ${x1},${y1}`
  }
  return d
}

export function AreaChart({ days, peak, icon, current }: { days: Report['days']; peak: Report['peak']; icon?: string; current: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const height = width < 520 ? 210 : 260
  const max = niceMax(Math.max(0, ...days.map((d) => d.views)))
  const innerW = Math.max(1, width - PAD.left - PAD.right)
  const innerH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (days.length <= 1 ? innerW / 2 : (i * innerW) / (days.length - 1))
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const pts = days.map((d, i) => [x(i), y(d.views)] as [number, number])
  const line = smoothPath(pts)
  const base = PAD.top + innerH
  const area = pts.length ? `${line}L${pts[pts.length - 1]![0]},${base}L${pts[0]![0]},${base}Z` : ''
  const peakIndex = peak ? days.findIndex((d) => d.day === peak.day) : -1
  const total = days.reduce((n, d) => n + d.views, 0)
  const cur = active === null ? null : days[active]

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - PAD.left) / innerW) * (days.length - 1))
    setActive(Math.min(days.length - 1, Math.max(0, i)))
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setActive((i) => {
      const from = i ?? (e.key === 'ArrowLeft' ? days.length : -1)
      return Math.min(days.length - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1)))
    })
  }

  return (
    <div className="grid gap-1">
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {cur ? <><span className="text-foreground tabular-nums">{plural(cur.views, 'view')}</span> on {dayWords(cur.day)}</> : null}
      </p>
      <div
        ref={box}
        role="img"
        aria-label={`${plural(total, 'view')}, ${shortDay(days[0]?.day ?? '')} to ${shortDay(days[days.length - 1]?.day ?? '')}.${peak ? ` Busiest: ${dayWords(peak.day)}, ${plural(peak.views, 'view')}, mostly from ${sourceName(peak.host)}.` : ''} Use the arrow keys to read each day.`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className="relative rounded-md text-foreground outline-offset-4 select-none"
        style={{ height }}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id="views-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" strokeOpacity={f === 0 ? 0.14 : 0.07} strokeDasharray={f === 0 ? undefined : '3 4'} />
                <text x={PAD.left - 8} y={y(max * f) + 4} textAnchor="end" className="fill-subtle text-[11px] tabular-nums">{(max * f).toLocaleString()}</text>
              </g>
            ))}
            <path d={area} fill="url(#views-fill)" />
            <path d={line} fill="none" stroke="currentColor" strokeOpacity="0.75" strokeWidth="1.75" strokeLinejoin="round" />
            {peakIndex >= 0 && (
              <g>
                <line x1={x(peakIndex)} x2={x(peakIndex)} y1={y(days[peakIndex]!.views) - 4} y2={Math.max(PAD.top - 12, y(days[peakIndex]!.views) - 22)} stroke="currentColor" strokeOpacity="0.3" />
                <circle cx={x(peakIndex)} cy={y(days[peakIndex]!.views)} r="3" className="fill-background" stroke="currentColor" strokeWidth="1.5" />
              </g>
            )}
            {active !== null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD.top - 6} y2={base} stroke="currentColor" strokeOpacity="0.25" />
                <circle cx={x(active)} cy={y(days[active]!.views)} r="4" fill="currentColor" className="stroke-background" strokeWidth="2" />
              </g>
            )}
            <text x={PAD.left} y={height - 6} className="fill-subtle text-[11px]">{shortDay(days[0]?.day ?? '')}</text>
            {days.length > 14 && <text x={x(Math.floor((days.length - 1) / 2))} y={height - 6} textAnchor="middle" className="fill-subtle text-[11px]">{shortDay(days[Math.floor((days.length - 1) / 2)]!.day)}</text>}
            <text x={width - PAD.right} y={height - 6} textAnchor="end" className="fill-subtle text-[11px]">{current ? 'Today' : shortDay(days[days.length - 1]?.day ?? '')}</text>
          </svg>
        )}
        {width > 0 && peak && peakIndex >= 0 && (
          <span
            className="absolute -translate-x-1/2"
            style={{ left: x(peakIndex), top: Math.max(PAD.top - 12, y(days[peakIndex]!.views) - 22) - 20 }}
            title={`Busiest day: ${dayWords(peak.day)}, ${plural(peak.views, 'view')}, mostly from ${sourceName(peak.host)}`}
          >
            <SourceIcon host={peak.host} icon={icon} className="size-5 rounded-md" />
          </span>
        )}
      </div>
    </div>
  )
}
