// The dashboard's top bar, in the marketing header's style and tokens:
// logo (and a workspace switcher), optional section links, and whatever
// sits on the right.
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/brand'
import { cn } from '@/lib/utils'

export type TopBarLink = { label: string; href: string; current?: boolean; onClick?: () => void }

export function TopBar({ links, right, label, switcher, className }: { links?: TopBarLink[]; right?: ReactNode; label?: string; switcher?: ReactNode; className?: string }) {
  return (
    <header className={cn('sticky top-0 z-20 border-b border-hairline bg-background/85 backdrop-blur-md', className)}>
      <div className="mx-auto flex h-16 max-w-(--aired-page-max) items-center gap-6 px-6">
        {switcher ? <span className="flex min-w-0 items-center gap-2"><span className="hidden sm:contents"><Logo /></span><span aria-hidden="true" className="hidden text-hairline-strong sm:inline">/</span>{switcher}</span> : <Logo />}
        {label && <span className="hidden border-l border-hairline pl-4 text-sm text-muted-foreground sm:block">{label}</span>}
        {links && (
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <a key={l.label} href={l.href} onClick={l.onClick ? (e) => { e.preventDefault(); l.onClick!() } : undefined} aria-current={l.current ? 'page' : undefined}
                className={cn(buttonVariants({ variant: 'ghost', shape: 'pill', size: 'lg' }), 'px-3.5 text-muted-foreground', l.current && 'bg-tint text-foreground')}>{l.label}</a>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">{right}</div>
      </div>
      {links && (
        <nav aria-label="Sections (small screens)" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          {links.map((l) => (
            <a key={l.label} href={l.href} onClick={l.onClick ? (e) => { e.preventDefault(); l.onClick!() } : undefined} aria-current={l.current ? 'page' : undefined}
              className={cn(buttonVariants({ variant: 'ghost', shape: 'pill', size: 'sm' }), 'px-3 text-muted-foreground', l.current && 'bg-tint text-foreground')}>{l.label}</a>
          ))}
        </nav>
      )}
    </header>
  )
}
