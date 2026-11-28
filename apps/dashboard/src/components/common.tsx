import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon, FileTextIcon, Gamepad2Icon, GlobeIcon, LockIcon, PresentationIcon, ChartColumnIcon, WifiOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { copyText, type Page } from '@/lib/api'
import { kindOf } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ViewHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 tabIndex={-1} className="text-[26px] leading-tight font-medium tracking-tight outline-none">{title}</h1>
        {description && <p className="mt-1.5 max-w-[46em] text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', ariaLabel, size = 'sm', variant = 'outline', className }: {
  text: string; label?: string; ariaLabel?: string; size?: 'sm' | 'default'; variant?: 'outline' | 'secondary'; className?: string
}) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={ariaLabel}
      className={cn(done && 'text-ok', className)}
      onClick={async () => {
        await copyText(text)
        setDone(true)
        toast.success('Copied')
        setTimeout(() => setDone(false), 1800)
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
      {done ? 'Copied' : label}
    </Button>
  )
}

/** A command or link with a copy button, in mono. */
export function CopyRow({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-input bg-background py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{text}</code>
      <CopyButton text={text} ariaLabel={label} />
    </div>
  )
}

const KIND_ICON = { slides: PresentationIcon, chart: ChartColumnIcon, game: Gamepad2Icon, site: GlobeIcon, doc: FileTextIcon }

export function KindIcon({ page, className }: { page: Pick<Page, 'title' | 'hasPin'>; className?: string }) {
  const Icon = KIND_ICON[kindOf(page as Page)]
  return (
    <span className={cn('relative grid size-9 shrink-0 place-items-center rounded-lg border border-input bg-background text-muted-foreground', className)} aria-hidden="true">
      <Icon className="size-4" />
      {page.hasPin && (
        <span className="absolute -right-1.5 -bottom-1.5 grid size-[18px] place-items-center rounded-full border border-input bg-background text-foreground">
          <LockIcon className="size-2.5" />
        </span>
      )}
    </span>
  )
}

/** A load that failed: what didn't load, that nothing is lost, and a retry. */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4" role="alert">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-input bg-background text-muted-foreground" aria-hidden="true"><WifiOffIcon className="size-[18px]" /></span>
      <div className="min-w-[200px] flex-1">
        <p className="text-[15px] font-medium">We couldn’t load {what}</p>
        <p className="text-[13px] text-subtle">Nothing is lost. Check your internet connection, then try again.</p>
      </div>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </Card>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-medium text-mark">{children}</p>
}
