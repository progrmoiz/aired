// The PDF part of #share/<page id>: download the page as a PDF (a deck's
// with its speaker notes too), and whether viewers get a Download PDF
// button on the page. Off by default: the owner decides who gets a file.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileDownIcon, NotebookTextIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getJson, mutate, readJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type Details = { allowPdf?: boolean; reads: number | null; kind?: string }

export function PdfCard({ pageId, isPro }: { pageId: string; isPro: boolean }) {
  const [details, setDetails] = useState<Details | null>(null)
  const [saving, setSaving] = useState(false)
  const load = useCallback(() => {
    getJson<Details>(`/api/pages/${encodeURIComponent(pageId)}/details`).then(setDetails).catch(() => setDetails(null))
  }, [pageId])
  useEffect(load, [load])

  const base = `/p/${encodeURIComponent(pageId)}/pdf`
  const limited = details !== null && details.reads !== null
  const on = details?.allowPdf === true && !limited

  async function toggle(next: boolean) {
    setSaving(true)
    try {
      const res = await mutate('PATCH', `/api/pages/${encodeURIComponent(pageId)}`, { allow_pdf: next })
      const data = await readJson(res)
      if (!res.ok) {
        toast.error(String(data.error ?? 'Could not save. Try again.'))
        return
      }
      setDetails((d) => (d ? { ...d, allowPdf: next } : d))
      toast.success(next ? 'Viewers can download a PDF' : 'PDF button removed')
    } catch {
      toast.error('Could not save. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">PDF</p>
          <p className="text-xs text-subtle">
            {details?.kind === 'deck' ? 'One slide per page. Speaker notes only in your copy, if you ask for them.' : 'A4 or Letter, with page numbers.'}
            {!isPro && <> Free PDFs have a small “Made with aired” line. <a href="#billing" className="text-foreground underline-offset-4 hover:underline">Pro removes it</a>.</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={base} className={buttonVariants({ variant: 'outline' })}><FileDownIcon /> Download PDF</a>
          {details?.kind === 'deck' && <a href={`${base}?notes=1`} className={buttonVariants({ variant: 'outline' })}><NotebookTextIcon /> With speaker notes</a>}
        </div>
      </div>
      <label className={cn('flex items-start gap-3 border-t border-border px-5 py-3', limited ? 'opacity-60' : 'cursor-pointer')}>
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-foreground"
          checked={on}
          disabled={details === null || limited || saving}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm">Let viewers download a PDF</span>
          <span className="block text-xs text-subtle">
            {limited
              ? 'Not on a page with a view limit: a file would outlive it.'
              : 'Adds a Download PDF button to the page. Only people who can open the page can download it.'}
          </span>
        </span>
      </label>
    </Card>
  )
}
