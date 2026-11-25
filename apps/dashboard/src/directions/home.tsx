// Direction B: Home. A warm home screen: a greeting, one big "Publish
// something" card, what got opened today, and recent pages as rich cards.
// Settings and billing live in the avatar menu. It runs on the "warm" token
// set (data-theme="warm"), which would re-skin the marketing site too.
import { useEffect } from 'react'
import { ClipboardPasteIcon, SparklesIcon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AccountMenu } from '@/components/account-menu'
import { ClaudeMark } from '@/components/brand'
import { Eyebrow } from '@/components/common'
import { MeterRow } from '@/components/meter-row'
import { PagePreview } from '@/components/page-preview'
import { PageSummaryCard } from '@/components/page-summary-card'
import { TopBar } from '@/components/top-bar'
import { PAGES, USER, origin } from './data'
import { cn } from '@/lib/utils'

/** Switch the whole page to the warm token set while this view is up. */
function useWarmTheme() {
  useEffect(() => {
    const html = document.documentElement
    html.dataset.theme = 'warm'
    html.classList.remove('dark')
    return () => { delete html.dataset.theme; html.classList.add('dark') }
  }, [])
}

function PublishCard({ big }: { big?: boolean }) {
  return (
    <Card variant="hero" aria-label="Publish something" className="gap-0 p-6 sm:p-8">
      <Eyebrow>Publish something</Eyebrow>
      <h2 className={cn('mt-1.5 font-medium tracking-tight', big ? 'text-title' : 'text-heading')}>Got a page from Claude or ChatGPT?</h2>
      <div className={cn('mt-5 grid place-items-center rounded-2xl border-2 border-dashed border-hairline-strong bg-tint text-center', big ? 'py-14' : 'py-9')}>
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><UploadIcon className="size-5" /></span>
        <p className="mt-3 text-md font-medium">Drop the file here</p>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-1 text-base text-muted-foreground">
          or <Button variant="link" className="h-auto p-0 text-base text-foreground underline decoration-hairline-strong">choose one</Button> ·
          <Button variant="link" className="h-auto gap-1 p-0 text-base text-foreground underline decoration-hairline-strong"><ClipboardPasteIcon />paste the code</Button>
        </p>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><ClaudeMark className="size-3.5" />Or just ask Claude: “publish this with aired”.
        <Button variant="link" className="h-auto p-0 text-sm text-foreground underline decoration-hairline-strong">Set it up</Button></p>
    </Card>
  )
}

export function HomeDirection({ empty }: { empty: boolean }) {
  useWarmTheme()
  const opened = [...PAGES].sort((a, b) => b.today - a.today).slice(0, 4)
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar className="static border-transparent bg-transparent backdrop-blur-none" right={<>
        <Button shape="pill" size="lg" className="hidden px-4 sm:inline-flex"><UploadIcon />Publish</Button>
        <AccountMenu name={USER.first} plan={USER.plan} initial={USER.initial} defaultOpen={empty} />
      </>} />
      <main className="mx-auto max-w-(--aired-page-max) px-5 pt-4 pb-24 sm:px-8 sm:pt-8">
        <h1 className="text-display leading-tight font-medium tracking-tight">{empty ? `Welcome, ${USER.first}` : `Good morning, ${USER.first}`}</h1>
        <p className="mt-2 text-lg text-muted-foreground">{empty ? 'Let’s put your first page online. It takes about ten seconds.' : <>Your pages were opened <b className="font-semibold text-foreground">50 times</b> since yesterday.</>}</p>

        {empty ? (
          <>
            <div className="mt-8"><PublishCard big /></div>
            <h2 className="mt-14 text-subheading font-medium tracking-tight">What people share with aired</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {[PAGES[0], PAGES[1], PAGES[3]].map((p, i) => (
                <Card key={p.id} variant="panel" className="gap-0 rounded-3xl py-0">
                  <PagePreview page={p} />
                  <div className="p-4"><p className="text-body font-medium">{['Workout plans', 'Class quizzes', 'Client reports'][i]}</p><p className="text-sm text-muted-foreground">{['Send clients their week.', 'Share a quiz with one link.', 'Progress, without a PDF.'][i]}</p></div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
              <PublishCard />
              <Card variant="hero" aria-label="Opened today" className="gap-0 p-6 sm:p-8">
                <p className="flex items-center gap-1.5 text-sm font-medium text-ok"><SparklesIcon className="size-3.5" />Opened today</p>
                <h2 className="mt-1.5 text-heading font-medium tracking-tight">Your busiest pages</h2>
                <ul className="mt-5 grid gap-4">{opened.map((p) => <MeterRow key={p.id} label={p.title} value={p.today} max={opened[0].today} />)}</ul>
              </Card>
            </div>
            <div className="mt-14 flex items-end justify-between">
              <h2 className="text-heading font-medium tracking-tight">Recent pages</h2>
              <Button variant="link" className="h-auto p-0 text-base text-muted-foreground underline decoration-hairline-strong">See all {PAGES.length}</Button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">{PAGES.map((p) => <PageSummaryCard key={p.id} page={p} owner={p.owner} origin={origin} />)}</div>
          </>
        )}
      </main>
    </div>
  )
}
