// The avatar and its menu: account, plan, AI tools, the theme, sign out.
// Used by the real dashboard and the mockups (which pass no handlers).
import { useState } from 'react'
import { CreditCardIcon, KeyRoundIcon, LogOutIcon, MonitorIcon, MoonIcon, PlugIcon, SunIcon, UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

/** The signed-in person's round initial, in the token avatar gradient. */
export function UserBadge({ initial, className }: { initial: string; className?: string }) {
  return <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-(--aired-avatar-from) to-(--aired-avatar-to) text-sm font-medium text-(--aired-avatar-text)', className)}>{initial}</span>
}

export function AccountMenu({ name, plan, initial, defaultOpen, theme, onTheme, onSignOut }: {
  name: string; plan: string; initial: string; defaultOpen?: boolean
  theme?: ThemePref; onTheme?: (t: ThemePref) => void; onSignOut?: () => Promise<void> | void
}) {
  const [signingOut, setSigningOut] = useState(false)
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={false}>
      <DropdownMenuTrigger render={<Button size="icon-lg" shape="pill" aria-label="Account menu" className="bg-gradient-to-br from-(--aired-avatar-from) to-(--aired-avatar-to) text-(--aired-avatar-text) hover:opacity-90" />}>
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2"><span className="block truncate text-sm font-medium text-foreground">{name}</span><span className="text-xs font-normal text-subtle">{plan}</span></DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="#account" />}><UserIcon />Account</DropdownMenuItem>
        <DropdownMenuItem render={<a href="#billing" />}><CreditCardIcon />Plan &amp; billing</DropdownMenuItem>
        <DropdownMenuItem render={<a href="#connect" />}><PlugIcon />Connect your AI tools</DropdownMenuItem>
        <DropdownMenuItem render={<a href="#connect" />}><KeyRoundIcon />Developer keys</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-xs font-normal text-subtle">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? 'midnight'} onValueChange={(v) => onTheme?.(v as ThemePref)}>
            <DropdownMenuRadioItem value="system" closeOnClick={false}><MonitorIcon />System</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="midnight" closeOnClick={false}><MoonIcon />Midnight</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="daylight" closeOnClick={false}><SunIcon />Daylight</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onClick={async () => { if (!onSignOut) return; setSigningOut(true); try { await onSignOut() } finally { setSigningOut(false) } }}>
          <LogOutIcon />{signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
