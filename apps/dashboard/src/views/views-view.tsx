// #views: views over time, countries and where people came from, for all
// pages or one (#views/<id>). Pro only; Free sees a locked preview drawn
// from fixed sample numbers, plus the total view count it keeps.
import { useState } from 'react'
import { ArrowLeftIcon, ChartColumnIcon, ExternalLinkIcon, LockIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import { ViewHeader } from '@/components/common'
import { TopList, ViewsChart } from '@/components/views-chart'
import type { PagesState } from '@/App'
import { RANGES, type Range, type Report, countryName, sampleReport, sourceName, useAnalytics } from '@/lib/analytics'
import { plural, viewsOf } from '@/lib/format'
import { cn } from '@/lib/utils'

const UPGRADE = '/pricing?ref=dashboard-views'

export function ViewsView({ pageId, pages }: { pageId: string; pages: PagesState }) {
  const [range, setRange] = useState<Range>(30)
  const [state, retry] = useAnalytics(pageId, range)
  const ready = pages.status === 'ready' ? pages : null
  const page = pageId ? ready?.pages.find((p) => p.id === pageId) : undefined
  const report = state.status === 'ready' ? state.report : null
  const allTime = pageId ? (page ? viewsOf(page) : null) : ready ? ready.pages.reduce((n, p) => n + viewsOf(p), 0) : null
  const title = pageId ? page?.title || report?.page?.title || 'Untitled page' : 'Views'

  const description = pageId ? (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a href="#views" className="inline-flex items-center gap-1.5 hover:text-foreground"><ArrowLeftIcon className="size-3.5" />All your pages</a>
      <a href={`/p/${pageId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[13px] hover:text-foreground">
        {window.location.host}/p/{pageId}<ExternalLinkIcon className="size-3.5" />
      </a>
    </span>
  ) : 'How many people open your pages, where they are, and how they found the link.'

  const rangePicker = state.status !== 'locked' && state.status !== 'missing' && (
    <ToggleGroup aria-label="Time range" variant="segment" spacing={1} value={[String(range)]}
      onValueChange={(v: unknown[]) => { if (v.length) setRange(Number(v[0]) as Range) }} className="w-full rounded-xl bg-tint p-1 sm:w-72">
      {RANGES.map((r) => <ToggleGroupItem key={r} value={String(r)}>{r} days</ToggleGroupItem>)}
    </ToggleGroup>
  )

  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title={title} description={description} action={rangePicker} />
      {state.status === 'loading' && <LoadingReport />}
      {state.status === 'ready' && <ReportBody report={state.report} allTime={allTime} perPage={!!pageId} />}
      {state.status === 'locked' && <LockedPreview range={range} allTime={allTime} perPage={!!pageId} />}
      {state.status === 'missing' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">This page isn’t in your account.</p>
          <a href="#views" className={buttonVariants({ variant: 'outline' })}>See all your pages</a>
        </Card>
      )}
      {state.status === 'unavailable' && (
        <Card className="gap-1 px-5 py-5">
          <p className="text-[15px] font-medium">Your numbers will show up here soon</p>
          <p className="text-sm text-subtle">Views are being counted. This page fills in once they’re ready to read.</p>
        </Card>
      )}
      {state.status === 'error' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">Could not load the numbers.</p>
          <Button variant="outline" onClick={retry}>Try again</Button>
        </Card>
      )}
    </div>
  )
}

function ReportBody({ report, allTime, perPage }: { report: Report; allTime: number | null; perPage: boolean }) {
  const topCountry = report.countries[0]
  const topSource = report.referrers[0]
  return (
    <>
      <Card className="grid grid-cols-2 gap-0 py-0 sm:grid-cols-4">
        <Stat label={`Last ${report.range} days`} value={report.total.toLocaleString()} sub={report.total === 1 ? 'view' : 'views'} />
        <Stat label="All time" value={allTime === null ? '—' : allTime.toLocaleString()} sub={allTime === 1 ? 'view' : 'views'} />
        <Stat label="Most viewers from" value={topCountry ? countryName(topCountry.code) : '—'} sub={topCountry ? plural(topCountry.views, 'view') : 'No views yet'} />
        <Stat label="Most came from" value={topSource ? sourceName(topSource.host) : '—'} sub={topSource ? plural(topSource.views, 'view') : 'No views yet'} />
      </Card>

      <Card className="gap-4 px-5 py-5">
        <h2 className="text-[15px] font-medium">Views each day</h2>
        <ViewsChart days={report.days} />
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <TopList title="Countries" total={report.total} empty="No views in this time yet."
          rows={report.countries.map((c) => ({ key: c.code, label: countryName(c.code), views: c.views }))} />
        <div className="grid content-start gap-2">
          <TopList title="Where people came from" total={report.total} empty="No views in this time yet."
            rows={report.referrers.map((r) => ({ key: r.host || 'direct', label: sourceName(r.host), title: r.host || undefined, views: r.views }))} />
          <p className="px-1 text-xs text-subtle">Chat and email apps often don’t say where a click came from, so those show as “Direct or an app”.</p>
        </div>
      </div>

      {!perPage && report.pages && (
        <TopList title="Most viewed pages" total={report.total} empty="None of your pages were opened in this time."
          rows={report.pages.map((p) => ({ key: p.id, label: p.title || 'Untitled page', views: p.views, href: `#views/${p.id}` }))} />
      )}
      <p className="text-xs text-subtle">Days are in UTC. A new view can take a minute or two to show up.</p>
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 border-border px-5 py-4 not-first:border-l max-sm:nth-3:border-l-0 max-sm:nth-[n+3]:border-t">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 truncate text-xl font-medium tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-subtle">{sub}</p>
    </div>
  )
}

function LockedPreview({ range, allTime, perPage }: { range: Range; allTime: number | null; perPage: boolean }) {
  return (
    <div className="relative">
      <div aria-hidden="true" inert className="pointer-events-none grid select-none gap-5 opacity-50 blur-[3px]">
        <ReportBody report={sampleReport(range)} allTime={null} perPage />
      </div>
      <div className="absolute inset-0 flex items-start justify-center px-4 pt-10 sm:pt-24">
        <Card variant="panel" className="w-full max-w-md gap-4 bg-popover px-6 py-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-lg border border-input bg-background"><LockIcon className="size-[18px]" /></span>
          <div className="grid gap-1.5">
            <h2 className="text-lg font-medium">See who opens {perPage ? 'this page' : 'your pages'}</h2>
            <p className="text-sm text-muted-foreground">Pro shows how many people open {perPage ? 'it' : 'each page'} every day, which countries they’re in, and where they found the link.</p>
          </div>
          <a href={UPGRADE} className={cn(buttonVariants({ size: 'lg' }), 'mx-auto px-5')}><ChartColumnIcon />See Pro</a>
          <p className="text-xs text-subtle">
            {!allTime ? 'Free keeps the total view count.' : <>{perPage ? 'This page has' : 'Your pages have'} {plural(allTime, 'view')} in all. That count stays free.</>}
          </p>
        </Card>
      </div>
    </div>
  )
}

function LoadingReport() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading views">
      <Skeleton className="h-[88px] rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid gap-5 md:grid-cols-2"><Skeleton className="h-56 rounded-xl" /><Skeleton className="h-56 rounded-xl" /></div>
    </div>
  )
}
