// A deck's slides as a bar chart: one row per slide, the bar sized by how
// many people reached it, the median time on it at the end, and the slide
// where the most people stopped marked in words and an icon (not colour
// alone). Hover or focus a row to read it in full above the chart. Shown on
// #views/<id> for decks only (lib/slides.ts says when it isn't one).
import { useState } from 'react'
import { ArrowDownIcon, LockIcon, PresentationIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Range } from '@/lib/analytics'
import { people, sampleSlides, secondsWords, useSlides, type SlideReport, type SlideRow } from '@/lib/slides'
import { cn } from '@/lib/utils'

const UPGRADE = '/pricing?ref=dashboard-slides'
const SHOWN = 12

export function SlideCard({ pageId, range, offset }: { pageId: string; range: Range; offset: number }) {
  const [state, retry] = useSlides(pageId, range, offset)
  if (state.status === 'none') return null
  if (state.status === 'loading') return <Skeleton className="h-72 rounded-xl" aria-label="Loading slides" />
  if (state.status === 'locked') return <LockedSlides />
  if (state.status === 'unavailable') {
    return (
      <Card className="gap-1 px-5 py-5">
        <p className="text-[15px] font-medium">Slide numbers will show up here soon</p>
        <p className="text-sm text-subtle">Slides are being counted. This fills in once the numbers are ready to read.</p>
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-muted-foreground">Could not load the slide numbers.</p>
        <Button variant="outline" onClick={retry}>Try again</Button>
      </Card>
    )
  }
  return <SlideChart report={state.report} />
}

function SlideChart({ report }: { report: SlideReport }) {
  const [active, setActive] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const max = Math.max(1, ...report.slides.map((s) => s.reached))
  const rows = open ? report.slides : report.slides.slice(0, SHOWN)
  const cur = active === null ? null : report.slides[active - 1] ?? null
  const empty = report.viewers === 0
  const pct = report.viewers > 0 ? Math.round((report.finished / report.viewers) * 100) : 0
  const drop = report.biggest_drop === null ? null : report.slides[report.biggest_drop - 1] ?? null

  return (
    <Card className="gap-0 px-0 py-0">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[14px] font-medium"><PresentationIcon className="size-4 text-muted-foreground" />Slides</h2>
        {!empty && (
          <p className="text-xs text-subtle tabular-nums">
            {people(report.viewers)} started · {report.finished.toLocaleString()} reached the end ({pct}%)
          </p>
        )}
      </div>

      {empty ? (
        <div className="grid gap-1 px-5 py-5">
          <p className="text-[15px] font-medium">No one has gone through this deck in this time yet</p>
          <p className="text-sm text-subtle">A slide counts once someone keeps it on screen for a second. Your own views don’t count.</p>
        </div>
      ) : (
        <div className="grid gap-2 px-2 pt-2 pb-3">
          <p className="min-h-5 px-2.5 text-sm text-muted-foreground" aria-live="polite">
            {cur ? <RowWords row={cur} total={report.slide_count} />
              : drop ? <>Most people stopped after slide {drop.slide}{drop.title ? <>: <span className="text-foreground">{drop.title}</span></> : null}</>
                : 'Nobody stopped early.'}
          </p>
          <div className="flex justify-between gap-3 px-2.5 text-xs text-subtle" aria-hidden="true">
            <span>Slide</span>
            <span className="flex gap-3"><span className="w-12 text-right">People</span><span className="w-16 text-right">Typical</span></span>
          </div>
          <ol className="grid gap-0.5" aria-label="People who reached each slide" onMouseLeave={() => setActive(null)}>
            {rows.map((s) => (
              <li key={s.slide}>
                <div
                  tabIndex={0}
                  onMouseEnter={() => setActive(s.slide)}
                  onFocus={() => setActive(s.slide)}
                  onBlur={() => setActive(null)}
                  title={`${people(s.reached)} reached slide ${s.slide}${s.drop_off ? `; ${s.drop_off.toLocaleString()} stopped here` : ''}`}
                  className="relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm outline-offset-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn('absolute inset-y-0 left-0 rounded-md transition-colors duration-150', active === s.slide ? 'bg-foreground/20' : 'bg-tint')}
                    style={{ width: `${Math.max(1.5, (s.reached / max) * 100)}%` }}
                  />
                  <span className="relative w-6 shrink-0 text-right text-xs text-subtle tabular-nums">{s.slide}</span>
                  <span className={cn('relative min-w-0 flex-1 truncate', !s.title && 'text-subtle')}>{s.title || `Slide ${s.slide}`}</span>
                  <span className="relative w-12 shrink-0 text-right tabular-nums text-foreground">{s.reached.toLocaleString()}</span>
                  <span className="relative w-16 shrink-0 text-right text-xs text-subtle tabular-nums">{secondsWords(s.median_seconds)}</span>
                </div>
                {drop && drop.slide === s.slide && s.drop_off !== null && (
                  <p className="flex items-center gap-1.5 px-2.5 py-1 pl-[42px] text-xs font-medium text-destructive">
                    <ArrowDownIcon className="size-3" strokeWidth={2.6} aria-hidden="true" />
                    {s.drop_off.toLocaleString()} stopped here, the biggest drop
                  </p>
                )}
              </li>
            ))}
          </ol>
          {report.slides.length > SHOWN && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="mx-auto flex h-8 items-center rounded-md px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:bg-tint hover:text-foreground">
              {open ? 'Show less' : `All ${report.slides.length} slides`}
            </button>
          )}
          <p className="px-2.5 text-xs text-subtle">Each time someone opens the deck counts once per slide they keep on screen for a second. “Typical” is the median time on a slide. Your own views don’t count.</p>
        </div>
      )}
    </Card>
  )
}

function RowWords({ row, total }: { row: SlideRow; total: number }) {
  return (
    <>
      Slide {row.slide} of {total}: <span className="text-foreground tabular-nums">{people(row.reached)}</span>
      {row.median_seconds !== null && <>, typically {secondsWords(row.median_seconds)}</>}
      {row.drop_off ? <>, {row.drop_off.toLocaleString()} stopped here</> : null}
    </>
  )
}

function LockedSlides() {
  return (
    <div className="relative">
      <div aria-hidden="true" inert className="pointer-events-none select-none opacity-60 blur-[2.5px]">
        <SlideChart report={sampleSlides()} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <Card variant="panel" className="w-full max-w-sm gap-3 bg-popover px-5 py-5 text-center">
          <span className="mx-auto grid size-9 place-items-center rounded-lg border border-input bg-background"><LockIcon className="size-4" /></span>
          <div className="grid gap-1">
            <h2 className="text-base font-medium">See how far people get</h2>
            <p className="text-sm text-muted-foreground">Pro shows how many people reach each slide, how long they stay, and where they stop.</p>
          </div>
          <a href={UPGRADE} className={cn(buttonVariants(), 'mx-auto px-4')}>See Pro</a>
        </Card>
      </div>
    </div>
  )
}
