// A cover for a page tile when we don't render the page itself (the real
// dashboard: loading /p/:id would count a view and could hit a view limit).
// The kind of page sets the icon and the tint; the title sits on a sheet.
import { ChartColumnIcon, FileTextIcon, Gamepad2Icon, GlobeIcon, PresentationIcon } from 'lucide-react'
import type { Kind } from '@/lib/format'
import { cn } from '@/lib/utils'

const KIND = {
  slides: { Icon: PresentationIcon, tone: 'from-amber-400/25 text-amber-600 dark:text-amber-300', label: 'Slides' },
  chart: { Icon: ChartColumnIcon, tone: 'from-emerald-400/25 text-emerald-700 dark:text-emerald-300', label: 'Report' },
  game: { Icon: Gamepad2Icon, tone: 'from-pink-400/25 text-pink-600 dark:text-pink-300', label: 'Game' },
  site: { Icon: GlobeIcon, tone: 'from-sky-400/25 text-sky-700 dark:text-sky-300', label: 'Site' },
  doc: { Icon: FileTextIcon, tone: 'from-violet-400/25 text-violet-700 dark:text-violet-300', label: 'Page' },
} as const

export function PageCover({ kind, title, link }: { kind: Kind; title: string; link: string }) {
  const k = KIND[kind]
  return (
    <div className={cn('relative grid aspect-[3/2] w-full place-items-center overflow-hidden bg-gradient-to-br to-transparent to-70%', k.tone)}>
      <div className="w-[72%] rounded-lg bg-card p-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)] ring-1 ring-hairline">
        <span className="flex items-center gap-1.5 text-[11px] font-medium"><k.Icon className="size-3.5" />{k.label}</span>
        <p className="mt-2 line-clamp-2 text-md leading-snug font-medium text-foreground">{title}</p>
        <div className="mt-3 grid gap-1.5" aria-hidden="true"><span className="h-1.5 w-full rounded-full bg-tint ring-1 ring-hairline" /><span className="h-1.5 w-2/3 rounded-full bg-tint ring-1 ring-hairline" /></div>
        <p className="mt-3 truncate font-mono text-[10px] text-subtle">{link}</p>
      </div>
    </div>
  )
}
