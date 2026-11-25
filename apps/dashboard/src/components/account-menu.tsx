// The avatar and its menu: settings and billing live here in every direction.
import { CreditCardIcon, KeyRoundIcon, LogOutIcon, PlugIcon, UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AccountMenu({ name, plan, initial, defaultOpen }: { name: string; plan: string; initial: string; defaultOpen?: boolean }) {
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={false}>
      <DropdownMenuTrigger render={<Button size="icon-lg" shape="pill" aria-label="Account menu" className="bg-gradient-to-br from-(--aired-avatar-from) to-(--aired-avatar-to) text-(--aired-avatar-text) hover:opacity-90" />}>
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2"><span className="block text-sm font-medium text-foreground">{name}</span><span className="text-xs font-normal text-subtle">{plan} plan</span></DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem><UserIcon />Account</DropdownMenuItem>
        <DropdownMenuItem><CreditCardIcon />Plan &amp; billing</DropdownMenuItem>
        <DropdownMenuItem><PlugIcon />Connect your AI tools</DropdownMenuItem>
        <DropdownMenuItem><KeyRoundIcon />Developer keys</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem><LogOutIcon />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
