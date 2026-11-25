// A page as a rich horizontal card: preview, who it's for, chips, actions.
import { ArrowUpRightIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconAction } from '@/components/icon-action'
import { PageChips } from '@/components/page-facts'
import { PagePreview } from '@/components/page-preview'
import type { TilePage } from '@/components/page-tile'
import { copyText } from '@/lib/api'

export function PageSummaryCard({ page, owner, origin }: { page: TilePage; owner: string; origin: string }) {
  return (
    <Card variant="panel" className="flex-row gap-4 rounded-3xl p-3.5">
      <a href="#" aria-label={`Open ${page.title}`} className="block w-[38%] max-w-[190px] shrink-0 self-center overflow-hidden rounded-2xl ring-1 ring-hairline"><PagePreview page={page} /></a>
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <h3 className="truncate text-md font-medium text-foreground">{page.title}</h3>
        <p className="text-sm text-subtle">{owner} · {page.published}</p>
        <PageChips page={page} className="mt-3" />
        <div className="mt-auto flex gap-2 pt-3">
          <Button shape="pill" onClick={async () => { await copyText(`${origin}/p/${page.id}`); toast.success('Link copied') }}><CopyIcon />Copy link</Button>
          <IconAction label={`Open ${page.title}`} render={<Button variant="outline" size="icon" shape="pill" aria-label={`Open ${page.title}`} />}><ArrowUpRightIcon /></IconAction>
        </div>
      </div>
    </Card>
  )
}
