import { CreditCardIcon, FileTextIcon, PlugIcon, PlusIcon, UserIcon } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar'
import { buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/brand'
import type { View } from '@/hooks/use-hash-view'
import type { User } from '@/lib/api'
import type { PlanView } from '@/hooks/use-plan'
import { cn } from '@/lib/utils'

const NAV: { view: View; label: string; icon: typeof FileTextIcon }[] = [
  { view: 'pages', label: 'Pages', icon: FileTextIcon },
  { view: 'connect', label: 'Connect your AI tools', icon: PlugIcon },
  { view: 'billing', label: 'Plan & billing', icon: CreditCardIcon },
  { view: 'account', label: 'Account', icon: UserIcon },
]

export function Avatar({ user, className }: { user: User | null; className?: string }) {
  const initial = ((user?.name || user?.login || '').trim().charAt(0) || '·').toUpperCase()
  return (
    <span aria-hidden="true" className={cn('grid size-8 shrink-0 place-items-center rounded-full border border-input bg-gradient-to-br from-[#2c2c33] to-[#17171a] text-[13px] font-medium text-foreground', className)}>
      {initial}
    </span>
  )
}

export function AppSidebar({ view, user, plan }: { view: View; user: User | null; plan: PlanView }) {
  const { setOpenMobile } = useSidebar()
  const close = () => setOpenMobile(false)
  return (
    <Sidebar aria-label="Dashboard">
      <SidebarHeader className="gap-4 px-3 pt-4">
        <div className="px-2"><Logo /></div>
        <a href="/#publish" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
          <PlusIcon /> Publish a page
        </a>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Sections">
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.view}>
                    <SidebarMenuButton
                      isActive={view === item.view}
                      size="lg"
                      className="h-9 text-[14px]"
                      render={<a href={'#' + item.view} aria-current={view === item.view ? 'page' : undefined} onClick={close} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-1 px-3 pb-4">
        <div className="flex flex-col px-2 pb-2 text-[13px] text-subtle">
          <a className="py-1 hover:text-foreground" href="/html-to-link">Guides</a>
          <a className="py-1 hover:text-foreground" href="/docs">Docs</a>
          <a className="py-1 hover:text-foreground" href="/pricing">Pricing</a>
        </div>
        <a href="#account" onClick={close} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-input">
          <Avatar user={user} />
          <span className="grid min-w-0">
            <span className="truncate text-[13px] font-medium text-foreground">{user ? '@' + user.login : 'Signed in'}</span>
            <span className="text-xs text-subtle">{plan.loaded ? plan.tile.value + ' plan' : 'Account'}</span>
          </span>
        </a>
      </SidebarFooter>
    </Sidebar>
  )
}
