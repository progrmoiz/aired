// Plain-words facts about a page, as chips. Used by every page layout.
import { EyeIcon, LockIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export type PageFacts = { expires: string; soon?: boolean; pin: boolean; views: number }

export function PageChips({ page, className }: { page: PageFacts; className?: string }) {
  return (
    <div className={['flex flex-wrap gap-1.5', className].filter(Boolean).join(' ')}>
      <Badge variant={page.soon ? 'warn' : 'chip'}>{page.expires}</Badge>
      {page.pin && <Badge variant="chip"><LockIcon />PIN</Badge>}
      <Badge variant="chip"><EyeIcon />{page.views} views</Badge>
    </div>
  )
}
