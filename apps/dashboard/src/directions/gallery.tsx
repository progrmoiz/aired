// Direction A: Gallery. Your pages as a wall of live previews, like files in
// Canva or Figma. Top navigation, a big drop area, no sidebar.
import { ChevronDownIcon, ClipboardPasteIcon, CopyIcon, EllipsisIcon, EyeIcon, LockIcon, SearchIcon, UploadIcon } from 'lucide-react'
import { AiredMark, ChatGPTMark, ClaudeMark, CursorMark } from '@/components/brand'
import { PAGES, USER, type MockPage } from './data'
import { Preview } from './preview'
import { cn } from '@/lib/utils'

function TopNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0a0a0b]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-5 sm:px-8">
        <a href="/" className="flex items-center gap-2 text-[16px] font-semibold"><AiredMark className="size-[18px] text-mark" />aired</a>
        <nav aria-label="Sections" className="hidden items-center gap-1 text-[14px] md:flex">
          {['Pages', 'AI tools', 'Plan'].map((l, i) => (
            <a key={l} href="#" aria-current={i === 0 ? 'page' : undefined} className={cn('rounded-full px-3.5 py-1.5', i === 0 ? 'bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:text-foreground')}>{l}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a href="#" className="hidden rounded-full border border-white/10 px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground sm:block">{USER.plan} plan · <span className="text-foreground">Go Pro</span></a>
          <button type="button" aria-label="Account menu" className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#8b7bf2] to-[#5b4bd0] text-[14px] font-medium text-white">{USER.initial}</button>
        </div>
      </div>
    </header>
  )
}

function DropZone({ big }: { big?: boolean }) {
  return (
    <section aria-label="Publish a page" className={cn('relative overflow-hidden rounded-[28px] border-2 border-dashed border-white/[0.12] bg-[radial-gradient(120%_140%_at_0%_0%,rgba(124,106,239,0.10),transparent_55%),#0f0f11]', big ? 'px-8 py-14 sm:px-14 sm:py-20' : 'px-6 py-7 sm:px-10 sm:py-9')}>
      <div className={cn('flex flex-col gap-6', !big && 'md:flex-row md:items-center')}>
        <div className={cn('flex items-start gap-5', big && 'flex-col items-center text-center')}>
          <span className={cn('grid shrink-0 place-items-center rounded-2xl bg-white text-[#0a0a0b]', big ? 'size-16' : 'size-12')}><UploadIcon className={big ? 'size-7' : 'size-5'} /></span>
          <div>
            <h1 className={cn('font-medium tracking-tight', big ? 'text-[34px] sm:text-[40px]' : 'text-[22px] sm:text-[24px]')}>{big ? 'Put your first page online' : 'Drop a file or paste HTML'}</h1>
            <p className={cn('mt-1 text-muted-foreground', big ? 'mx-auto mt-3 max-w-[30em] text-[17px]' : 'text-[15px]')}>
              {big ? 'Drop the file Claude or ChatGPT made for you, or paste the code. You get a link anyone can open, on any phone or laptop.' : 'You get a link anyone can open. Free, and it takes seconds.'}
            </p>
          </div>
        </div>
        <div className={cn('flex flex-wrap gap-2.5', big ? 'justify-center' : 'md:ml-auto')}>
          <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-[#0a0a0b] hover:bg-white/90"><UploadIcon className="size-4" />Choose a file</button>
          <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-[15px] font-medium hover:bg-white/[0.06]"><ClipboardPasteIcon className="size-4" />Paste HTML</button>
        </div>
      </div>
      <div className={cn('mt-6 flex flex-wrap items-center gap-2 text-[13px] text-subtle', big && 'justify-center')}>
        <span>Or let your AI publish it:</span>
        {[[ClaudeMark, 'Claude'], [ChatGPTMark, 'ChatGPT'], [CursorMark, 'Cursor']].map(([Icon, name]) => {
          const I = Icon as typeof ClaudeMark
          return <a key={name as string} href="#" className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-muted-foreground hover:text-foreground"><I className="size-3.5" />{name as string}</a>
        })}
      </div>
    </section>
  )
}

function Card({ p }: { p: MockPage }) {
  return (
    <article className="group">
      <a href="#" className="block overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111113] transition-all hover:-translate-y-0.5 hover:border-white/25 focus-visible:outline-2 focus-visible:outline-mark" aria-label={`Open ${p.title}`}>
        <div className="relative">
          <Preview page={p} />
          <div className="absolute inset-x-0 top-0 flex justify-between p-2.5">
            {p.pin ? <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11.5px] font-medium text-white backdrop-blur"><LockIcon className="size-3" />PIN</span> : <span />}
            {p.soon && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11.5px] font-medium text-white backdrop-blur">{p.expires}</span>}
          </div>
        </div>
      </a>
      <div className="mt-3 flex items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium">{p.title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-subtle"><EyeIcon className="size-3.5" />{p.views} views · {p.published}</p>
        </div>
        <button type="button" aria-label={`Copy link to ${p.title}`} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><CopyIcon className="size-4" /></button>
        <button type="button" aria-label={`More for ${p.title}`} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"><EllipsisIcon className="size-4" /></button>
      </div>
    </article>
  )
}

export function GalleryDirection({ empty }: { empty: boolean }) {
  return (
    <div className="min-h-screen bg-[#0a0a0b]">
      <TopNav />
      <main className="mx-auto max-w-[1240px] px-5 pt-8 pb-24 sm:px-8 sm:pt-10">
        {empty ? (
          <>
            <DropZone big />
            <h2 className="mt-16 text-center text-[13px] font-medium text-subtle">Your pages will show up here, like this</h2>
            <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-9 opacity-45 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
              {PAGES.slice(0, 3).map((p) => <Card key={p.id} p={p} />)}
            </div>
          </>
        ) : (
          <>
            <DropZone />
            <div className="mt-12 flex flex-wrap items-center gap-3">
              <h2 className="mr-2 text-[22px] font-medium tracking-tight">Your pages <span className="text-subtle">6</span></h2>
              <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="Show">
                {['All', 'Live', 'Expiring soon', 'Private'].map((f, i) => (
                  <button key={f} type="button" aria-pressed={i === 0} className={cn('h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium', i === 0 ? 'bg-white text-[#0a0a0b]' : 'border border-white/10 text-muted-foreground hover:text-foreground')}>{f}</button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <label className="relative hidden sm:block"><span className="sr-only">Search pages</span><SearchIcon className="absolute top-2.5 left-3 size-4 text-subtle" /><input placeholder="Search" className="h-9 w-48 rounded-full border border-white/10 bg-transparent pr-3 pl-9 text-[14px] placeholder:text-subtle" /></label>
                <button type="button" className="inline-flex h-9 items-center gap-1 rounded-full border border-white/10 px-3.5 text-[13px] text-muted-foreground">Newest <ChevronDownIcon className="size-3.5" /></button>
              </div>
            </div>
            <div className="mt-7 grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {PAGES.map((p) => <Card key={p.id} p={p} />)}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
