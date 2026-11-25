// A page as a gallery tile: live preview, title, facts and quick actions.
import type { ReactNode } from 'react'
import { EllipsisIcon, EyeIcon, LockIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { CopyLinkAction, IconAction } from '@/components/icon-action'
import { PagePreview } from '@/components/page-preview'
import { cn } from '@/lib/utils'

export type TilePage = { id: string; title: string; html?: string; expires: string; soon?: boolean; pin: boolean; views: number; published: string; dim?: boolean }

/**
 * The top is a live preview when the page's HTML is at hand (mockups), or a
 * `cover` (the real dashboard: opening the page would count a view). `meta`
 * replaces the views line and `actions` the copy/more buttons. `href` opens
 * the page; `onOpen` handles the click instead.
 */
export function PageTile({ page, origin, meta, actions, onOpen, cover, href }: {
  page: TilePage; origin: string; meta?: ReactNode; actions?: ReactNode; onOpen?: () => void; cover?: ReactNode; href?: string
}) {
  return (
    <article className="group">
      <Card variant="bare" className="rounded-xl transition-all group-hover:-translate-y-0.5 group-hover:ring-hairline-strong">
        <a href={href ?? '#'} target={href ? '_blank' : undefined} rel={href ? 'noopener noreferrer' : undefined}
          onClick={onOpen ? (e) => { e.preventDefault(); onOpen() } : undefined} aria-label={`Open ${page.title}`} className={cn('relative block', page.dim && 'opacity-55 saturate-50')}>
          {cover ?? (page.html !== undefined && <PagePreview page={{ title: page.title, html: page.html }} />)}
          <span className="absolute inset-x-0 top-0 flex justify-between p-2.5">
            {page.pin ? <Badge variant="overlay"><LockIcon />PIN</Badge> : <span />}
            {(page.soon || page.dim) && <Badge variant="overlay">{page.expires}</Badge>}
          </span>
        </a>
      </Card>
      <div className="mt-3 flex items-start gap-1 px-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-medium text-foreground">{page.title}</h3>
          {meta ?? <p className="mt-0.5 flex items-center gap-1.5 text-sm text-subtle"><EyeIcon className="size-3.5" />{page.views} views · {page.published}</p>}
        </div>
        {actions ?? <>
          <CopyLinkAction url={`${origin}/p/${page.id}`} name={page.title} />
          <IconAction label={`More for ${page.title}`}><EllipsisIcon /></IconAction>
        </>}
      </div>
    </article>
  )
}
