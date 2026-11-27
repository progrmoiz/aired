// #share/<page id>: who can open one page. Anyone with the link, anyone with
// a PIN, or only the people you name (emails, and whole domains on Pro), who
// confirm their email with a one-time code. Below it, which of those people
// opened the page: for the owner's eyes only.
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { ArrowLeftIcon, GlobeIcon, KeyRoundIcon, UsersIcon, XIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyRow, ViewHeader } from '@/components/common'
import type { PagesState } from '@/App'
import { getJson, mutate, readJson } from '@/lib/api'
import { relativeAge } from '@/lib/format'
import { cn } from '@/lib/utils'

type Mode = 'public' | 'pin' | 'people'
type Visitor = { email: string; first_opened_at: string; last_opened_at: string; views: number }
type Access = {
  id: string
  mode: Mode
  emails: string[]
  domains: string[]
  visitors: Visitor[]
  limits: { people: number; domains: number }
  email_ready: boolean
}
type State = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; access: Access }

const MODES: { key: Mode; icon: typeof GlobeIcon; label: string; detail: string }[] = [
  { key: 'public', icon: GlobeIcon, label: 'Anyone with the link', detail: 'No sign-in, no code' },
  { key: 'pin', icon: KeyRoundIcon, label: 'Anyone with a PIN', detail: 'You send the PIN separately' },
  { key: 'people', icon: UsersIcon, label: 'Only people you choose', detail: 'They confirm their email with a code' },
]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/i

export function ShareView({ pageId, pages, isPro }: { pageId: string; pages: PagesState; isPro: boolean }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [mode, setMode] = useState<Mode>('public')
  const [people, setPeople] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const page = pages.status === 'ready' ? pages.pages.find((p) => p.id === pageId) : undefined
  const title = page?.title || 'Untitled page'
  const url = `${window.location.origin}/p/${pageId}`

  const load = useCallback(() => {
    if (!pageId) return
    setState({ status: 'loading' })
    getJson<Access>(`/api/pages/${encodeURIComponent(pageId)}/access`)
      .then((access) => {
        setState({ status: 'ready', access })
        setMode(access.mode)
        setPeople([...access.emails, ...access.domains.map((d) => '@' + d)])
        setPin('')
        setError('')
      })
      .catch((err: { status?: number }) => setState({ status: err.status === 404 || err.status === 403 ? 'missing' : 'error' }))
  }, [pageId])
  useEffect(load, [load])

  const access = state.status === 'ready' ? state.access : null

  /** Add what's typed: one or more emails or @domains, split on commas and spaces. */
  function addDraft(): boolean {
    const items = draft.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    if (items.length === 0) return true
    const bad = items.find((x) => !(EMAIL.test(x) || (x.startsWith('@') && DOMAIN.test(x))))
    if (bad) {
      setError(bad.includes('@') ? `“${bad}” isn’t an email address.` : `“${bad}” isn’t an email. Write a whole domain as @${bad}.`)
      return false
    }
    setPeople((cur) => [...new Set([...cur, ...items])])
    setDraft('')
    setError('')
    return true
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addDraft()
    } else if (e.key === 'Backspace' && draft === '' && people.length > 0) {
      setPeople((cur) => cur.slice(0, -1))
    }
  }

  const emails = people.filter((p) => !p.startsWith('@'))
  const domains = people.filter((p) => p.startsWith('@')).map((d) => d.slice(1))
  const overPeople = access !== null && emails.length > access.limits.people
  const blockedDomains = access !== null && domains.length > 0 && access.limits.domains === 0

  const dirty = access !== null && (
    mode !== access.mode ||
    (mode === 'pin' && pin !== '') ||
    (mode === 'people' && people.slice().sort().join() !== [...access.emails, ...access.domains.map((d) => '@' + d)].sort().join())
  )

  async function save() {
    if (!access) return
    if (mode === 'people' && draft.trim() && !addDraft()) return
    const list = mode === 'people' ? [...new Set([...people, ...draft.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)])] : []
    const body: Record<string, unknown> =
      mode === 'people'
        ? { access: { mode, emails: list.filter((p) => !p.startsWith('@')), domains: list.filter((p) => p.startsWith('@')).map((d) => d.slice(1)) } }
        : mode === 'pin'
          ? { access: { mode }, ...(pin ? { pin } : {}) }
          : { access: { mode } }
    if (mode === 'people' && list.length === 0) { setError('Add at least one email.'); return }
    if (mode === 'pin' && !pin && access.mode !== 'pin') { setError('Choose a PIN of 4 or more characters.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await mutate('PATCH', `/api/pages/${encodeURIComponent(pageId)}`, body)
      const data = await readJson(res)
      if (!res.ok) {
        setError(String(data.error ?? 'Could not save. Try again.'))
        return
      }
      toast.success('Saved')
      load()
    } catch {
      setError('Could not save. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!pageId) {
    return <ViewHeader title="Share" description="Open a page’s menu and pick Share." />
  }

  return (
    <div className="grid min-w-0 gap-5">
      <a href="#pages" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" />Your pages</a>
      <ViewHeader title={`Share “${title}”`} description="Choose who can open this page. Changes apply right away to the same link." />
      {state.status === 'loading' && <div className="grid gap-5" aria-busy="true" aria-label="Loading"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>}
      {state.status === 'missing' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">This page isn’t in your account.</p>
          <a href="#pages" className={buttonVariants({ variant: 'outline' })}>See all your pages</a>
        </Card>
      )}
      {state.status === 'error' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">Could not load this page’s sharing.</p>
          <Button variant="outline" onClick={load}>Try again</Button>
        </Card>
      )}
      {access && (
        <>
          <Card className="gap-0 py-0">
            <div className="border-b border-border px-5 py-4">
              <p className="text-sm font-medium">Who can open it</p>
              <div role="radiogroup" aria-label="Who can open it" className="mt-3 grid gap-2 sm:grid-cols-3">
                {MODES.map((m) => {
                  const on = mode === m.key
                  const Icon = m.icon
                  return (
                    <button
                      key={m.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => { setMode(m.key); setError('') }}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on ? 'border-foreground/60 bg-tint' : 'border-input hover:bg-tint/60',
                      )}
                    >
                      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-input', on ? 'text-foreground' : 'text-muted-foreground')}><Icon className="size-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{m.label}</span>
                        <span className="block text-xs text-subtle">{m.detail}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {mode === 'people' && (
              <div className="grid gap-3 px-5 py-4">
                <label htmlFor="share-add" className="text-sm font-medium">People</label>
                <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-ring">
                  {people.map((p) => (
                    <span key={p} className="inline-flex max-w-full items-center gap-1 rounded-md bg-tint py-0.5 pr-1 pl-2 text-[13px]">
                      <span className="truncate">{p.startsWith('@') ? `Anyone ${p}` : p}</span>
                      <button type="button" aria-label={`Remove ${p}`} onClick={() => setPeople((cur) => cur.filter((x) => x !== p))}
                        className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"><XIcon className="size-3.5" /></button>
                    </span>
                  ))}
                  <input
                    id="share-add"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    onBlur={() => { if (draft.trim()) addDraft() }}
                    placeholder={people.length ? 'Add another' : 'alice@client.com, @client.com'}
                    className="h-7 min-w-[12ch] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-subtle"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <p className={cn('text-xs', overPeople || blockedDomains ? 'text-destructive' : 'text-subtle')}>
                  {isPro
                    ? `Up to ${access.limits.people} people and ${access.limits.domains} whole domains. Press Enter after each one.`
                    : blockedDomains
                      ? 'Whole domains (@client.com) need Pro. List the people instead, or upgrade.'
                      : `Free lists up to ${access.limits.people} people. Pro adds more people and whole domains (@client.com).`}
                  {!isPro && <> <a href="#billing" className="text-foreground underline-offset-4 hover:underline">See Pro</a></>}
                </p>
                <p className="text-xs text-subtle">
                  Each person types their email on the page and gets a 6-digit code from aired. Nobody is emailed until they ask, and people not on the list are told the same thing, so the page never says who has access.
                </p>
                {!access.email_ready && <p className="text-xs text-destructive">Email codes aren’t set up on this server yet, so this can’t be turned on.</p>}
              </div>
            )}

            {mode === 'pin' && (
              <div className="grid gap-2 px-5 py-4">
                <label htmlFor="share-pin" className="text-sm font-medium">{access.mode === 'pin' ? 'New PIN' : 'PIN'}</label>
                <Input id="share-pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="max-w-60" placeholder={access.mode === 'pin' ? 'Leave empty to keep it' : '4 or more characters'} autoComplete="new-password" />
                <p className="text-xs text-subtle">Anyone with the link and the PIN can open it. Send the PIN apart from the link.</p>
              </div>
            )}

            {mode === 'public' && (
              <div className="px-5 py-4">
                <p className="text-sm text-muted-foreground">Anyone who has the link can open the page. {access.mode !== 'public' && 'Saving removes the PIN or the list.'}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
              <Button onClick={save} disabled={!dirty || saving || (mode === 'people' && !access.email_ready)} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Save'}</Button>
              {dirty && !saving && <Button variant="ghost" onClick={load}>Cancel</Button>}
              {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
            </div>
          </Card>

          <div className="grid gap-2">
            <p className="text-sm font-medium">Link</p>
            <CopyRow text={url} label="Copy link" />
          </div>

          {(access.mode === 'people' || access.visitors.length > 0) && <Visitors visitors={access.visitors} />}
        </>
      )}
    </div>
  )
}

function Visitors({ visitors }: { visitors: Visitor[] }) {
  return (
    <Card className="gap-0 py-0">
      <div className="border-b border-border px-5 py-4">
        <p className="text-sm font-medium">Who opened it</p>
        <p className="mt-0.5 text-xs text-subtle">Only you see this. It lists the people who entered a code, not you.</p>
      </div>
      {visitors.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Nobody on the list has opened it yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Person</TableHead>
              <TableHead>First opened</TableHead>
              <TableHead>Last opened</TableHead>
              <TableHead className="pr-5 text-right">Views</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visitors.map((v) => (
              <TableRow key={v.email}>
                <TableCell className="max-w-[16rem] truncate pl-5 font-medium">{v.email}</TableCell>
                <TableCell className="text-muted-foreground" title={new Date(v.first_opened_at).toLocaleString()}>{relativeAge(v.first_opened_at)}</TableCell>
                <TableCell className="text-muted-foreground" title={new Date(v.last_opened_at).toLocaleString()}>{relativeAge(v.last_opened_at)}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">{v.views.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
