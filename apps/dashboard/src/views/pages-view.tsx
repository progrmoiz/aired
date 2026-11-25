import { useMemo, useState } from 'react'
import {
  type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import {
  ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, CheckIcon, ChevronRightIcon, ClockIcon, DownloadIcon, EllipsisIcon,
  ExternalLinkIcon, EyeIcon, FileTextIcon, FlagIcon, FolderIcon, GlobeIcon, LockIcon, PlugIcon, SearchIcon, SparklesIcon, StarIcon, Trash2Icon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { CopyButton, Eyebrow, KindIcon, ViewHeader } from '@/components/common'
import { useIsMobile } from '@/hooks/use-mobile'
import { useClaim } from '@/hooks/use-claim'
import type { PlanView } from '@/hooks/use-plan'
import type { PagesState } from '@/App'
import { type Page, PAGE_CAP, UNSORTED, mutate } from '@/lib/api'
import {
  expiresMs, expiryWords, isExpired, isExpiringSoon, plural, relativeAge, sizeWords, statusOf, viewsOf, viewsWords,
} from '@/lib/format'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'active' | 'soon' | 'pin' | 'expired'
const FILTERS: { key: Filter; label: string; test: (p: Page) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'active', label: 'Active', test: (p) => !isExpired(p) },
  { key: 'soon', label: 'Expiring soon', test: isExpiringSoon },
  { key: 'pin', label: 'PIN-protected', test: (p) => p.hasPin },
  { key: 'expired', label: 'Expired', test: isExpired },
]

const host = typeof window !== 'undefined' ? window.location.host : 'aired.sh'
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://aired.sh'

export function PagesView({ pages, reload, removePage, plan }: {
  pages: PagesState; reload: () => void; removePage: (id: string) => void; plan: PlanView
}) {
  const claim = useClaim(reload)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<Page | null>(null)

  const ready = pages.status === 'ready' ? pages : null
  const all = ready?.pages ?? []
  const count = ready && all.length ? plural(all.length, 'page') + (ready.projects.length ? ' in ' + plural(ready.projects.length, 'project') : '') : ''

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
    const q = query.trim().toLowerCase()
    return all.filter((p) => f.test(p) && (!q || `${p.title ?? ''} ${p.id} ${p.group === UNSORTED ? '' : p.group}`.toLowerCase().includes(q)))
  }, [all, filter, query])

  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title="Pages" description={count || ' '} />

      {claim.visible && <ClaimBanner claim={claim} />}

      {pages.status === 'loading' && <LoadingList />}

      {pages.status === 'error' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">Could not load your pages.</p>
          <Button variant="outline" onClick={reload}>Try again</Button>
        </Card>
      )}

      {ready && all.length === 0 && <EmptyPages />}

      {ready && all.length > 0 && (
        <>
          <SummaryTiles pages={all} truncated={ready.truncated} plan={plan} onSoon={() => setFilter('soon')} />
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <InputGroup className="h-9 min-w-[220px] flex-1 bg-card">
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              <InputGroupInput type="search" aria-label="Search pages" placeholder="Search by title or link" value={query} onChange={(e) => setQuery(e.target.value)} />
            </InputGroup>
            <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0 [scrollbar-width:none]">
              <ToggleGroup
                aria-label="Show"
                variant="outline"
                size="sm"
                value={[filter]}
                onValueChange={(v: unknown[]) => { if (v.length) setFilter(v[0] as Filter) }}
              >
                {FILTERS.map((f) => (
                  <ToggleGroupItem key={f.key} value={f.key} className="h-8 gap-2 rounded-full px-3 data-[pressed]:border-primary data-[pressed]:bg-primary data-[pressed]:text-primary-foreground">
                    {f.label}
                    <span className="text-xs tabular-nums opacity-60">{all.filter(f.test).length}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>

          {shown.length === 0 ? (
            <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
              <p className="text-sm text-muted-foreground">{query.trim() ? `No pages match “${query.trim()}”.` : 'No pages here.'}</p>
              <Button variant="outline" onClick={() => { setFilter('all'); setQuery('') }}>Show all pages</Button>
            </Card>
          ) : (
            <PageList pages={shown} projects={ready.projects} onDelete={setDeleting} />
          )}
          {ready.truncated && <p className="text-center text-[13px] text-subtle">Showing your newest {PAGE_CAP.toLocaleString()} pages.</p>}
        </>
      )}

      <DeleteDialog page={deleting} onClose={() => setDeleting(null)} onDeleted={(p) => { removePage(p.id); setDeleting(null) }} />
    </div>
  )
}

/* ─── Claim banner ─── */
function ClaimBanner({ claim }: { claim: ReturnType<typeof useClaim> }) {
  const n = claim.entries.length
  const pending = claim.state === 'pending'
  return (
    <Card className="gap-3 px-5 py-4" aria-label="Pages published in this browser">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-input bg-background"><DownloadIcon className="size-[18px]" /></span>
        <div className="min-w-[200px] flex-1">
          <p className="text-[15px] font-medium">{n > 0 ? `${plural(n, 'page')} published in this browser without an account` : 'Some pages could not be added'}</p>
          {n > 0 && <p className="text-[13px] text-subtle">Add them to your account to manage them here.</p>}
        </div>
        <div className="flex gap-2">
          {n > 0 && (
            <Button onClick={claim.add} disabled={pending} aria-busy={pending || undefined}>
              {pending ? 'Adding…' : claim.state === 'idle' ? 'Add to my account' : 'Try again'}
            </Button>
          )}
          <Button variant="outline" onClick={claim.dismiss} disabled={pending}>{n === 0 ? 'Dismiss' : 'Not now'}</Button>
        </div>
      </div>
      {(claim.error || claim.failures.length > 0) && (
        <div className="pl-14 text-[13px] text-destructive max-sm:pl-0" role="alert">
          {claim.error && <p>{claim.error}</p>}
          {claim.failures.length > 0 && <ul>{claim.failures.map((f, i) => <li key={i}>Couldn’t add {f}</li>)}</ul>}
        </div>
      )}
    </Card>
  )
}

/* ─── Summary ─── */
function Tile({ icon: Icon, label, value, sub, onClick, href }: {
  icon: typeof EyeIcon; label: string; value: string; sub: string; onClick?: () => void; href?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[12.5px] text-subtle"><Icon className="size-3.5" />{label}</span>
      <span className="text-[26px] leading-tight font-medium tracking-tight tabular-nums max-sm:text-[22px]">{value}</span>
      <span className="truncate text-xs text-subtle group-hover/tile:text-foreground">{sub}</span>
    </>
  )
  const cls = 'group/tile grid gap-1 rounded-xl border border-border bg-card p-4 text-left ring-0 transition-colors'
  if (href) return <a href={href} className={cn(cls, 'hover:border-input')}>{body}</a>
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, 'cursor-pointer hover:border-input')}>{body}</button>
  return <div className={cls}>{body}</div>
}

function SummaryTiles({ pages, truncated, plan, onSoon }: { pages: Page[]; truncated: boolean; plan: PlanView; onSoon: () => void }) {
  const live = pages.filter((p) => !isExpired(p)).length
  const views = pages.reduce((n, p) => n + viewsOf(p), 0)
  const soon = pages.filter(isExpiringSoon).length
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile icon={CheckIcon} label="Live pages" value={live.toLocaleString()} sub={truncated ? `First ${PAGE_CAP.toLocaleString()} pages` : `${plural(pages.length, 'page')} in total`} />
      <Tile icon={EyeIcon} label="Total views" value={views.toLocaleString()} sub="Across all your pages" />
      <Tile icon={ClockIcon} label="Expiring this week" value={soon.toLocaleString()} sub={soon ? 'Show them' : 'Nothing expires this week'} onClick={soon ? onSoon : undefined} />
      <Tile icon={StarIcon} label="Plan" value={plan.loaded ? plan.tile.value : '–'} sub={plan.loaded ? plan.tile.sub : ' '} href="#billing" />
    </div>
  )
}

/* ─── Page list: data table on desktop, cards on phones ─── */
function StatusBadges({ page }: { page: Page }) {
  const s = statusOf(page)
  return (
    <span className="flex flex-wrap gap-1">
      {s === 'live' && <Badge variant="outline" className="border-ok/30 text-ok"><span className="size-1.5 rounded-full bg-ok" />Live</Badge>}
      {s === 'soon' && <Badge variant="outline" className="border-input">Expiring</Badge>}
      {s === 'expired' && <Badge variant="secondary" className="text-subtle">Expired</Badge>}
      {page.hasPin && <Badge variant="outline" className="border-input"><LockIcon />PIN</Badge>}
    </span>
  )
}

function RowActions({ page, onDelete, start }: { page: Page; onDelete: (p: Page) => void; start?: boolean }) {
  const name = page.title || page.id
  return (
    <div className={cn('flex items-center gap-1', start ? 'justify-start' : 'justify-end')}>
      <CopyButton text={`${origin}/p/${page.id}`} label="Copy link" ariaLabel={`Copy link to ${name}`} />
      <Tooltip>
        <TooltipTrigger render={<a href={`/p/${page.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} in a new tab`} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} />}>
          <ExternalLinkIcon />
        </TooltipTrigger>
        <TooltipContent>Open</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`} />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem render={<a href={`/abuse?id=${encodeURIComponent(page.id)}`} />}>
            <FlagIcon /> Report a problem
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(page)}>
            <Trash2Icon /> Delete page
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SortHeader({ label, column }: { label: string; column: { getIsSorted: () => false | 'asc' | 'desc'; toggleSorting: (desc?: boolean) => void } }) {
  const s = column.getIsSorted()
  const Icon = s === 'asc' ? ArrowUpIcon : s === 'desc' ? ArrowDownIcon : ArrowUpDownIcon
  return (
    <button type="button" className="-ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground" onClick={() => column.toggleSorting(s === 'asc')}
      aria-label={`Sort by ${label.toLowerCase()}`}>
      {label}<Icon className="size-3.5 opacity-60" />
    </button>
  )
}

function useColumns(onDelete: (p: Page) => void): ColumnDef<Page>[] {
  return useMemo(() => [
    {
      id: 'page',
      header: ({ column }) => <SortHeader label="Page" column={column} />,
      accessorFn: (p) => p.createdAt,
      cell: ({ row: { original: p } }) => (
        <div className="flex min-w-0 items-center gap-3">
          <KindIcon page={p} />
          <div className="min-w-0">
            <a href={`/p/${p.id}`} target="_blank" rel="noopener noreferrer" className={cn('block truncate text-[14px] font-medium hover:underline hover:decoration-input hover:underline-offset-4', isExpired(p) && 'text-muted-foreground')}>
              {p.title || 'Untitled page'}
            </a>
            <p className="truncate text-xs text-subtle"><span className="font-mono">{host}/p/{p.id}</span> · {relativeAge(p.createdAt)}</p>
          </div>
        </div>
      ),
    },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadges page={row.original} />, enableSorting: false },
    {
      id: 'expires',
      header: ({ column }) => <SortHeader label="Expires" column={column} />,
      accessorFn: (p) => expiresMs(p) ?? Number.MAX_SAFE_INTEGER,
      cell: ({ row: { original: p } }) => {
        const e = expiryWords(p)
        return <span title={e.title || undefined} className={cn('whitespace-nowrap text-[13px]', e.tone === 'good' ? 'text-ok' : 'text-muted-foreground')}>{e.text}</span>
      },
    },
    {
      id: 'views',
      header: ({ column }) => <SortHeader label="Views" column={column} />,
      accessorFn: viewsOf,
      cell: ({ row: { original: p } }) => <span className="text-[13px] tabular-nums text-muted-foreground" title={p.reads ? `Stops opening after ${plural(p.reads, 'view')}` : undefined}>{viewsWords(p)}</span>,
    },
    { id: 'size', header: 'Size', cell: ({ row }) => <span className="whitespace-nowrap text-[13px] text-muted-foreground">{sizeWords(row.original.size)}</span>, enableSorting: false },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => <RowActions page={row.original} onDelete={onDelete} />, enableSorting: false },
  ], [onDelete])
}

function groupLabel(key: string, projects: string[]) {
  return key !== UNSORTED ? key : projects.length ? 'Not in a project' : 'All pages'
}

function PageList({ pages, projects, onDelete }: { pages: Page[]; projects: string[]; onDelete: (p: Page) => void }) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = useState<SortingState>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const columns = useColumns(onDelete)
  const table = useReactTable({ data: pages, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })
  const rows = table.getRowModel().rows
  const order = projects.length ? [...projects, UNSORTED] : [UNSORTED]
  const groups = order.map((key) => ({ key, rows: rows.filter((r) => r.original.group === key) })).filter((g) => g.rows.length)
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  if (isMobile) {
    return (
      <div className="grid gap-3">
        {groups.map((g) => (
          <Card key={g.key} className="gap-0 overflow-visible py-0">
            <GroupToggle label={groupLabel(g.key, projects)} count={g.rows.length} open={!collapsed[g.key]} onClick={() => toggle(g.key)} unsorted={g.key === UNSORTED} />
            {!collapsed[g.key] && (
              <ul>
                {g.rows.map(({ original: p }) => {
                  const e = expiryWords(p)
                  return (
                    <li key={p.id} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-t border-border px-4 py-4">
                      <KindIcon page={p} />
                      <div className="min-w-0">
                        <a href={`/p/${p.id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-[15px] font-medium">{p.title || 'Untitled page'}</a>
                        <p className="truncate text-xs text-subtle"><span className="font-mono">{host}/p/{p.id}</span> · {relativeAge(p.createdAt)}</p>
                        <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                          <Fact icon={ClockIcon} className={e.tone === 'good' ? 'text-ok' : ''}>{e.text}</Fact>
                          <Fact icon={p.hasPin ? LockIcon : GlobeIcon}>{p.hasPin ? 'Needs a PIN' : 'Anyone with the link'}</Fact>
                          <Fact icon={EyeIcon}>{plural(viewsOf(p), 'view')}{p.reads ? ` of ${p.reads.toLocaleString()}` : ''}</Fact>
                          <Fact icon={FileTextIcon}>{sizeWords(p.size)}</Fact>
                        </div>
                        <div className="mt-3"><RowActions page={p} onDelete={onDelete} start /></div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>
    )
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="table-fixed">
        <colgroup><col /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[90px]" /><col className="w-[84px]" /><col className="w-[200px]" /></colgroup>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => (
                <TableHead key={h.id} className="h-10 px-4 text-xs font-medium text-subtle">{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <GroupRows key={g.key} label={groupLabel(g.key, projects)} unsorted={g.key === UNSORTED} open={!collapsed[g.key]} onToggle={() => toggle(g.key)} count={g.rows.length}>
              {g.rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-white/[0.02]">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-4 py-3">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))}
            </GroupRows>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function Fact({ icon: Icon, children, className }: { icon: typeof EyeIcon; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2', className)}><Icon className="size-3 opacity-70" />{children}</span>
}

function GroupToggle({ label, count, open, onClick, unsorted }: { label: string; count: number; open: boolean; onClick: () => void; unsorted: boolean }) {
  const Icon = unsorted ? FileTextIcon : FolderIcon
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] font-medium hover:bg-white/[0.02]">
      <ChevronRightIcon className={cn('size-4 text-subtle transition-transform', open && 'rotate-90')} />
      <Icon className="size-4 text-subtle" />
      <span className="min-w-0 truncate">{label}</span>
      <Badge variant="outline" className="ml-auto border-input tabular-nums text-muted-foreground">{count}</Badge>
    </button>
  )
}

function GroupRows({ label, count, open, onToggle, unsorted, children }: { label: string; count: number; open: boolean; onToggle: () => void; unsorted: boolean; children: React.ReactNode }) {
  return (
    <>
      <TableRow className="bg-white/[0.015] hover:bg-white/[0.03]">
        <TableCell colSpan={6} className="p-0"><GroupToggle label={label} count={count} open={open} onClick={onToggle} unsorted={unsorted} /></TableCell>
      </TableRow>
      {open && children}
    </>
  )
}

function LoadingList() {
  return (
    <Card className="gap-0 py-0" aria-busy="true" aria-label="Loading your pages">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 border-t border-border px-4 py-4 first:border-t-0">
          <Skeleton className="size-9 rounded-lg" />
          <div className="grid flex-1 gap-2"><Skeleton className="h-3.5 w-56 max-w-full" /><Skeleton className="h-3 w-36" /></div>
          <Skeleton className="hidden h-7 w-24 sm:block" />
        </div>
      ))}
    </Card>
  )
}

/* ─── Delete ─── */
function DeleteDialog({ page, onClose, onDeleted }: { page: Page | null; onClose: () => void; onDeleted: (p: Page) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = page?.title || 'Untitled page'
  const confirm = async () => {
    if (!page) return
    setBusy(true); setError('')
    try {
      const res = await mutate('DELETE', '/api/pages/' + page.id)
      if (!res.ok) throw new Error(String(res.status))
      toast.success('Deleted “' + name + '”')
      onDeleted(page)
    } catch {
      setError('Could not delete. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={!!page} onOpenChange={(open) => { if (!open && !busy) { setError(''); onClose() } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>The link stops working for everyone. This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" className="bg-destructive text-background hover:bg-destructive/85 dark:bg-destructive dark:hover:bg-destructive/85 focus-visible:ring-destructive/40" onClick={confirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete page'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/* ─── Empty ─── */
function EmptyPages() {
  const sample = [
    { title: 'Q3 performance report', id: 'q3-northwind', hasPin: true, age: '2 days ago', facts: [['Never expires', ClockIcon, true], ['Needs a PIN', LockIcon], ['14 views', EyeIcon]] },
    { title: 'Snake, made with ChatGPT', id: 'snake-v2', hasPin: false, age: '5 hours ago', facts: [['Expires in 7 days', ClockIcon], ['Anyone with the link', GlobeIcon], ['88 views', EyeIcon]] },
  ] as const
  return (
    <Card className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
      <Empty className="items-start p-0 text-left">
        <EmptyHeader className="max-w-none items-start">
          <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
          <Eyebrow>Get started</Eyebrow>
          <EmptyTitle className="text-[22px] font-medium">Your first page goes here</EmptyTitle>
          <EmptyDescription className="text-[15px]">Publish while you’re signed in and the page shows up here, with how long it lasts and how many times it was opened.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-none items-start">
          <ol className="grid gap-4 text-left text-sm text-muted-foreground">
            {[['Copy the HTML', 'From Claude, ChatGPT, Gemini or a file on your computer.'], ['Paste it on the homepage', 'Pick how long it lasts. Add a PIN if it’s private.'], ['Send the link', 'It opens on any phone or laptop.']].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[26px_1fr] gap-3">
                <span className="grid size-[26px] place-items-center rounded-lg border border-input bg-background text-xs font-medium text-foreground">{i + 1}</span>
                <span><b className="block font-medium text-foreground">{t}</b>{d}</span>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href="/#publish" className={buttonVariants({ size: 'lg' })}>Publish your first page</a>
            <a href="#connect" className={buttonVariants({ size: 'lg', variant: 'outline' })}><PlugIcon />Let your AI tool publish</a>
          </div>
        </EmptyContent>
      </Empty>
      <div className="overflow-hidden rounded-xl border border-dashed border-input bg-background" aria-label="Example of how pages look here">
        <div className="flex justify-between border-b border-dashed border-input px-4 py-2.5 text-xs text-subtle"><span>Example</span><span>2 pages</span></div>
        {sample.map((s) => (
          <div key={s.id} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-t border-border px-4 py-4 first:border-t-0">
            <KindIcon page={{ title: s.title, hasPin: s.hasPin }} />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium">{s.title}</p>
              <p className="truncate text-xs text-subtle"><span className="font-mono">aired.sh/p/{s.id}</span> · Published {s.age}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                {s.facts.map(([t, Icon, good]) => <Fact key={t} icon={Icon} className={good ? 'text-ok' : ''}>{t}</Fact>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
