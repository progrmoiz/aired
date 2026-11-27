import { StarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewHeader } from '@/components/common'
import type { usePlan } from '@/hooks/use-plan'
import { cn } from '@/lib/utils'

const ROWS: [string, string, string][] = [
  ['aired badge on your pages', 'Shown', 'Off'],
  ['Biggest page', '2 MB', '10 MB'],
  ['How long pages last', '1 hour to never', 'Never expire'],
  ['Your own domain', '—', 'Soon'],
  ['Views by day, country and source', 'Total views', 'Yes'],
  ['Price', '$0', '$108 a year, or $12 a month'],
]

export function BillingView({ plan, runPlanAction, planButtonLabel }: ReturnType<typeof usePlan>) {
  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title="Plan & billing" description="Your plan, and what Pro adds. People you send links to never pay." />

      <Card className="gap-3 px-5 py-5" aria-label="Your plan" aria-live="polite">
        {!plan.loaded ? (
          <div className="flex items-center gap-4"><Skeleton className="size-10 rounded-lg" /><div className="grid gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" /></div></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg border border-input bg-background', plan.isPro && 'text-ok')}><StarIcon className="size-[18px]" /></span>
              <div className="min-w-[200px] flex-1">
                <p className="text-[15px] font-medium">{plan.label}</p>
                {plan.detail && <p className="text-[13px] text-subtle">{plan.detail}</p>}
              </div>
              {plan.mode && (
                <Button
                  variant={plan.mode === 'checkout' ? 'default' : 'outline'}
                  size="lg"
                  onClick={runPlanAction}
                  disabled={plan.state === 'pending'}
                  aria-busy={plan.state === 'pending' || undefined}
                >
                  {planButtonLabel}
                </Button>
              )}
            </div>
            {plan.mode === 'checkout' && <p className="pl-14 text-[12.5px] text-subtle max-sm:pl-0">Renews automatically until you cancel. Cancel anytime in Manage billing.</p>}
            {plan.state === 'error' && <p className="pl-14 text-[12.5px] text-destructive max-sm:pl-0" role="alert">{plan.error}</p>}
          </>
        )}
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <table className="w-full text-sm">
          <caption className="sr-only">Free and Pro compared</caption>
          <thead>
            <tr className="bg-white/[0.02] text-left text-xs text-muted-foreground">
              <th scope="col" className="px-5 py-3 font-medium"><span className="sr-only">Feature</span></th>
              <th scope="col" className="px-3 py-3 font-medium">Free</th>
              <th scope="col" className="px-3 py-3 font-medium text-foreground">Pro</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([f, free, pro]) => (
              <tr key={f} className="border-t border-border">
                <th scope="row" className="px-5 py-3 text-left font-normal text-muted-foreground">{f}</th>
                <td className="px-3 py-3 text-subtle">{free}</td>
                <td className="px-3 py-3 font-medium">{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[13px] text-subtle">
        Cancel anytime and keep Pro to the end of the period.{' '}
        <a className="text-muted-foreground underline decoration-input underline-offset-4 hover:text-foreground" href="/refunds">14-day refund</a> ·{' '}
        <a className="text-muted-foreground underline decoration-input underline-offset-4 hover:text-foreground" href="/pricing">Compare all plans</a> ·{' '}
        <a className="text-muted-foreground underline decoration-input underline-offset-4 hover:text-foreground" href="/terms">Terms</a>
      </p>
    </div>
  )
}
