// Direction C: Studio. A sharing tool, not a database: pick a page on the
// left, see it live in the middle, and every share control sits next to it.
import { ArrowLeftIcon, DownloadIcon, ExternalLinkIcon, LaptopIcon, PlusIcon, SearchIcon, SmartphoneIcon, TabletIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AccountMenu } from '@/components/account-menu'
import { BrowserFrame } from '@/components/browser-frame'
import { CopyButton } from '@/components/common'
import { IconAction } from '@/components/icon-action'
import { PageListItem } from '@/components/page-list-item'
import { PagePreview, QrPlaceholder } from '@/components/page-preview'
import { Segmented } from '@/components/segmented'
import { TopBar } from '@/components/top-bar'
import { PAGES, USER, host, origin, type MockPage } from './data'

function SizeSwitch() {
  return (
    <div className="hidden items-center gap-1 md:flex">
      <ToggleGroup aria-label="Preview size" spacing={1} defaultValue={['Laptop']}>
        {([[LaptopIcon, 'Laptop'], [TabletIcon, 'Tablet'], [SmartphoneIcon, 'Phone']] as const).map(([I, l]) => (
          <ToggleGroupItem key={l} value={l} aria-label={l} size="sm"><I /></ToggleGroupItem>
        ))}
      </ToggleGroup>
      <IconAction label="Open in a new tab"><ExternalLinkIcon /></IconAction>
    </div>
  )
}

function Share({ p }: { p: MockPage }) {
  return (
    <div className="grid gap-5">
      <Card variant="panel" aria-label="Share" className="gap-0 p-5">
        <h2 className="text-lg font-medium">Share</h2>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-hairline-strong bg-background py-1.5 pr-1.5 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{host}/p/{p.id}</span>
          <CopyButton text={`${origin}/p/${p.id}`} variant="secondary" ariaLabel="Copy link" className="bg-primary text-primary-foreground hover:bg-primary/85" />
        </div>
        <div className="mt-4 flex items-center gap-4">
          <QrPlaceholder seed={p.id} className="size-[92px] shrink-0 rounded-lg bg-white p-1.5" />
          <div className="text-sm text-muted-foreground">Show it on a screen or print it. Phones open the page straight away.
            <Button variant="link" className="mt-2 h-auto gap-1.5 p-0 text-sm text-foreground"><DownloadIcon />Download QR</Button></div>
        </div>
      </Card>
      <Card variant="panel" aria-label="Settings" className="gap-4 p-5">
        <Segmented label="Who can open it" items={['Anyone with the link', 'Needs a PIN']} value={p.pin ? 'Needs a PIN' : 'Anyone with the link'} />
        <Segmented label="How long it lasts" items={['1 day', '7 days', '30 days', 'Never']} value={p.expiresShort === 'Never' ? 'Never' : '7 days'} hint={p.expires} />
        <Segmented label="Stop after" items={['No limit', '10 views', '50 views']} value="No limit" />
      </Card>
      <Card variant="panel" aria-label="Who opened it" className="gap-0 p-5">
        <div className="flex items-baseline justify-between"><h2 className="text-body font-medium">Who opened it</h2><span className="text-sm text-subtle"><b className="font-medium text-foreground">{p.views}</b> views · {p.today} today</span></div>
        <ul className="mt-3 grid gap-2.5 text-sm">
          {[['iPhone · Manchester', '12 min ago'], ['Mac · Leeds', '1 hour ago'], ['Android · London', 'Yesterday']].map(([a, b]) => (
            <li key={a} className="flex justify-between text-muted-foreground"><span>{a}</span><span className="text-subtle">{b}</span></li>
          ))}
        </ul>
      </Card>
      <Button variant="ghost" className="justify-self-start text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2Icon />Delete page</Button>
    </div>
  )
}

function EmptyDrop({ compact }: { compact?: boolean }) {
  return (
    <div className="px-6 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground"><UploadIcon className="size-7" /></span>
      <h2 className="mt-5 text-heading font-medium tracking-tight">{compact ? 'Your first page' : 'Drop a file to see it here'}</h2>
      <p className="mx-auto mt-2 max-w-[28em] text-md text-muted-foreground">{compact ? 'Choose the file Claude or ChatGPT made. You’ll see it here, with everything you need to share it.' : 'The page Claude or ChatGPT made, an .html file, or paste the code. Then share it from the panel on the right.'}</p>
      <div className="mt-6 flex justify-center gap-2.5">
        <Button size="xl" shape="pill">Choose a file</Button>
        {!compact && <Button size="xl" shape="pill" variant="outline">Paste HTML</Button>}
      </div>
    </div>
  )
}

export function StudioDirection({ empty }: { empty: boolean }) {
  const p = PAGES[0]
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar label="Studio" className="[&>div]:max-w-none" right={<>
        <Button shape="pill" size="lg" className="px-3.5"><PlusIcon />New page</Button>
        <AccountMenu name={USER.first} plan={USER.plan} initial={USER.initial} />
      </>} />
      {/* Phone: the selected page as its own screen */}
      <main className="flex-1 md:hidden">
        {empty ? (
          <div className="p-5"><Card variant="panel" className="py-16"><EmptyDrop compact /></Card></div>
        ) : (
          <div className="grid gap-5 p-4">
            <Button variant="link" className="h-auto justify-self-start gap-1.5 p-0 text-base text-muted-foreground"><ArrowLeftIcon />All pages</Button>
            <h1 className="text-heading font-medium tracking-tight">{p.title}</h1>
            <BrowserFrame url={`${host}/p/${p.id}`}><PagePreview page={p} interactive /></BrowserFrame>
            <Share p={p} />
          </div>
        )}
      </main>
      {/* Desktop: list · live preview · share */}
      <main className="hidden flex-1 gap-5 p-5 md:grid md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside aria-label="Your pages" className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between px-1"><h1 className="text-subheading font-medium tracking-tight">Pages</h1><span className="text-sm text-subtle">{empty ? 0 : PAGES.length}</span></div>
          <InputGroup className="mt-3 h-9 rounded-xl border-hairline-strong">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput aria-label="Search pages" placeholder="Search" />
          </InputGroup>
          {empty ? (
            <p className="mt-6 px-1 text-base text-muted-foreground">Nothing here yet. Your pages will line up here, newest first.</p>
          ) : (
            <nav className="mt-3 grid gap-1" aria-label="Pages">{PAGES.map((x, i) => <PageListItem key={x.id} page={x} short={x.expiresShort} active={i === 0} />)}</nav>
          )}
        </aside>
        <section aria-label="Preview" className="min-w-0">
          {empty ? (
            <BrowserFrame url="Your page will appear here">
              <div className="grid aspect-[3/2] place-items-center bg-[radial-gradient(80%_80%_at_50%_40%,color-mix(in_srgb,var(--mark)_10%,transparent),transparent_70%)]"><EmptyDrop /></div>
            </BrowserFrame>
          ) : (
            <>
              <div className="mb-3 px-1"><h2 className="truncate text-subheading font-medium tracking-tight">{p.title}</h2><p className="text-sm text-subtle">{p.kind} · {p.owner} · Published {p.published} · {p.size}</p></div>
              <BrowserFrame url={`${host}/p/${p.id}`} actions={<SizeSwitch />}><PagePreview page={p} interactive /></BrowserFrame>
            </>
          )}
        </section>
        <aside aria-label="Share settings" className="hidden xl:block">
          {empty ? (
            <Card variant="panel" className="gap-2 p-5 text-base text-muted-foreground"><h2 className="text-lg font-medium text-foreground">Share</h2><p>Your link, QR code, PIN and how long it lasts show up here once you publish.</p></Card>
          ) : <Share p={p} />}
        </aside>
      </main>
    </div>
  )
}
