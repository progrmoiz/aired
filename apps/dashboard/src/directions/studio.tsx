// Direction C: Studio. A sharing tool, not a database: pick a page on the
// left, see it live in the middle, and every share control sits next to it.
import { ArrowLeftIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, LaptopIcon, LockIcon, PlusIcon, SearchIcon, SmartphoneIcon, TabletIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { AiredMark } from '@/components/brand'
import { PAGES, USER, host, type MockPage } from './data'
import { FakeQr, Preview } from './preview'
import { cn } from '@/lib/utils'

const panel = 'rounded-[22px] border border-white/[0.07] bg-[#101012]'

function Bar() {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-white/[0.06] px-4 sm:px-5">
      <a href="/" className="flex items-center gap-2 text-[15px] font-semibold"><AiredMark className="size-4 text-mark" />aired</a>
      <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
      <span className="hidden text-[14px] text-muted-foreground sm:block">Studio</span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13.5px] font-medium text-[#0a0a0b]"><PlusIcon className="size-4" />New page</button>
        <button type="button" aria-label="Account menu" className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#8b7bf2] to-[#5b4bd0] text-[13px] font-medium text-white">{USER.initial}</button>
      </div>
    </header>
  )
}

function ListItem({ p, active }: { p: MockPage; active?: boolean }) {
  return (
    <a href="#" aria-current={active ? 'true' : undefined} className={cn('flex items-center gap-3 rounded-2xl p-2 pr-3 transition-colors', active ? 'bg-white/[0.08] ring-1 ring-white/15' : 'hover:bg-white/[0.04]')}>
      <span className="block w-[72px] shrink-0 overflow-hidden rounded-lg border border-white/10"><Preview page={p} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{p.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-subtle">
          <i className={cn('size-1.5 rounded-full', p.soon ? 'bg-amber-400' : 'bg-ok')} />
          {p.views} views · {p.expiresShort}{p.pin && <LockIcon className="size-3" aria-label="Needs a PIN" />}
        </span>
      </span>
    </a>
  )
}

function Frame({ p, children }: { p?: MockPage; children: React.ReactNode }) {
  return (
    <div className={cn(panel, 'overflow-hidden')}>
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.05] px-3.5 py-1.5 font-mono text-[12.5px] text-muted-foreground">
          <LockIcon className="size-3 text-ok" /><span className="truncate">{p ? `${host}/p/${p.id}` : 'Your page will appear here'}</span>
        </div>
        {p && (
          <div className="hidden items-center gap-1 text-subtle md:flex" role="group" aria-label="Preview size">
            {[LaptopIcon, TabletIcon, SmartphoneIcon].map((I, i) => <button key={i} type="button" aria-pressed={i === 0} aria-label={['Laptop', 'Tablet', 'Phone'][i]} className={cn('grid size-8 place-items-center rounded-lg', i === 0 && 'bg-white/[0.08] text-foreground')}><I className="size-4" /></button>)}
            <button type="button" aria-label="Open in a new tab" className="ml-1 grid size-8 place-items-center rounded-lg hover:text-foreground"><ExternalLinkIcon className="size-4" /></button>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function Seg({ items, on }: { items: string[]; on: number }) {
  return (
    <div className="flex rounded-xl bg-white/[0.05] p-1" role="radiogroup">
      {items.map((t, i) => <button key={t} type="button" role="radio" aria-checked={i === on} className={cn('h-8 flex-1 rounded-lg px-2 text-[12.5px] font-medium', i === on ? 'bg-white text-[#0a0a0b]' : 'text-muted-foreground hover:text-foreground')}>{t}</button>)}
    </div>
  )
}

function Share({ p }: { p: MockPage }) {
  const label = 'mb-2 text-[12px] font-medium text-subtle'
  return (
    <div className="grid gap-5">
      <section className={cn(panel, 'p-5')} aria-label="Share">
        <h2 className="text-[17px] font-medium">Share</h2>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 py-1.5 pr-1.5 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{host}/p/{p.id}</span>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium text-[#0a0a0b]"><CopyIcon className="size-3.5" />Copy</button>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <FakeQr seed={p.id} className="size-[92px] shrink-0 rounded-lg p-1.5 bg-white" />
          <div className="text-[13px] text-muted-foreground">Show it on a screen or print it. Phones open the page straight away.
            <button type="button" className="mt-2 flex items-center gap-1.5 font-medium text-foreground"><DownloadIcon className="size-3.5" />Download QR</button></div>
        </div>
      </section>
      <section className={cn(panel, 'grid gap-4 p-5')} aria-label="Settings">
        <div><p className={label}>Who can open it</p><Seg items={['Anyone with the link', 'Needs a PIN']} on={p.pin ? 1 : 0} /></div>
        <div><p className={label}>How long it lasts</p><Seg items={['1 day', '7 days', '30 days', 'Never']} on={p.expiresShort === 'Never' ? 3 : 1} /><p className="mt-1.5 text-[12px] text-subtle">{p.expires}</p></div>
        <div><p className={label}>Stop after</p><Seg items={['No limit', '10 views', '50 views']} on={0} /></div>
      </section>
      <section className={cn(panel, 'p-5')} aria-label="Who opened it">
        <div className="flex items-baseline justify-between"><h2 className="text-[15px] font-medium">Who opened it</h2><span className="text-[13px] text-subtle"><b className="font-medium text-foreground">{p.views}</b> views · {p.today} today</span></div>
        <ul className="mt-3 grid gap-2.5 text-[13px]">
          {[['iPhone · Manchester', '12 min ago'], ['Mac · Leeds', '1 hour ago'], ['Android · London', 'Yesterday']].map(([a, b]) => (
            <li key={a} className="flex justify-between text-muted-foreground"><span>{a}</span><span className="text-subtle">{b}</span></li>
          ))}
        </ul>
      </section>
      <button type="button" className="inline-flex items-center gap-1.5 justify-self-start px-1 text-[13px] text-[#f87171]"><Trash2Icon className="size-3.5" />Delete page</button>
    </div>
  )
}

export function StudioDirection({ empty }: { empty: boolean }) {
  const p = PAGES[0]
  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0b]">
      <Bar />
      {/* Phone: the selected page as its own screen */}
      <main className="flex-1 md:hidden">
        {empty ? (
          <div className="p-5">
            <div className={cn(panel, 'grid place-items-center px-6 py-16 text-center')}>
              <span className="grid size-14 place-items-center rounded-2xl bg-white text-[#0a0a0b]"><UploadIcon className="size-6" /></span>
              <h1 className="mt-5 text-[26px] font-medium tracking-tight">Your first page</h1>
              <p className="mt-2 text-[15px] text-muted-foreground">Choose the file Claude or ChatGPT made. You’ll see it here, with everything you need to share it.</p>
              <button type="button" className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-[#0a0a0b]">Choose a file</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 p-4">
            <a href="#" className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground"><ArrowLeftIcon className="size-4" />All pages</a>
            <h1 className="text-[26px] font-medium tracking-tight">{p.title}</h1>
            <Frame p={p}><Preview page={p} interactive /></Frame>
            <Share p={p} />
          </div>
        )}
      </main>
      {/* Desktop: list · live preview · share */}
      <main className="hidden flex-1 gap-5 p-5 md:grid md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside aria-label="Your pages" className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between px-1"><h1 className="text-[20px] font-medium tracking-tight">Pages</h1><span className="text-[13px] text-subtle">{empty ? 0 : 6}</span></div>
          <label className="relative mt-3 block"><span className="sr-only">Search pages</span><SearchIcon className="absolute top-2.5 left-3 size-4 text-subtle" /><input placeholder="Search" className="h-9 w-full rounded-xl border border-white/10 bg-transparent pr-3 pl-9 text-[14px] placeholder:text-subtle" /></label>
          {empty ? (
            <p className="mt-6 px-1 text-[14px] text-muted-foreground">Nothing here yet. Your pages will line up here, newest first.</p>
          ) : (
            <nav className="mt-3 grid gap-1" aria-label="Pages">{PAGES.map((x, i) => <ListItem key={x.id} p={x} active={i === 0} />)}</nav>
          )}
        </aside>
        <section aria-label="Preview" className="min-w-0">
          {empty ? (
            <Frame>
              <div className="grid aspect-[3/2] place-items-center border-2 border-dashed border-white/10 bg-[radial-gradient(80%_80%_at_50%_40%,rgba(124,106,239,0.10),transparent_70%)] text-center">
                <div className="px-6">
                  <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white text-[#0a0a0b]"><UploadIcon className="size-7" /></span>
                  <h2 className="mt-5 text-[30px] font-medium tracking-tight">Drop a file to see it here</h2>
                  <p className="mx-auto mt-2 max-w-[28em] text-[16px] text-muted-foreground">The page Claude or ChatGPT made, an .html file, or paste the code. Then share it from the panel on the right.</p>
                  <div className="mt-6 flex justify-center gap-2.5">
                    <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-[#0a0a0b]">Choose a file</button>
                    <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-[15px] font-medium">Paste HTML</button>
                  </div>
                </div>
              </div>
            </Frame>
          ) : (
            <>
              <div className="mb-3 flex items-end justify-between gap-3 px-1">
                <div className="min-w-0"><h2 className="truncate text-[22px] font-medium tracking-tight">{p.title}</h2><p className="text-[13px] text-subtle">{p.kind} · {p.owner} · Published {p.published} · {p.size}</p></div>
              </div>
              <Frame p={p}><Preview page={p} interactive /></Frame>
            </>
          )}
        </section>
        <aside aria-label="Share settings" className="hidden xl:block">
          {empty ? (
            <div className={cn(panel, 'p-5 text-[14px] text-muted-foreground')}><h2 className="text-[17px] font-medium text-foreground">Share</h2><p className="mt-2">Your link, QR code, PIN and how long it lasts show up here once you publish.</p></div>
          ) : <Share p={p} />}
        </aside>
      </main>
    </div>
  )
}
