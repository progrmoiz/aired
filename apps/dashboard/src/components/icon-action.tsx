// A labelled icon button with a tooltip, and a copy-link variant that
// confirms with a toast. Built on Button + Tooltip + Sonner.
import type { ReactNode } from 'react'
import { CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText } from '@/lib/api'

export function IconAction({ label, children, onClick, render }: { label: string; children: ReactNode; onClick?: () => void; render?: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={render ?? <Button variant="ghost" size="icon" shape="pill" aria-label={label} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CopyLinkAction({ url, name }: { url: string; name: string }) {
  return (
    <IconAction label={`Copy link to ${name}`} onClick={async () => { await copyText(url); toast.success('Link copied') }}>
      <CopyIcon />
    </IconAction>
  )
}
