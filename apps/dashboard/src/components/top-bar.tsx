// The dashboard's top bar, in the marketing header's style and tokens:
// logo, optional section links, and whatever sits on the right.
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/brand'
import { cn } from '@/lib/utils'

export function TopBar({ links, right, label, className }: { links?: { label: string; href: string; current?: boolean }[]; right?: ReactNode; label?: string; className?: string }) {
  return (
    <header className={cn('sticky top-0 z-20 border-b border-hairline bg-background/85 backdrop-blur-md', className)}>
      <div className="mx-auto flex h-16 max-w-(--aired-page-max) items-center gap-6 px-5 sm:px-8">
        <Logo />
        {label && <span className="hidden border-l border-hairline pl-4 text-sm text-muted-foreground sm:block">{label}</span>}
        {links && (
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <a key={l.label} href={l.href} aria-current={l.current ? 'page' : undefined}
                className={cn(buttonVariants({ variant: 'ghost', shape: 'pill', size: 'lg' }), 'px-3.5 text-muted-foreground', l.current && 'bg-tint text-foreground')}>{l.label}</a>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">{right}</div>
      </div>
    </header>
  )
}
