import { useMemo, useState } from 'react'
import {
  type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import {
  ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, DownloadIcon, EllipsisIcon,
  ExternalLinkIcon, EyeIcon, FileTextIcon, FlagIcon, FolderIcon, GlobeIcon, LayoutGridIcon, ListIcon, LockIcon, SearchIcon, Trash2Icon,
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CopyButton, KindIcon } from '@/components/common'
import { CopyLinkAction } from '@/components/icon-action'
import { PageCover } from '@/components/page-cover'
import { PageTile } from '@/components/page-tile'
import { PublishZone } from '@/components/publish-zone'
import { useIsMobile } from '@/hooks/use-mobile'
import { useClaim } from '@/hooks/use-claim'
import type { PagesState } from '@/App'
import { type Page, PAGE_CAP, UNSORTED, mutate } from '@/lib/api'
import {
  expiresMs, expiryWords, isExpired, isExpiringSoon, kindOf, plural, relativeAge, sizeWords, statusOf, viewsOf, viewsWords,
} from '@/lib/format'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'active' | 'soon' | 'pin' | 'expired'
const FILTERS: { key: Filter; label: string; test: (p: Page) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'active', label: 'Live', test: (p) => !isExpired(p) },
  { key: 'soon', label: 'Expiring soon', test: isExpiringSoon },
  { key: 'pin', label: 'With a PIN', test: (p) => p.hasPin },
  { key: 'expired', label: 'Expired', test: isExpired },
]

type Sort = 'newest' | 'views' | 'expiring'
const SORTS: { key: Sort; label: string; cmp: (a: Page, b: Page) => number }[] = [
  { key: 'newest', label: 'Newest', cmp: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') },
  { key: 'views', label: 'Most viewed', cmp: (a, b) => viewsOf(b) - viewsOf(a) },
  { key: 'expiring', label: 'Expiring first', cmp: (a, b) => (expiresMs(a) ?? Number.MAX_SAFE_INTEGER) - (expiresMs(b) ?? Number.MAX_SAFE_INTEGER) },
]

const LAYOUT_KEY = 'aired-pages-layout'
const host = typeof window !== 'undefined' ? window.location.host : 'aired.sh'
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://aired.sh'

export function PagesView({ pages, reload, removePage }: {
  pages: PagesState; reload: () => void; removePage: (id: string) => void
}) {
  const claim = useClaim(reload)
  const [filter, setFilter] = useState<Filter>('all')
  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [layout, setLayoutState] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' } })
  const setLayout = (l: 'grid' | 'list') => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* private mode */ } }
  const [deleting, setDeleting] = useState<Page | null>(null)

  const ready = pages.status === 'ready' ? pages : null
  const all = ready?.pages ?? []
  const totalViews = all.reduce((n, p) => n + viewsOf(p), 0)

  const inFolder = useMemo(() => (folder === null ? all : all.filter((p) => p.group === folder)), [all, folder])
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
    const q = query.trim().toLowerCase()
    const cmp = (SORTS.find((x) => x.key === sort) ?? SORTS[0]).cmp
    return inFolder.filter((p) => f.test(p) && (!q || `${p.title ?? ''} ${p.id} ${p.group === UNSORTED ? '' : p.group}`.toLowerCase().includes(q))).sort(cmp)
  }, [inFolder, filter, query, sort])

  const reset = () => { setFilter('all'); setQuery(''); setFolder(null) }

  return (
    <div className="grid min-w-0 gap-8">
      {claim.visible && <ClaimBanner claim={claim} />}

      {pages.status === 'loading' && <LoadingGrid />}

      {pages.status === 'error' && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">Could not load your pages.</p>
          <Button variant="outline" onClick={reload}>Try again</Button>
        </Card>
      )}

      {ready && all.length === 0 && <EmptyPages onPublished={reload} />}

      {ready && all.length > 0 && (
        <>
          <PublishZone title="Drop a file or paste HTML" description="You get a link anyone can open, on any phone or laptop." onPublished={reload} />

          <section aria-labelledby="pages-title" className="grid min-w-0 gap-6">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 id="pages-title" tabIndex={-1} className="mr-2 text-subheading font-medium tracking-tight outline-none">
                Your pages <span className="text-subtle">{all.length.toLocaleString()}</span>
                <span className="sr-only">, {plural(totalViews, 'view')} in all</span>
              </h1>
              <ToggleGroup aria-label="Show" variant="pill" spacing={1.5} value={[filter]} onValueChange={(v: unknown[]) => { if (v.length) setFilter(v[0] as Filter) }} className="max-w-full overflow-x-auto [scrollbar-width:none]">
                {FILTERS.map((f) => {
                  const n = inFolder.filter(f.test).length
                  if (f.key !== 'all' && n === 0) return null
                  return <ToggleGroupItem key={f.key} value={f.key}>{f.label}{f.key !== 'all' && <span className="ml-1.5 tabular-nums opacity-60">{n}</span>}</ToggleGroupItem>
                })}
              </ToggleGroup>
              <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
                <InputGroup className="h-9 min-w-0 flex-1 rounded-full border-hairline-strong sm:w-52 sm:flex-none">
                  <InputGroupAddon><SearchIcon /></InputGroupAddon>
                  <InputGroupInput type="search" aria-label="Search pages" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </InputGroup>
                <SortMenu value={sort} onChange={setSort} />
                <ToggleGroup aria-label="Layout" spacing={0} value={[layout]} onValueChange={(v: unknown[]) => { if (v.length) setLayout(v[0] as 'grid' | 'list') }} className="rounded-full border border-hairline-strong p-0.5">
                  <ToggleGroupItem value="grid" aria-label="Grid" size="sm" className="rounded-full"><LayoutGridIcon /></ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="List" size="sm" className="rounded-full"><ListIcon /></ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            {ready.projects.length > 0 && (
              <nav aria-label="Projects" className="-mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none]">
                {[null, ...ready.projects, UNSORTED].map((key) => {
                  const n = key === null ? all.length : all.filter((p) => p.group === key).length
                  if (n === 0) return null
                  const label = key === null ? 'All projects' : key === UNSORTED ? 'Not in a project' : key
                  return (
                    <button key={key ?? 'all'} type="button" aria-pressed={folder === key} onClick={() => setFolder(key)}
                      className={cn('flex h-9 shrink-0 items-center gap-2 rounded-xl border border-hairline px-3 text-sm text-muted-foreground transition-colors hover:border-hairline-strong hover:text-foreground', folder === key && 'border-hairline-strong bg-tint text-foreground')}>
                      {key === null ? <LayoutGridIcon className="size-4" /> : key === UNSORTED ? <FileTextIcon className="size-4" /> : <FolderIcon className="size-4" />}
                      {label}<span className="tabular-nums text-subtle">{n}</span>
                    </button>
                  )
                })}
              </nav>
            )}

            {shown.length === 0 ? (
              <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
                <p className="text-sm text-muted-foreground">{query.trim() ? `No pages match “${query.trim()}”.` : 'No pages here.'}</p>
                <Button variant="outline" onClick={reset}>Show all pages</Button>
              </Card>
            ) : layout === 'grid' ? (
              <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((p) => <RealTile key={p.id} page={p} onDelete={setDeleting} />)}
              </div>
            ) : (
              <PageList pages={shown} projects={folder === null ? ready.projects : []} onDelete={setDeleting} />
            )}
            {ready.truncated && <p className="text-center text-[13px] text-subtle">Showing your newest {PAGE_CAP.toLocaleString()} pages.</p>}
          </section>
        </>
      )}

      <DeleteDialog page={deleting} onClose={() => setDeleting(null)} onDeleted={(p) => { removePage(p.id); setDeleting(null) }} />
    </div>
  )
}

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const cur = SORTS.find((s) => s.key === value) ?? SORTS[0]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger render={<Button variant="outline" shape="pill" size="lg" className="shrink-0 border-hairline-strong" aria-label={`Sort: ${cur.label}`} />}>
        <span className="hidden sm:inline">{cur.label}</span><ArrowUpDownIcon className="sm:hidden" /><ChevronDownIcon className="hidden sm:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as Sort)}>
          {SORTS.map((s) => <DropdownMenuRadioItem key={s.key} value={s.key} className="rounded-lg px-2 py-1.5">{s.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ─── A page as a gallery tile ─── */
function RealTile({ page: p, onDelete }: { page: Page; onDelete: (p: Page) => void }) {
  const title = p.title || 'Untitled page'
  const e = expiryWords(p)
  const expired = isExpired(p)
  return (
    <PageTile
      origin={origin}
      href={`/p/${p.id}`}
      page={{ id: p.id, title, expires: e.text, soon: isExpiringSoon(p), pin: p.hasPin, views: viewsOf(p), published: relativeAge(p.createdAt), dim: expired }}
      cover={<PageCover kind={kindOf(p)} title={title} link={`${host}/p/${p.id}`} />}
      meta={
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-subtle">
          <EyeIcon className="size-3.5 shrink-0" /><span className="truncate">{viewsWords(p)} {viewsOf(p) === 1 && !p.reads ? 'view' : 'views'} · {relativeAge(p.createdAt)}{p.project ? ` · ${p.project}` : ''}</span>
        </p>
      }
      actions={<>
        <CopyLinkAction url={`${origin}/p/${p.id}`} name={title} />
        <PageMenu page={p} onDelete={onDelete} />
      </>}
    />
  )
}

function PageMenu({ page, onDelete }: { page: Page; onDelete: (p: Page) => void }) {
  const name = page.title || page.id
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" shape="pill" aria-label={`More for ${name}`} />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuItem render={<a href={`/p/${page.id}`} target="_blank" rel="noopener noreferrer" />}><ExternalLinkIcon /> Open in a new tab</DropdownMenuItem>
        <DropdownMenuItem render={<a href={`/abuse?id=${encodeURIComponent(page.id)}`} />}><FlagIcon /> Report a problem</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(page)}><Trash2Icon /> Delete page</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
      <PageMenu page={page} onDelete={onDelete} />
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

function LoadingGrid() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading your pages">
      <Skeleton className="h-36 rounded-3xl" />
      <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="grid gap-3"><Skeleton className="aspect-[3/2] rounded-xl" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>)}
      </div>
    </div>
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
const EXAMPLES = [
  { kind: 'chart', title: 'Q3 performance report', id: 'q3-report', facts: '14 views · 2 days ago' },
  { kind: 'game', title: 'Snake, made with ChatGPT', id: 'snake-v2', facts: '88 views · 5 hours ago' },
  { kind: 'slides', title: 'Parents’ evening slides', id: 'parents-evening', facts: '7 views · yesterday' },
] as const

function EmptyPages({ onPublished }: { onPublished: () => void }) {
  return (
    <>
      <h1 tabIndex={-1} className="sr-only">Your pages</h1>
      <PublishZone size="hero" title="Put your first page online" description="Drop the file Claude or ChatGPT made for you, or paste the code. You get a link anyone can open, on any phone or laptop." onPublished={onPublished} />
      <section aria-label="Example of how pages look here">
        <h2 className="text-center text-sm font-medium text-subtle">Your pages will show up here, like this</h2>
        <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-9 opacity-50 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {EXAMPLES.map((x) => (
            <div key={x.id}>
              <div className="overflow-hidden rounded-xl ring-1 ring-hairline"><PageCover kind={x.kind} title={x.title} link={`${host}/p/${x.id}`} /></div>
              <p className="mt-3 truncate px-0.5 text-body font-medium">{x.title}</p>
              <p className="mt-0.5 px-0.5 text-sm text-subtle">{x.facts}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
