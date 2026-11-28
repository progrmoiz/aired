// #history/<page id>: every version of one page that's kept, as a gallery
// of previews, newest first, with Restore on each earlier one. Restoring
// puts that content live as a new version, so the history only grows.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftIcon, ExternalLinkIcon, HistoryIcon, MaximizeIcon, RotateCcwIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LoadError, ViewHeader } from '@/components/common'
import { NeutralPlaceholder, forgetPreview } from '@/components/live-preview'
import { forgetTile } from '@/components/page-thumb'
import { PagePreview } from '@/components/page-preview'
import type { PagesState } from '@/App'
import { getJson, mutate, readJson } from '@/lib/api'
import { plural, relativeAge, sizeWords } from '@/lib/format'
import { cn } from '@/lib/utils'

type Version = {
  version: number
  current: boolean
  size: number
  title: string | null
  kind: 'page' | 'doc' | 'deck'
  actor: 'owner' | 'token' | 'agent' | 'unknown'
  client: string | null
  message: string | null
  restored_from: number | null
  created_at: string | null
  replaced_at: string | null
  kept_until: string | null
}
type History = {
  id: string
  url: string
  current: number | null
  versions: Version[]
  kept: { plan: string; versions: number; days: number | null; always_keep: number; summary: string }
}
type State = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ready'; history: History }

/** Each version's HTML, fetched once per page and version (the live one is fetched again after a restore). */
const htmlCache = new Map<string, Promise<string | null>>()
function versionHtml(pageId: string, n: number): Promise<string | null> {
  const key = `${pageId}:${n}`
  let p = htmlCache.get(key)
  if (!p) {
    p = getJson<{ html: string }>(`/api/pages/${encodeURIComponent(pageId)}/versions/${n}`)
      .then((r) => r.html)
      .catch(() => { htmlCache.delete(key); return null })
    htmlCache.set(key, p)
  }
  return p
}

const WHO: Record<Version['actor'], string> = { owner: 'You', token: 'Update token', agent: 'An AI agent', unknown: '' }
const CLIENT: Record<string, string> = { web: 'dashboard', cli: 'CLI', mcp: 'MCP', api: 'API' }

function byLine(v: Version): string {
  if (v.actor === 'unknown') return 'Before history was kept'
  const via = v.client !== null && CLIENT[v.client] ? ` · ${CLIENT[v.client]}` : ''
  return `${WHO[v.actor]}${via}`
}

export function HistoryView({ pageId, pages, onRestored }: { pageId: string; pages: PagesState; onRestored: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [restoring, setRestoring] = useState<Version | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Version | null>(null)
  const page = pages.status === 'ready' ? pages.pages.find((p) => p.id === pageId) : undefined

  const load = useCallback(() => {
    if (!pageId) return
    getJson<History>(`/api/pages/${encodeURIComponent(pageId)}/versions`)
      .then((history) => setState({ status: 'ready', history }))
      .catch((err: { status?: number }) => setState({ status: err.status === 404 || err.status === 403 ? 'missing' : 'error' }))
  }, [pageId])
  useEffect(load, [load])

  const history = state.status === 'ready' ? state.history : null
  const live = history?.versions.find((v) => v.current)
  const earlier = history ? history.versions.filter((v) => !v.current) : []
  const title = page?.title || live?.title || 'Untitled page'

  async function restore() {
    if (!restoring || !history) return
    setBusy(true)
    try {
      const res = await mutate('POST', `/api/pages/${encodeURIComponent(pageId)}/versions/${restoring.version}/restore`, {})
      const body = await readJson(res)
      if (!res.ok) { toast.error(String(body.error ?? 'Could not restore that version')); return }
      toast.success(`Version ${restoring.version} is live again, as version ${String(body.version ?? '')}`)
      // The live page changed: its tile, preview and the live version's HTML.
      if (live) htmlCache.delete(`${pageId}:${live.version}`)
      forgetPreview(pageId); forgetTile(pageId)
      setRestoring(null)
      load()
      onRestored()
    } finally {
      setBusy(false)
    }
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

  if (!pageId) {
    return (
      <div className="grid gap-5">
        <ViewHeader title="History" description="Open a page’s menu and pick See history." />
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-6">
      <ViewHeader title={title} description={description} />
      {state.status === 'loading' && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading the history">
          {[0, 1, 2].map((i) => <div key={i} className="grid gap-3"><Skeleton className="aspect-[3/2] rounded-xl" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>)}
        </div>
      )}
      {state.status === 'missing' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">This page isn’t in your account.</p>
          <a href="#pages" className={buttonVariants({ variant: 'outline' })}>See all your pages</a>
        </Card>
      )}
      {state.status === 'error' && (
        <LoadError what="this page’s history" onRetry={load} />
      )}
      {history && (
        <>
          <section aria-labelledby="history-title" className="grid min-w-0 gap-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="history-title" className="text-subheading font-medium tracking-tight">
                History <span className="text-subtle">{history.versions.length.toLocaleString()}</span>
              </h2>
              <p className="text-sm text-subtle">
                {live ? `Version ${live.version} is live` : ''}{earlier.length > 0 ? ` · ${plural(earlier.length, 'earlier version')} kept` : ' · no earlier versions yet'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {history.versions.map((v) => (
                <VersionTile key={v.version} pageId={pageId} v={v} onOpen={() => setOpen(v)} onRestore={() => setRestoring(v)} />
              ))}
            </div>
            {earlier.length === 0 && (
              <Card className="flex-row items-center gap-3 px-5 py-4">
                <HistoryIcon className="size-4 shrink-0 text-subtle" />
                <p className="text-sm text-muted-foreground">Every time this page is updated, from here, the CLI or an AI agent, the version it replaces shows up here, ready to restore.</p>
              </Card>
            )}
          </section>
          <p className="text-xs text-subtle">
            {history.kept.summary} Restoring a version makes it live again as a new version, so nothing here is lost and you can undo it the same way. Deleting the page deletes its history.
          </p>
        </>
      )}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null) }}>
        <DialogContent className="sm:max-w-4xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>Version {open.version}{open.current ? ' · live' : ''}</DialogTitle>
                <DialogDescription>{open.created_at ? new Date(open.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Published before history was kept'} · {byLine(open)}{open.message ? ` · “${open.message}”` : ''}</DialogDescription>
              </DialogHeader>
              <VersionPreview pageId={pageId} v={open} interactive className="rounded-lg ring-1 ring-hairline" />
              {!open.current && (
                <div className="flex justify-end">
                  <Button onClick={() => { setRestoring(open); setOpen(null) }}><RotateCcwIcon />Restore this version</Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!restoring} onOpenChange={(o) => { if (!o && !busy) setRestoring(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {restoring?.version}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone with the link sees it straight away. It goes live as version {(history?.versions[0]?.version ?? 0) + 1}, and the version live now stays in the history, so you can switch back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button onClick={restore} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Restoring…' : 'Restore'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** A version's look, drawn small once its tile scrolls into view. */
function VersionPreview({ pageId, v, interactive = false, className }: { pageId: string; v: Version; interactive?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState<string | null | undefined>(undefined)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver((items) => {
      if (!items.some((i) => i.isIntersecting)) return
      io.disconnect()
      void versionHtml(pageId, v.version).then((h) => { if (alive) setHtml(h) })
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [pageId, v.version])
  return (
    <div ref={box} className={cn('relative overflow-hidden', className)}>
      <NeutralPlaceholder className={cn(html && shown && 'invisible')} />
      {html === null && <p className="absolute inset-0 grid place-items-center text-sm text-subtle">No preview</p>}
      {html && (
        <div className={cn('absolute inset-0 transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')}>
          <PagePreview page={{ title: `version ${v.version}`, html }} scripts interactive={interactive} onLoad={() => setShown(true)} className="h-full" />
        </div>
      )}
    </div>
  )
}

function VersionTile({ pageId, v, onOpen, onRestore }: { pageId: string; v: Version; onOpen: () => void; onRestore: () => void }) {
  const when = v.created_at ? relativeAge(v.created_at) : 'Before history'
  const exact = v.created_at ? new Date(v.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : undefined
  return (
    <article className="group">
      <Card variant="bare" className={cn('rounded-xl transition-all group-hover:-translate-y-0.5 group-hover:ring-hairline-strong', v.current && 'ring-ok/40')}>
        <button type="button" onClick={onOpen} aria-label={`Look at version ${v.version}`} className="relative block w-full text-left">
          <VersionPreview pageId={pageId} v={v} />
          <span className="absolute inset-x-0 top-0 flex justify-between p-2.5">
            <Badge variant="overlay">v{v.version}</Badge>
            {v.current ? <Badge variant="overlay" className="text-ok"><span className="size-1.5 rounded-full bg-ok" />Live</Badge> : <span />}
          </span>
          <span className="absolute right-2.5 bottom-2.5 opacity-0 transition-opacity group-hover:opacity-100"><Badge variant="overlay"><MaximizeIcon />Look closer</Badge></span>
        </button>
      </Card>
      <div className="mt-3 flex items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-medium text-foreground">{v.message ?? v.title ?? `Version ${v.version}`}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-subtle" title={exact}>
            {when} · {byLine(v)} · {sizeWords(v.size)}{v.restored_from !== null ? ` · restored from v${v.restored_from}` : ''}
          </p>
        </div>
        {!v.current && (
          <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={onRestore} aria-label={`Restore version ${v.version}`}>
            <RotateCcwIcon />Restore
          </Button>
        )}
      </div>
    </article>
  )
}
