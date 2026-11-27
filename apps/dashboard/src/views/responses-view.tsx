// #responses/<page id>: what viewers saved on one page with aired.collect,
// newest first, one column per field, with CSV export, delete, and the
// page's two settings (public results, taking new entries).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftIcon, DownloadIcon, ExternalLinkIcon, InboxIcon, LockIcon, LockOpenIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CopyRow, ViewHeader } from '@/components/common'
import type { PagesState } from '@/App'
import { getJson, mutate, readJson } from '@/lib/api'
import { plural, relativeAge, sizeWords } from '@/lib/format'
import { cn } from '@/lib/utils'

type Entry = { id: string; viewer: string; key: string | null; data: unknown; created_at: string; updated_at: string }
type Report = {
  id: string
  url: string
  title: string | null
  settings: { public_results: boolean; closed: boolean }
  usage: { entries: number; bytes: number; this_month: number; limits: { responses_per_month: number; stored_responses: number; stored_bytes: number; retention_days: number | null } }
  responses: Entry[]
  cursor: string | null
}
type State = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; report: Report; more: boolean }

const SNIPPET = `aired.collect.save({ answer: "B" })`
const MAX_COLUMNS = 6

export function ResponsesView({ pageId, pages }: { pageId: string; pages: PagesState }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const page = pages.status === 'ready' ? pages.pages.find((p) => p.id === pageId) : undefined

  const load = useCallback(() => {
    if (!pageId) return
    setState({ status: 'loading' })
    getJson<Report>(`/api/pages/${encodeURIComponent(pageId)}/responses?limit=100`)
      .then((report) => setState({ status: 'ready', report, more: report.cursor !== null }))
      .catch((err: { status?: number }) => setState({ status: err.status === 404 ? 'missing' : 'error' }))
  }, [pageId])
  useEffect(load, [load])

  const ready = state.status === 'ready' ? state : null
  const report = ready?.report
  const title = page?.title || report?.title || 'Untitled page'

  async function loadMore() {
    if (!report?.cursor) return
    setLoadingMore(true)
    try {
      const next = await getJson<Report>(`/api/pages/${encodeURIComponent(pageId)}/responses?limit=100&cursor=${encodeURIComponent(report.cursor)}`)
      setState({ status: 'ready', report: { ...next, responses: [...report.responses, ...next.responses] }, more: next.cursor !== null })
    } catch {
      toast.error('Could not load more responses')
    } finally {
      setLoadingMore(false)
    }
  }

  async function setSetting(change: Partial<Report['settings']>) {
    const res = await mutate('PATCH', `/api/pages/${encodeURIComponent(pageId)}/responses`, change)
    if (!res.ok) { toast.error(String((await readJson(res)).error ?? 'Could not save that')); return }
    const body = (await readJson(res)) as { settings?: Report['settings'] }
    if (body.settings && report) setState({ status: 'ready', report: { ...report, settings: body.settings }, more: ready!.more })
  }

  async function remove(ids: string[] | null) {
    const res = await mutate('DELETE', `/api/pages/${encodeURIComponent(pageId)}/responses`, ids === null ? { all: true } : { ids })
    if (!res.ok) { toast.error(String((await readJson(res)).error ?? 'Could not delete')); return false }
    toast.success(ids === null ? 'All responses deleted' : 'Response deleted')
    if (ids === null) load()
    else if (report) {
      const gone = new Set(ids)
      setState({
        status: 'ready',
        report: { ...report, responses: report.responses.filter((e) => !gone.has(e.id)), usage: { ...report.usage, entries: Math.max(0, report.usage.entries - ids.length) } },
        more: ready!.more,
      })
    }
    return true
  }

  const description = (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a href="#pages" className="inline-flex items-center gap-1.5 hover:text-foreground"><ArrowLeftIcon className="size-3.5" />All your pages</a>
      {pageId && (
        <a href={`/p/${pageId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[13px] hover:text-foreground">
          {window.location.host}/p/{pageId}<ExternalLinkIcon className="size-3.5" />
        </a>
      )}
    </span>
  )

  const action = report && (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/api/pages/${encodeURIComponent(pageId)}/responses.csv`} download className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        <DownloadIcon />Download CSV
      </a>
      {report.usage.entries > 0 && (
        <Button variant="outline" size="lg" onClick={() => setConfirmAll(true)}><Trash2Icon />Delete all</Button>
      )}
    </div>
  )

  if (!pageId) {
    return (
      <div className="grid gap-5">
        <ViewHeader title="Responses" description="Open a page’s menu and pick See responses." />
        <HowTo />
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title={title} description={description} action={action} />
      {state.status === 'loading' && <div className="grid gap-5" aria-busy="true" aria-label="Loading responses"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>}
      {state.status === 'missing' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">This page isn’t in your account.</p>
          <a href="#pages" className={buttonVariants({ variant: 'outline' })}>See all your pages</a>
        </Card>
      )}
      {state.status === 'error' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">Could not load the responses.</p>
          <Button variant="outline" onClick={load}>Try again</Button>
        </Card>
      )}
      {report && (
        <>
          <Summary report={report} onSetting={setSetting} />
          {report.responses.length === 0 ? <HowTo /> : <EntriesTable entries={report.responses} onDelete={(id) => remove([id])} />}
          {ready?.more && (
            <Button variant="outline" className="mx-auto" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older responses'}</Button>
          )}
          <p className="text-xs text-subtle">
            Responses are what visitors typed into the page. {report.usage.limits.retention_days === null ? 'They’re kept as long as the page.' : `Each one is kept ${report.usage.limits.retention_days} days on Free.`} Deleting the page deletes them all.
          </p>
        </>
      )}
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all {report ? plural(report.usage.entries, 'response') : 'responses'}?</AlertDialogTitle>
            <AlertDialogDescription>Visitors lose what they saved on this page too. This can’t be undone. Download the CSV first if you want a copy.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" className="bg-destructive text-background hover:bg-destructive/85 dark:bg-destructive dark:hover:bg-destructive/85"
              onClick={async () => { if (await remove(null)) setConfirmAll(false) }}>Delete all</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Summary({ report, onSetting }: { report: Report; onSetting: (c: Partial<Report['settings']>) => void }) {
  const { usage, settings } = report
  const people = new Set(report.responses.map((e) => e.viewer)).size
  const last = report.responses[0]?.created_at
  const monthShare = usage.limits.responses_per_month > 0 ? Math.min(100, Math.round((usage.this_month / usage.limits.responses_per_month) * 100)) : 0
  return (
    <Card className="gap-0 py-0">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-border px-5 py-4 lg:grid-cols-4">
        <Kpi label="Responses" value={usage.entries.toLocaleString()} sub={sizeWords(usage.bytes) || '—'} />
        <Kpi label="This month" value={usage.this_month.toLocaleString()} sub={`of ${usage.limits.responses_per_month.toLocaleString()} allowed`} bar={monthShare} />
        <Kpi label="People" value={people.toLocaleString()} sub={report.cursor ? 'in the responses shown' : 'different browsers'} />
        <Kpi label="Latest" value={last ? relativeAge(last) : '—'} sub={last ? new Date(last).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No responses yet'} />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <Toggle on={settings.public_results} onClick={() => onSetting({ public_results: !settings.public_results })}
          icon={<UsersIcon />} label={settings.public_results ? 'Results are public' : 'Results are private'}
          title={settings.public_results ? 'Every visitor can read all responses (aired.collect.all), never who sent them' : 'Visitors see only their own responses'} />
        <Toggle on={!settings.closed} onClick={() => onSetting({ closed: !settings.closed })}
          icon={settings.closed ? <LockIcon /> : <LockOpenIcon />} label={settings.closed ? 'Closed to new responses' : 'Taking new responses'}
          title={settings.closed ? 'Open it again to take new responses' : 'Close it to stop new responses'} />
      </div>
    </Card>
  )
}

function Toggle({ on, onClick, icon, label, title }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; title: string }) {
  return (
    <Button variant="outline" size="sm" aria-pressed={on} title={title} onClick={onClick}
      className={cn('rounded-full', on ? 'border-ok/40 text-foreground' : 'text-muted-foreground')}>
      <span className={cn('size-1.5 rounded-full', on ? 'bg-ok' : 'bg-subtle')} aria-hidden="true" />{icon}{label}
    </Button>
  )
}

function Kpi({ label, value, sub, bar }: { label: string; value: string; sub: string; bar?: number }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-subtle">{label}</p>
      <p className="mt-1 truncate text-xl font-medium tracking-tight tabular-nums" title={value}>{value}</p>
      {bar !== undefined && (
        <div className="mt-1.5 h-1 w-full max-w-32 overflow-hidden rounded-full bg-tint" aria-hidden="true">
          <div className={cn('h-full rounded-full', bar >= 90 ? 'bg-destructive' : 'bg-mark')} style={{ width: `${Math.max(2, bar)}%` }} />
        </div>
      )}
      <p className="mt-1 truncate text-xs text-subtle">{sub}</p>
    </div>
  )
}

/** One short, stable colour and label per viewer id, so the same person reads the same across rows. */
function viewerLabel(viewer: string, order: Map<string, number>) {
  const n = order.get(viewer) ?? 0
  const hue = (n * 67) % 360
  return { name: `Person ${n + 1}`, hue }
}

function cell(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function EntriesTable({ entries, onDelete }: { entries: Entry[]; onDelete: (id: string) => void }) {
  const columns = useMemo(() => {
    const seen = new Map<string, number>()
    for (const e of [...entries].reverse()) {
      if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) for (const k of Object.keys(e.data)) seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    return [...seen.keys()]
  }, [entries])
  const shown = columns.slice(0, MAX_COLUMNS)
  const hidden = columns.slice(MAX_COLUMNS)
  // People are numbered in the order they first answered.
  const order = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of [...entries].reverse()) if (!m.has(e.viewer)) m.set(e.viewer, m.size)
    return m
  }, [entries])
  const hasKeys = entries.some((e) => e.key !== null)

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-tint/60 hover:bg-tint/60">
            <TableHead className="w-36 pl-5 text-xs font-medium text-subtle">When</TableHead>
            <TableHead className="w-32 text-xs font-medium text-subtle">Person</TableHead>
            {hasKeys && <TableHead className="text-xs font-medium text-subtle">Key</TableHead>}
            {shown.map((c) => <TableHead key={c} className="text-xs font-medium text-subtle">{c}</TableHead>)}
            {hidden.length > 0 && <TableHead className="text-xs font-medium text-subtle" title={hidden.join(', ')}>+{hidden.length} more</TableHead>}
            <TableHead className="w-10 pr-3"><span className="sr-only">Delete</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => {
            const data = e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {}
            const who = viewerLabel(e.viewer, order)
            const rest = hidden.filter((k) => k in data)
            return (
              <TableRow key={e.id} className="group">
                <TableCell className="pl-5 text-[13px] whitespace-nowrap text-muted-foreground" title={new Date(e.created_at).toLocaleString()}>{relativeAge(e.created_at)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2 text-[13px]" title={`Viewer id ${e.viewer}`}>
                    <span className="size-2 rounded-full" style={{ background: `oklch(0.68 0.13 ${who.hue})` }} aria-hidden="true" />{who.name}
                  </span>
                </TableCell>
                {hasKeys && <TableCell className="font-mono text-[12px] text-muted-foreground">{e.key ?? ''}</TableCell>}
                {shown.map((c) => {
                  const v = data[c]
                  const text = cell(v)
                  return (
                    <TableCell key={c} className={cn('max-w-64 truncate text-[13px]', typeof v === 'number' && 'tabular-nums', typeof v === 'boolean' && (v ? 'text-ok' : 'text-subtle'))} title={text}>
                      {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : text}
                    </TableCell>
                  )
                })}
                {hidden.length > 0 && (
                  <TableCell className="max-w-64 truncate font-mono text-[12px] text-subtle" title={JSON.stringify(Object.fromEntries(rest.map((k) => [k, data[k]])))}>
                    {rest.length ? JSON.stringify(Object.fromEntries(rest.map((k) => [k, data[k]]))) : ''}
                  </TableCell>
                )}
                <TableCell className="pr-3 text-right">
                  <Button variant="ghost" size="icon-sm" aria-label="Delete this response" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onDelete(e.id)}>
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

function HowTo() {
  return (
    <Card className="gap-4 px-6 py-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-input bg-background"><InboxIcon className="size-[18px]" /></span>
        <div className="grid gap-1">
          <h2 className="text-[15px] font-medium">No responses yet</h2>
          <p className="max-w-[52em] text-sm text-muted-foreground">
            A page saves what visitors enter when its script calls <code className="font-mono text-[13px]">aired.collect.save()</code>. Ask your AI tool to add it, or paste it in yourself. Responses show up here, and visitors can read back their own with <code className="font-mono text-[13px]">aired.collect.mine()</code>.
          </p>
        </div>
      </div>
      <CopyRow text={SNIPPET} label="Copy the save call" />
      <p className="text-xs text-subtle">Add <code className="font-mono">&lt;p data-aired-notice&gt;&lt;/p&gt;</code> to tell visitors the page saves what they enter. <a className="underline underline-offset-4 hover:text-foreground" href="/docs#data">How it works</a></p>
    </Card>
  )
}
