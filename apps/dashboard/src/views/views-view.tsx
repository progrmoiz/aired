// #views: views over time, countries and where people came from, for all
// pages or one (#views/<id>). Pro only; Free sees the same page, blurred,
// drawn from fixed sample numbers, plus the total view count it keeps.
import { useState } from 'react'
import {
  ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, ChartColumnIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, GlobeIcon, LockIcon,
  MailIcon, MessageSquareIcon, MousePointerClickIcon, SearchIcon, SparklesIcon, UsersIcon, type LucideIcon,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ViewHeader } from '@/components/common'
import { AreaChart } from '@/components/area-chart'
import { RankedCard } from '@/components/ranked-card'
import { CountryFlag, SourceIcon } from '@/components/source-icon'
import type { PagesState } from '@/App'
import {
  MAX_DAYS, RANGES, type Range, type Report, changePercent, countryName, dayWords, sampleReport, shortDay, sourceName, useAnalytics,
} from '@/lib/analytics'
import { SOURCE_TYPES, type SourceType, viewsByType } from '@/lib/sources'
import { plural, viewsOf } from '@/lib/format'
import { cn } from '@/lib/utils'

const UPGRADE = '/pricing?ref=dashboard-views'

const TYPE_ICONS: Record<SourceType, LucideIcon> = {
  direct: MousePointerClickIcon, chat: MessageSquareIcon, email: MailIcon, search: SearchIcon, social: UsersIcon, ai: SparklesIcon, web: GlobeIcon,
}

export function ViewsView({ pageId, pages }: { pageId: string; pages: PagesState }) {
  const [range, setRangeState] = useState<Range>(30)
  const [offset, setOffset] = useState(0)
  const setRange = (r: Range) => { setRangeState(r); setOffset(0) }
  const [state, retry] = useAnalytics(pageId, range, offset)
  const ready = pages.status === 'ready' ? pages : null
  const page = pageId ? ready?.pages.find((p) => p.id === pageId) : undefined
  const report = state.status === 'ready' ? state.report : null
  const allTime = pageId ? (page ? viewsOf(page) : null) : ready ? ready.pages.reduce((n, p) => n + viewsOf(p), 0) : null
  const title = pageId ? page?.title || report?.page?.title || 'Untitled page' : 'Views'
  const canBack = (offset + 2) * range <= MAX_DAYS

  const description = pageId ? (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a href="#views" className="inline-flex items-center gap-1.5 hover:text-foreground"><ArrowLeftIcon className="size-3.5" />All your pages</a>
      <a href={`/p/${pageId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[13px] hover:text-foreground">
        {window.location.host}/p/{pageId}<ExternalLinkIcon className="size-3.5" />
      </a>
    </span>
  ) : 'How many people open your pages, where they are, and how they found the link.'

  const picker = state.status !== 'locked' && state.status !== 'missing' && (
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      <Button variant="outline" size="icon-lg" aria-label={`Previous ${range} days`} disabled={!canBack} onClick={() => setOffset((o) => o + 1)}><ChevronLeftIcon /></Button>
      <ToggleGroup aria-label="Time range" variant="segment" spacing={1} value={[String(range)]}
        onValueChange={(v: unknown[]) => { if (v.length) setRange(Number(v[0]) as Range) }} className="flex-1 rounded-xl bg-tint p-1 sm:w-64 sm:flex-none">
        {RANGES.map((r) => <ToggleGroupItem key={r} value={String(r)}>{r} days</ToggleGroupItem>)}
      </ToggleGroup>
      <Button variant="outline" size="icon-lg" aria-label={`Next ${range} days`} disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))}><ChevronRightIcon /></Button>
    </div>
  )

  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title={title} description={description} action={picker} />
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
  const change = changePercent(report.total, report.previousTotal)
  const first = report.days[0]?.day ?? ''
  const last = report.days[report.days.length - 1]?.day ?? ''
  const windowLabel = report.offset === 0 ? `Last ${report.range} days` : `${shortDay(first)} – ${shortDay(last)}`
  const types = viewsByType(report.referrers, report.total)
  return (
    <>
      <Card className="gap-0 py-0">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-border px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label={windowLabel} value={report.total.toLocaleString()}
            sub={change === null ? <span className="text-subtle">{report.total === 1 ? 'view' : 'views'}</span> : <Change pct={change} range={report.range} />} />
          <Kpi label="Busiest day" value={report.peak ? report.peak.views.toLocaleString() : '—'} sub={report.peak ? dayWords(report.peak.day) : 'No views yet'} />
          <Kpi name label="Most viewers from" value={topCountry ? countryName(topCountry.code) : '—'} icon={topCountry && <CountryFlag code={topCountry.code} />}
            sub={topCountry ? plural(topCountry.views, 'view') : 'No views yet'} />
          <Kpi name label="Most came from" value={topSource ? sourceName(topSource.host) : '—'} icon={topSource && <SourceIcon host={topSource.host} icon={report.icons?.[topSource.host]} />}
            sub={topSource ? plural(topSource.views, 'view') : 'No views yet'} />
          <Kpi label="All time" value={allTime === null ? '—' : allTime.toLocaleString()} sub={allTime === 1 ? 'view' : 'views'} />
        </div>
        <div className="px-3 pt-2 pb-3 sm:px-4">
          <AreaChart days={report.days} peak={report.peak} icon={report.peak ? report.icons?.[report.peak.host] : undefined} current={report.offset === 0} />
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <RankedCard label="Sources" total={report.total} tabs={[
            {
              key: 'site', label: 'Site or app', empty: 'No views in this time yet.',
              rows: report.referrers.map((r) => ({ key: r.host || 'direct', label: sourceName(r.host), title: r.host || undefined, views: r.views, icon: <SourceIcon host={r.host} icon={report.icons?.[r.host]} /> })),
            },
            {
              key: 'type', label: 'Type', empty: 'No views in this time yet.',
              rows: types.map((t) => {
                const Icon = TYPE_ICONS[t.type]
                return { key: t.type, label: SOURCE_TYPES[t.type], views: t.views, icon: <span className="grid size-[18px] place-items-center rounded-[5px] bg-muted text-muted-foreground ring-1 ring-foreground/10"><Icon className="size-[11px]" strokeWidth={2.4} /></span> }
              }),
            },
          ]} />
          <p className="px-1 text-xs text-subtle">Chat and email apps often don’t say where a click came from, so those show as “Direct or an app”.</p>
        </div>
        <RankedCard label="Countries" total={report.total} tabs={[{
          key: 'country', label: 'Countries', empty: 'No views in this time yet.',
          rows: report.countries.map((c) => ({ key: c.code, label: countryName(c.code), views: c.views, icon: <CountryFlag code={c.code} /> })),
        }]} />
      </div>

      {!perPage && report.pages && (
        <RankedCard label="Pages" total={report.total} tabs={[{
          key: 'pages', label: 'Most viewed pages', empty: 'None of your pages were opened in this time.',
          rows: report.pages.map((p) => ({ key: p.id, label: p.title || 'Untitled page', views: p.views, href: `#views/${p.id}` })),
        }]} />
      )}
      <p className="text-xs text-subtle">Days are in UTC. A new view can take a minute or two to show up. Numbers are kept for three months.</p>
    </>
  )
}

function Change({ pct, range }: { pct: number; range: number }) {
  if (pct === 0) return <span className="text-subtle" title={`Compared with the ${range} days before`}>Same as the {range} days before</span>
  const up = pct > 0
  const Icon = up ? ArrowUpIcon : ArrowDownIcon
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', up ? 'text-ok' : 'text-destructive')} title={`Compared with the ${range} days before`}>
      <Icon className="size-3" strokeWidth={2.6} />{Math.abs(pct)}%<span className="sr-only"> {up ? 'more' : 'fewer'} than the {range} days before</span>
    </span>
  )
}

function Kpi({ label, value, sub, icon, name = false }: { label: string; value: string; sub: React.ReactNode; icon?: React.ReactNode; name?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-subtle">{label}</p>
      <p className={cn('mt-1 flex min-h-7 min-w-0 items-center gap-2 font-medium tracking-tight tabular-nums', name ? 'text-[15px] sm:text-xl' : 'text-xl')} title={value}>{icon}<span className="truncate">{value}</span></p>
      <p className="truncate text-xs text-subtle">{sub}</p>
    </div>
  )
}

function LockedPreview({ range, allTime, perPage }: { range: Range; allTime: number | null; perPage: boolean }) {
  return (
    <div className="relative">
      <div aria-hidden="true" inert className="pointer-events-none grid select-none gap-5 opacity-60 blur-[2.5px]">
        <ReportBody report={sampleReport(range)} allTime={null} perPage />
      </div>
      <div className="absolute inset-0 flex items-start justify-center px-4 pt-10 sm:pt-28">
        <Card variant="panel" className="w-full max-w-md gap-4 bg-popover px-6 py-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-lg border border-input bg-background"><LockIcon className="size-[18px]" /></span>
          <div className="grid gap-1.5">
            <h2 className="text-lg font-medium">See who opens {perPage ? 'this page' : 'your pages'}</h2>
            <p className="text-sm text-muted-foreground">Pro shows how many people open {perPage ? 'it' : 'each page'} every day, which countries they’re in, and which apps and sites sent them.</p>
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
      <Skeleton className="h-[380px] rounded-xl" />
      <div className="grid gap-5 md:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
    </div>
  )
}
