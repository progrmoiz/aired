// Header and footer in the marketing site's style (site.css), so the
// dashboard reads as the same product.
import { PlusIcon } from 'lucide-react'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/brand'
import { Avatar } from '@/components/app-sidebar'
import type { User } from '@/lib/api'
import { cn } from '@/lib/utils'

export function SiteHeader({ user }: { user: User | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-5 px-4 sm:px-8 lg:px-10">
        <SidebarTrigger className="-ml-1 md:hidden" aria-label="Open menu" />
        <span className="md:hidden"><Logo /></span>
        <nav aria-label="Main" className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <a className="hover:text-foreground" href="/pricing">Pricing</a>
          <a className="hover:text-foreground" href="/docs">Docs</a>
          <a className="hover:text-foreground" href="/html-to-link">Guides</a>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <a href="#account" className="hidden max-w-[14em] truncate text-muted-foreground hover:text-foreground sm:block">{user ? '@' + user.login : ''}</a>
          <a href="/#publish" className={cn(buttonVariants({ size: 'default' }), 'px-3')}><PlusIcon /> Publish</a>
          <a href="#account" className="sm:hidden" aria-label="Account"><Avatar user={user} /></a>
        </div>
      </div>
    </header>
  )
}

const FOOTER = [
  ['Pricing', '/pricing'], ['Docs', '/docs'], ['Guides', '/html-to-link'], ['Report abuse', '/abuse'],
  ['Terms', '/terms'], ['Privacy', '/privacy'], ['Refunds', '/refunds'], ['GitHub', 'https://github.com/progrmoiz/aired'],
] as const

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-[1120px] flex-wrap justify-between gap-x-6 gap-y-2 px-4 py-7 text-[13px] text-subtle sm:px-8 lg:px-10">
        <span>aired</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-[18px] gap-y-1.5">
          {FOOTER.map(([label, href]) => (
            <a key={href} href={href} className="inline-flex min-h-6 items-center hover:text-foreground" {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}>{label}</a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
