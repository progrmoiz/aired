// A page as a compact list row with a small live preview (Studio's list).
import { LockIcon } from 'lucide-react'
import { PagePreview } from '@/components/page-preview'
import type { TilePage } from '@/components/page-tile'
import { cn } from '@/lib/utils'

export function PageListItem({ page, short, active }: { page: TilePage; short: string; active?: boolean }) {
  return (
    <a href="#" aria-current={active ? 'true' : undefined} className={cn('flex items-center gap-3 rounded-xl p-2 pr-3 transition-colors', active ? 'bg-tint ring-1 ring-hairline-strong' : 'hover:bg-tint')}>
      <span className="block w-[72px] shrink-0 overflow-hidden rounded-md ring-1 ring-hairline"><PagePreview page={page} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-foreground">{page.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
          <i className={cn('size-1.5 rounded-full', page.soon ? 'bg-warn' : 'bg-ok')} aria-hidden="true" />
          {page.views} views · {short}{page.pin && <LockIcon className="size-3" aria-label="Needs a PIN" />}
        </span>
      </span>
    </a>
  )
}
