// The publish area: drop a file or paste HTML. "compact" sits above a page
// list; "hero" is the whole first-run screen. Presentational: PublishZone
// wires it to files, paste and the publish API.
import type { DragEvent } from 'react'
import { ClipboardPasteIcon, UploadIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChatGPTMark, ClaudeMark, CursorMark } from '@/components/brand'
import { cn } from '@/lib/utils'

export function AiToolLinks({ center, href = '#' }: { center?: boolean; href?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-sm text-subtle', center && 'justify-center')}>
      <span>Or let your AI publish it:</span>
      {([[ClaudeMark, 'Claude'], [ChatGPTMark, 'ChatGPT'], [CursorMark, 'Cursor']] as const).map(([Icon, name]) => (
        <Badge key={name} variant="outline" className="h-7 rounded-full border-hairline-strong px-2.5 text-muted-foreground" render={<a href={href} />}><Icon />{name}</Badge>
      ))}
    </div>
  )
}

type DropHandlers = { onDragOver?: (e: DragEvent) => void; onDragLeave?: (e: DragEvent) => void; onDrop?: (e: DragEvent) => void }

export function DropZone({ size = 'compact', title, description, dragging, onChoose, onPaste, aiHref, drop }: {
  size?: 'compact' | 'hero'; title: string; description: string; dragging?: boolean
  onChoose?: () => void; onPaste?: () => void; aiHref?: string; drop?: DropHandlers
}) {
  const hero = size === 'hero'
  return (
    <Card variant="hero" aria-label="Publish a page" {...drop}
      className={cn('border-2 border-dashed border-hairline-strong bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--mark)_10%,transparent),transparent_55%)] ring-0 transition-colors', hero ? 'gap-6 px-6 py-14 sm:px-14 sm:py-20' : 'gap-6 px-6 py-7 sm:px-10 sm:py-9', dragging && 'border-mark bg-[color-mix(in_srgb,var(--mark)_12%,transparent)]')}>
      <div className={cn('flex flex-col gap-6', !hero && 'md:flex-row md:items-center')}>
        <div className={cn('flex items-start gap-5', hero && 'flex-col items-center text-center')}>
          <span className={cn('grid shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground', hero ? 'size-16' : 'size-12')}><UploadIcon className={hero ? 'size-7' : 'size-5'} /></span>
          <div>
            <h2 className={cn('font-medium tracking-tight text-foreground', hero ? 'text-title' : 'text-subheading')}>{title}</h2>
            <p className={cn('mt-1 text-muted-foreground', hero ? 'mx-auto mt-3 max-w-[30em] text-lg' : 'text-body')}>{description}</p>
          </div>
        </div>
        <div className={cn('flex flex-wrap gap-2.5', hero ? 'justify-center' : 'md:ml-auto')}>
          <Button size="xl" shape="pill" onClick={onChoose}><UploadIcon />Choose a file</Button>
          <Button size="xl" shape="pill" variant="outline" onClick={onPaste}><ClipboardPasteIcon />Paste HTML</Button>
        </div>
      </div>
      <AiToolLinks center={hero} href={aiHref} />
    </Card>
  )
}
