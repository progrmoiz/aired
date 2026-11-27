// Views per day as small bars, for the Pages summary. Plain markup on the
// tokens: no chart library. Neutral bars; the hovered or focused day is
// drawn in full and named above the chart.
import { useState, type KeyboardEvent } from 'react'
import { dayWords, rangeWords, type Report } from '@/lib/analytics'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ViewsChart({ days, height = 'h-44', compact = false }: { days: Report['days']; height?: string; compact?: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...days.map((d) => d.views))
  const total = days.reduce((n, d) => n + d.views, 0)
  const cur = active === null ? null : days[active]
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setActive((i) => {
      const from = i ?? (e.key === 'ArrowLeft' ? days.length : -1)
      return Math.min(days.length - 1, Math.max(0, from + (e.key === 'ArrowLeft' ? -1 : 1)))
    })
  }
  return (
    <div className="grid gap-3">
      {!compact && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {cur ? <><span className="text-foreground tabular-nums">{plural(cur.views, 'view')}</span> on {dayWords(cur.day)}</> : <>{rangeWords(days)}</>}
        </p>
      )}
      <div
        role="img"
        aria-label={`${plural(total, 'view')} from ${rangeWords(days)}. Use the arrow keys to read each day.`}
        tabIndex={compact ? -1 : 0}
        onKeyDown={compact ? undefined : onKey}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className={cn('flex items-end rounded-md outline-offset-4', days.length > 40 ? 'gap-px' : 'gap-[3px]', height)}
      >
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={compact ? undefined : () => setActive(i)}>
            <div
              className={cn(
                'w-full rounded-t-[3px] transition-colors duration-150',
                d.views === 0 ? 'h-px bg-hairline-strong' : active === i ? 'bg-foreground' : active === null ? 'bg-foreground/35' : 'bg-foreground/20',
              )}
              style={d.views === 0 ? undefined : { height: `${Math.max(3, (d.views / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      {!compact && days.length > 0 && (
        <div className="flex justify-between text-xs text-subtle tabular-nums" aria-hidden="true">
          <span>{dayWords(days[0]!.day)}</span>
          <span>Today</span>
        </div>
      )}
    </div>
  )
}
