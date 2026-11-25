// A browser-window frame around a live preview, with the page's address.
import type { ReactNode } from 'react'
import { LockIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'

export function BrowserFrame({ url, actions, children }: { url: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card variant="bare" className="rounded-2xl">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-tint px-3.5 py-1.5 font-mono text-xs text-muted-foreground">
          <LockIcon className="size-3 text-ok" /><span className="truncate">{url}</span>
        </div>
        {actions}
      </div>
      {children}
    </Card>
  )
}
