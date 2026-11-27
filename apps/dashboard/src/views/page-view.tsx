// #page/<page id>: one page's panel. Its facts (size, expiry, views), then
// everything you can change after publishing: name, how long it lasts, view
// limit, who can open it, the PDF button, new content from a file, and a QR
// code. #share/<id> opens the same panel at "Who can open it";
// #page/<id>/qr and #page/<id>/replace open it at those parts.
import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon, ChartColumnIcon, ClockIcon, ExternalLinkIcon, EyeIcon, FileTextIcon, FolderIcon, HistoryIcon, InboxIcon, LockIcon, GlobeIcon, UsersIcon,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyRow } from '@/components/common'
import { AccessCard } from '@/components/access-card'
import { PdfCard } from '@/components/pdf-card'
import { QrCard } from '@/components/qr-card'
import { ReplaceCard } from '@/components/replace-card'
import { SettingsCard } from '@/components/settings-card'
import { PageThumb } from '@/components/page-thumb'
import { PageCover } from '@/components/page-cover'
import type { PagesState } from '@/App'
import type { Page } from '@/lib/api'
import { expiryWords, isExpired, kindOf, limitReached, plural, relativeAge, sizeWords, viewsOf } from '@/lib/format'
import { cn } from '@/lib/utils'

export function PageView({ sub, pages, isPro, reload, section: forced }: {
  sub: string; pages: PagesState; isPro: boolean; reload: () => void; section?: string
}) {
  const [pageId, section = forced] = sub.split('/')
  const page = pages.status === 'ready' ? pages.pages.find((p) => p.id === pageId) : undefined
  // Settings saved elsewhere on the panel change what the PDF card may offer.
  const [rev, setRev] = useState(0)
  const saved = () => { reload(); setRev((n) => n + 1) }

  useEffect(() => {
    if (!section || !page) return
    const t = setTimeout(() => document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 450)
    return () => clearTimeout(t)
  }, [section, pageId, !!page]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = <a href="#pages" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" />Your pages</a>

  if (!pageId) return <div className="grid gap-5">{back}<h1 tabIndex={-1} className="text-[26px] font-medium tracking-tight outline-none">Page</h1><p className="text-sm text-muted-foreground">Open a page’s menu and pick Settings.</p></div>

  if (pages.status === 'loading') {
    return <div className="grid gap-5" aria-busy="true" aria-label="Loading">{back}<Skeleton className="h-9 w-80" /><Skeleton className="h-72 rounded-xl" /></div>
  }
  if (pages.status === 'error' || !page) {
    return (
      <div className="grid gap-5">
        {back}
        <h1 tabIndex={-1} className="text-[26px] font-medium tracking-tight outline-none">Page not found</h1>
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">{pages.status === 'error' ? 'Could not load your pages.' : 'This page isn’t in your account, or it was deleted.'}</p>
          {pages.status === 'error' ? <Button variant="outline" onClick={reload}>Try again</Button> : <a href="#pages" className={buttonVariants({ variant: 'outline' })}>See all your pages</a>}
        </Card>
      </div>
    )
  }

  const title = page.title || 'Untitled page'
  const url = `${window.location.origin}/p/${page.id}`

  return (
    <div className="grid min-w-0 gap-6">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 tabIndex={-1} className="truncate text-[26px] leading-tight font-medium tracking-tight outline-none">{title}</h1>
          <Facts page={page} className="mt-3" />
        </div>
        <a href={`/p/${page.id}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}><ExternalLinkIcon />Open page</a>
      </div>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 gap-6">
          <SettingsCard key={`${page.id}:${page.title}:${page.reads}:${page.expiresAt}:${page.permanent}`} page={page} onSaved={saved} />
          <section id="section-access" aria-label="Who can open it" className="min-w-0 scroll-mt-24">
            <AccessCard pageId={page.id} isPro={isPro} onSaved={saved} />
          </section>
          <section aria-label="PDF" className="min-w-0">
            <PdfCard key={rev} pageId={page.id} isPro={isPro} />
          </section>
        </div>

        <aside className="grid min-w-0 gap-6 lg:sticky lg:top-24">
          <div className="grid gap-2">
            <Card variant="bare" className="overflow-hidden rounded-xl">
              <a href={`/p/${page.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title}`} className={cn('block', isExpired(page) && 'opacity-55 saturate-50')}>
                <PageThumb id={page.id} title={title} tile={page.tile} enabled={!isExpired(page) || limitReached(page)} fallback={<PageCover kind={kindOf(page)} title={title} link={`${window.location.host}/p/${page.id}`} />} />
              </a>
            </Card>
            <CopyRow text={url} label="Copy link" />
          </div>
          <ReplaceCard pageId={page.id} title={title} onReplaced={saved} />
          <QrCard pageId={page.id} url={url} />
          <nav aria-label="More for this page" className="grid gap-1">
            <MoreLink href={`#history/${page.id}`} icon={HistoryIcon}>History and undo</MoreLink>
            <MoreLink href={`#views/${page.id}`} icon={ChartColumnIcon}>Views</MoreLink>
            <MoreLink href={`#responses/${page.id}`} icon={InboxIcon}>Responses{page.responses ? <span className="ml-auto tabular-nums text-subtle">{page.responses.toLocaleString()}</span> : null}</MoreLink>
          </nav>
        </aside>
      </div>
    </div>
  )
}

function MoreLink({ href, icon: Icon, children }: { href: string; icon: typeof EyeIcon; children: React.ReactNode }) {
  return (
    <a href={href} className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-tint hover:text-foreground">
      <Icon className="size-4" />{children}
    </a>
  )
}

/** Size, expiry, views and who can open it, as small chips. */
export function Facts({ page: p, className }: { page: Page; className?: string }) {
  const e = expiryWords(p)
  return (
    <div className={cn('flex flex-wrap gap-1.5 text-xs text-muted-foreground', className)}>
      <Chip icon={ClockIcon} title={e.title} className={e.tone === 'good' ? 'text-ok' : e.tone === 'warn' ? 'text-warn' : ''}>{e.text}</Chip>
      <Chip icon={FileTextIcon}>{sizeWords(p.size)}</Chip>
      <Chip icon={EyeIcon}>{plural(viewsOf(p), 'view')}{p.reads ? ` of ${p.reads.toLocaleString()}` : ''}</Chip>
      <Chip icon={p.access === 'people' ? UsersIcon : p.hasPin ? LockIcon : GlobeIcon}>{p.access === 'people' ? 'Only people you choose' : p.hasPin ? 'Needs a PIN' : 'Anyone with the link'}</Chip>
      <Chip title={p.createdAt ? new Date(p.createdAt).toLocaleString() : undefined}>Published {relativeAge(p.createdAt)}</Chip>
      {p.project && <Chip icon={FolderIcon}>{p.project}</Chip>}
    </div>
  )
}

function Chip({ icon: Icon, children, className, title }: { icon?: typeof EyeIcon; children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title || undefined} className={cn('inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2', className)}>{Icon && <Icon className="size-3 opacity-70" />}{children}</span>
}
