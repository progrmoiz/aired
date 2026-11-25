// Direction B: Home. A warm, light home screen: a greeting, one big
// "Publish something" card, what got opened today, and recent pages as rich
// cards. Settings and billing live in the avatar menu. Light palette (a change
// from DESIGN.md's dark-only rule, shown so the owner can decide).
import { ArrowUpRightIcon, ClipboardPasteIcon, CopyIcon, CreditCardIcon, KeyRoundIcon, LockIcon, LogOutIcon, PlugIcon, SparklesIcon, UploadIcon, UserIcon } from 'lucide-react'
import { AiredMark, ClaudeMark } from '@/components/brand'
import { PAGES, USER, type MockPage } from './data'
import { Preview } from './preview'
import { cn } from '@/lib/utils'

const C = {
  bg: 'bg-[#f6f1e9]', card: 'bg-[#fffdf9]', border: 'border-[#e9e0d3]', ink: 'text-[#1f1b16]',
  muted: 'text-[#6b6257]', subtle: 'text-[#8a8073]',
}

function Header({ menu }: { menu?: boolean }) {
  return (
    <header className="mx-auto flex h-[72px] max-w-[1120px] items-center gap-4 px-5 sm:px-8">
      <a href="/" className={cn('flex items-center gap-2 text-[17px] font-semibold', C.ink)}><AiredMark className="size-[18px] text-mark" />aired</a>
      <div className="relative ml-auto flex items-center gap-3">
        <a href="#" className="hidden h-10 items-center gap-2 rounded-full bg-[#1f1b16] px-4 text-[14px] font-medium text-[#fffdf9] sm:inline-flex"><UploadIcon className="size-4" />Publish</a>
        <button type="button" aria-label="Account menu" aria-expanded={menu} className="grid size-10 place-items-center rounded-full bg-[#f2c6a0] text-[15px] font-semibold text-[#5a2e0e] ring-2 ring-[#fffdf9]">{USER.initial}</button>
        {menu && (
          <div role="menu" aria-label="Account" className={cn('absolute top-12 right-0 z-10 w-64 rounded-2xl border p-2 shadow-[0_20px_50px_-20px_rgba(60,40,10,0.35)]', C.card, C.border)}>
            <div className="px-3 py-2.5"><p className={cn('text-[14px] font-medium', C.ink)}>Moiz</p><p className={cn('text-[13px]', C.subtle)}>Free plan</p></div>
            <div className="my-1 h-px bg-[#efe7db]" />
            {[[UserIcon, 'Account'], [CreditCardIcon, 'Plan & billing'], [PlugIcon, 'Connect your AI tools'], [KeyRoundIcon, 'Developer keys']].map(([I, l]) => {
              const Icon = I as typeof UserIcon
              return <a key={l as string} role="menuitem" href="#" className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] hover:bg-[#f6efe4]', C.ink)}><Icon className="size-4 opacity-70" />{l as string}</a>
            })}
            <div className="my-1 h-px bg-[#efe7db]" />
            <a role="menuitem" href="#" className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] hover:bg-[#f6efe4]', C.muted)}><LogOutIcon className="size-4" />Sign out</a>
          </div>
        )}
      </div>
    </header>
  )
}

function PublishCard({ big }: { big?: boolean }) {
  return (
    <section aria-label="Publish something" className={cn('rounded-[28px] border p-6 sm:p-8', C.card, C.border)}>
      <p className="text-[13px] font-medium text-mark">Publish something</p>
      <h2 className={cn('mt-1.5 font-medium tracking-tight', C.ink, big ? 'text-[30px]' : 'text-[24px]')}>Got a page from Claude or ChatGPT?</h2>
      <div className={cn('mt-5 grid place-items-center rounded-2xl border-2 border-dashed border-[#e2d6c4] bg-[#fbf7f0] text-center', big ? 'py-14' : 'py-9')}>
        <span className="grid size-12 place-items-center rounded-2xl bg-[#1f1b16] text-[#fffdf9]"><UploadIcon className="size-5" /></span>
        <p className={cn('mt-3 text-[16px] font-medium', C.ink)}>Drop the file here</p>
        <p className={cn('text-[14px]', C.muted)}>or <button type="button" className="font-medium underline decoration-[#d9cbb6] underline-offset-4">choose one</button> · <button type="button" className="inline-flex items-center gap-1 font-medium underline decoration-[#d9cbb6] underline-offset-4"><ClipboardPasteIcon className="size-3.5" />paste the code</button></p>
      </div>
      <p className={cn('mt-4 flex items-center gap-2 text-[13px]', C.muted)}><ClaudeMark className="size-3.5" />Or just ask Claude: “publish this with aired”. <a href="#" className="font-medium underline decoration-[#d9cbb6] underline-offset-4">Set it up</a></p>
    </section>
  )
}

function Chips({ p }: { p: MockPage }) {
  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium'
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <span className={cn(chip, p.soon ? 'bg-[#fdebd3] text-[#8a4b0f]' : 'bg-[#efe9df] text-[#5b5248]')}>{p.expires}</span>
      {p.pin && <span className={cn(chip, 'bg-[#efe9df] text-[#5b5248]')}><LockIcon className="size-3" />PIN</span>}
      <span className={cn(chip, 'bg-[#efe9df] text-[#5b5248]')}>{p.views} views</span>
    </div>
  )
}

function RecentCard({ p }: { p: MockPage }) {
  return (
    <article className={cn('flex gap-4 rounded-3xl border p-3.5 transition-shadow hover:shadow-[0_14px_40px_-24px_rgba(60,40,10,0.45)]', C.card, C.border)}>
      <a href="#" aria-label={`Open ${p.title}`} className="block w-[38%] max-w-[190px] shrink-0 self-center overflow-hidden rounded-2xl border border-[#eee5d8]"><Preview page={p} /></a>
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <h3 className={cn('truncate text-[16px] font-medium', C.ink)}>{p.title}</h3>
        <p className={cn('text-[13px]', C.subtle)}>{p.owner} · {p.published}</p>
        <Chips p={p} />
        <div className="mt-auto flex gap-2 pt-3">
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1f1b16] px-3 text-[13px] font-medium text-[#fffdf9]"><CopyIcon className="size-3.5" />Copy link</button>
          <button type="button" aria-label={`Open ${p.title}`} className="grid size-8 place-items-center rounded-full border border-[#e2d8ca] text-[#5b5248]"><ArrowUpRightIcon className="size-4" /></button>
        </div>
      </div>
    </article>
  )
}

export function HomeDirection({ empty }: { empty: boolean }) {
  const opened = [...PAGES].sort((a, b) => b.today - a.today).slice(0, 4)
  const max = opened[0].today
  return (
    <div className={cn('min-h-screen', C.bg, C.ink)} style={{ colorScheme: 'light' }}>
      <Header menu={empty} />
      <main className="mx-auto max-w-[1120px] px-5 pt-4 pb-24 sm:px-8 sm:pt-8">
        <h1 className="text-[34px] leading-tight font-medium tracking-tight sm:text-[44px]">{empty ? `Welcome, ${USER.first}` : `Good morning, ${USER.first}`}</h1>
        <p className={cn('mt-2 text-[17px]', C.muted)}>{empty ? 'Let’s put your first page online. It takes about ten seconds.' : <>Your pages were opened <b className={C.ink}>50 times</b> since yesterday.</>}</p>

        {empty ? (
          <>
            <div className="mt-8"><PublishCard big /></div>
            <h2 className="mt-14 text-[20px] font-medium tracking-tight">What people share with aired</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {[PAGES[0], PAGES[1], PAGES[3]].map((p, i) => (
                <div key={p.id} className={cn('overflow-hidden rounded-3xl border', C.card, C.border)}>
                  <Preview page={p} />
                  <div className="p-4"><p className="text-[15px] font-medium">{['Workout plans', 'Class quizzes', 'Client reports'][i]}</p><p className={cn('text-[13px]', C.muted)}>{['Send clients their week.', 'Share a quiz with one link.', 'Progress, without a PDF.'][i]}</p></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
              <PublishCard />
              <section aria-label="Opened today" className={cn('rounded-[28px] border p-6 sm:p-8', C.card, C.border)}>
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#15803d]"><SparklesIcon className="size-3.5" />Opened today</p>
                <h2 className="mt-1.5 text-[24px] font-medium tracking-tight">Your busiest pages</h2>
                <ul className="mt-5 grid gap-4">
                  {opened.map((p) => (
                    <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
                      <span className="truncate text-[15px]">{p.title}</span>
                      <span className="text-[14px] font-semibold text-[#15803d] tabular-nums">+{p.today}</span>
                      <span className="col-span-2 h-2 overflow-hidden rounded-full bg-[#f0e9de]"><i className="block h-full rounded-full bg-[#f2a65a]" style={{ width: `${(p.today / max) * 100}%` }} /></span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="mt-14 flex items-end justify-between">
              <h2 className="text-[24px] font-medium tracking-tight">Recent pages</h2>
              <a href="#" className={cn('text-[14px] font-medium underline decoration-[#d9cbb6] underline-offset-4', C.muted)}>See all 6</a>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {PAGES.map((p) => <RecentCard key={p.id} p={p} />)}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
