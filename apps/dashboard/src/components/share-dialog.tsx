// The share dialog: invite people, groups or guests by name or email, see and
// change who has access, and set how the link works (who can open it, a PIN,
// when it stops working, a view limit). Opened from any page tile.
import { useState, type ReactNode } from 'react'
import { ChevronDownIcon, GlobeIcon, LockKeyholeIcon, QrCodeIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { CopyButton } from '@/components/common'
import { IconAction } from '@/components/icon-action'
import { AvatarStack, PersonAvatar } from '@/components/person'
import { cn } from '@/lib/utils'

export type AccessEntry = { name: string; detail: string; role: string; kind?: 'person' | 'group' | 'guest' | 'workspace'; members?: string[]; fixed?: boolean }

/** A compact picker: the current value as a button, the choices in a menu. */
export function ChoicePicker({ label, value: initial, options, danger, className, prefix }: {
  label: string; value: string; options: string[]; danger?: string; className?: string; prefix?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={cn('h-8 gap-1 px-2.5 text-sm text-muted-foreground', className)} aria-label={`${label}: ${value}`} />}>
        {prefix && <span className="text-subtle">{prefix}</span>}<span className="text-foreground">{value}</span><ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => setValue(v as string)}>
          {options.map((o) => <DropdownMenuRadioItem key={o} value={o} className="rounded-lg px-2 py-1.5">{o}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {danger && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" className="rounded-lg px-2 py-1.5">{danger}</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const GENERAL: { id: string; label: string; detail: (ws: string) => string; Icon: LucideIcon }[] = [
  { id: 'people', label: 'Only people with access', detail: () => 'Nobody else can open it, even with the link', Icon: LockKeyholeIcon },
  { id: 'workspace', label: 'Anyone in the workspace', detail: (ws) => `People in ${ws} can open it after signing in`, Icon: UsersIcon },
  { id: 'link', label: 'Anyone with the link', detail: () => 'No sign-in. Add a PIN or an end date below', Icon: GlobeIcon },
]

function GeneralAccess({ initial, workspace }: { initial: string; workspace: string }) {
  const [value, setValue] = useState(initial)
  const cur = GENERAL.find((g) => g.id === value) ?? GENERAL[2]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger render={<button type="button" className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-tint" />}>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', value === 'link' ? 'bg-ok/15 text-ok' : 'bg-secondary text-muted-foreground')}><cur.Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-sm font-medium text-foreground">{cur.label}<ChevronDownIcon className="size-3.5 text-subtle" /></span>
          <span className="block truncate text-xs text-subtle">{cur.detail(workspace)}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => setValue(v as string)}>
          {GENERAL.map((g) => (
            <DropdownMenuRadioItem key={g.id} value={g.id} className="items-start gap-2.5 rounded-lg px-2 py-2">
              <g.Icon className="mt-0.5" />
              <span><span className="block text-sm font-medium">{g.label}</span><span className="block text-xs text-subtle">{g.detail(workspace)}</span></span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Row({ avatar, title, detail, badge, right }: { avatar: ReactNode; title: string; detail: string; badge?: ReactNode; right: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground"><span className="truncate">{title}</span>{badge}</span>
        <span className="block truncate text-xs text-subtle">{detail}</span>
      </span>
      {right}
    </li>
  )
}

export function ShareDialog({ open, onOpenChange, title, where, workspace, access, general, pin, expires, url, urlLabel }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; where: string; workspace: string
  access: AccessEntry[]; general: 'people' | 'workspace' | 'link'; pin: boolean; expires: string; url: string; urlLabel: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 rounded-2xl p-0 shadow-pop sm:max-w-[560px]">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg font-medium tracking-tight">Share “{title}”</DialogTitle>
          <DialogDescription className="text-sm">{where}</DialogDescription>
        </DialogHeader>
        <div className="px-6">
          <div className="flex gap-2">
            <InputGroup className="h-10 flex-1 rounded-xl border-hairline-strong">
              <InputGroupInput aria-label="Add people, groups or emails" placeholder="Add people, groups or emails" />
              <ChoicePicker label="New people can" value="Can view" options={['Can view', 'Can edit']} className="mr-1 h-8" />
            </InputGroup>
            <Button className="h-10 rounded-xl px-4">Invite</Button>
          </div>
          <p className="mt-2 text-xs text-subtle">Emails outside the workspace join as guests: they see only what you share with them.</p>
        </div>

        <section aria-label="Who has access" className="px-6 pt-5">
          <h3 className="text-xs font-medium text-subtle">Who has access</h3>
          <ul className="mt-1.5 grid">
            {access.map((a) => (
              <Row key={a.name}
                avatar={a.kind === 'workspace' || a.kind === 'group'
                  ? <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground"><UsersIcon className="size-4" /></span>
                  : <PersonAvatar name={a.name} />}
                title={a.name}
                detail={a.detail}
                badge={a.kind === 'guest' ? <Badge variant="warn" className="h-5 px-2 text-[11px]">Guest</Badge> : a.kind === 'group' && a.members ? <AvatarStack names={a.members} size="xs" max={3} className="ml-1" /> : undefined}
                right={a.fixed ? <span className="px-2.5 text-sm text-subtle">{a.role}</span> : <ChoicePicker label={`${a.name} can`} value={a.role} options={['Can view', 'Can edit']} danger="Remove access" />}
              />
            ))}
          </ul>
        </section>

        <Separator className="mt-4" />
        <section aria-label="Link" className="px-6 pt-4">
          <h3 className="text-xs font-medium text-subtle">The link</h3>
          <div className="mt-1.5 -mx-2"><GeneralAccess initial={general} workspace={workspace} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-1 rounded-xl bg-tint p-1">
            <ChoicePicker label="PIN" prefix="PIN" value={pin ? 'On · 4 digits' : 'Off'} options={['Off', 'On · 4 digits', 'On · 6 digits']} />
            <ChoicePicker label="Stops working" prefix="Ends" value={expires} options={['In 1 day', 'In 7 days', 'In 30 days', expires, 'Never'].filter((v, i, a) => a.indexOf(v) === i)} />
            <ChoicePicker label="View limit" prefix="Limit" value="None" options={['None', '10 views', '50 views', '100 views']} />
          </div>
        </section>

        <div className="mt-5 flex items-center gap-2 border-t border-hairline bg-tint px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-hairline-strong bg-background py-1 pr-1 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{urlLabel}</span>
            <CopyButton text={url} label="Copy link" ariaLabel="Copy link" variant="secondary" className="bg-primary text-primary-foreground hover:bg-primary/85" />
          </div>
          <IconAction label="Show QR code"><QrCodeIcon /></IconAction>
        </div>
      </DialogContent>
    </Dialog>
  )
}
