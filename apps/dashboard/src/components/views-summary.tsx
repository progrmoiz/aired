// The Pages view's one-line summary for Pro: views in the last 7 days, a
// small chart, and a link to #views. Shows nothing until there's a report.
import { ChevronRightIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { ViewsChart } from '@/components/views-chart'
import { countryName, sourceName, useAnalytics } from '@/lib/analytics'
import { plural } from '@/lib/format'

export function ViewsSummary() {
  const [state] = useAnalytics('', 7)
  if (state.status !== 'ready') return null
  const r = state.report
  const country = r.countries[0]
  const source = r.referrers[0]
  return (
    <a href="#views" className="group block rounded-xl" aria-label={`${plural(r.total, 'view')} in the last 7 days. See views`}>
      <Card className="flex-row items-center gap-5 px-5 py-3.5 transition-shadow group-hover:ring-hairline-strong">
        <div className="shrink-0">
          <p className="text-xs text-subtle">Last 7 days</p>
          <p className="text-lg font-medium tracking-tight tabular-nums">{plural(r.total, 'view')}</p>
        </div>
        <div className="w-24 shrink-0 sm:w-36"><ViewsChart days={r.days} height="h-9" compact /></div>
        {(country || source) && (
          <p className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">
            {country && <>Most from {countryName(country.code)}</>}
            {country && source && ' · '}
            {source && <>{source.host ? 'mostly via ' + sourceName(source.host) : 'mostly direct or from apps'}</>}
          </p>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-sm text-muted-foreground group-hover:text-foreground">See views<ChevronRightIcon className="size-4" /></span>
      </Card>
    </a>
  )
}
