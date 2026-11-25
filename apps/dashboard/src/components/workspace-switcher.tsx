// The workspace switcher, next to the logo: who you're working as (yourself
// or a team), and the way into another team or a new one.
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, TicketIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type WorkspaceOption = { id: string; name: string; kind: string; initial: string; tone: string }

function Mark({ ws, className }: { ws: WorkspaceOption; className?: string }) {
  return <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold', ws.tone, className)}>{ws.initial}</span>
}

export function WorkspaceSwitcher({ workspaces, current, onChange, defaultOpen }: {
  workspaces: WorkspaceOption[]; current: string; onChange: (id: string) => void; defaultOpen?: boolean
}) {
  const ws = workspaces.find((w) => w.id === current) ?? workspaces[0]
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={false}>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 max-w-[52vw] gap-2 rounded-lg px-1.5 sm:max-w-none" aria-label={`Workspace: ${ws.name}. Switch workspace`} />}>
        <Mark ws={ws} />
        <span className="truncate text-sm font-medium text-foreground">{ws.name}</span>
        <ChevronsUpDownIcon className="text-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-xl p-1.5 shadow-pop">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-xs text-subtle">Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => onChange(w.id)} className="gap-2.5 rounded-lg px-2 py-2">
              <Mark ws={w} className="size-8 rounded-lg text-sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{w.name}</span><span className="block text-xs text-subtle">{w.kind}</span></span>
              {w.id === ws.id && <CheckIcon className="text-foreground" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="rounded-lg px-2 py-2"><PlusIcon />Create a team workspace</DropdownMenuItem>
        <DropdownMenuItem className="rounded-lg px-2 py-2"><TicketIcon />Join with an invite link</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
