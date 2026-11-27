// Put new content on the same link: drop or choose an .html or .md file.
// It goes up with PUT /api/pages/:id as a new version, so History keeps the
// old one and the toast's Undo puts it back.
import { useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { FileCodeIcon, FileUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { forgetPreview } from '@/components/live-preview'
import { forgetTile } from '@/components/page-thumb'
import { mutate, readJson } from '@/lib/api'
import { sizeWords } from '@/lib/format'
import { cn } from '@/lib/utils'

type Picked = { name: string; size: number; text: string; markdown: boolean }

const isMarkdown = (f: File) => /\.(md|markdown)$/i.test(f.name) || f.type === 'text/markdown'
const isHtml = (f: File) => /\.html?$/i.test(f.name) || f.type === 'text/html'

export function ReplaceCard({ pageId, title, onReplaced }: { pageId: string; title: string; onReplaced: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const take = async (f: File | undefined) => {
    if (!f) return
    if (!isHtml(f) && !isMarkdown(f)) { toast.error('Choose an .html or .md file.'); return }
    setError('')
    setPicked({ name: f.name, size: f.size, text: await f.text(), markdown: isMarkdown(f) })
  }

  const drop = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDragging(true) },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) },
    onDrop: (e: DragEvent) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files[0]) },
  }

  const refresh = () => { forgetPreview(pageId); forgetTile(pageId); onReplaced() }

  async function undo(previous: number) {
    try {
      const res = await mutate('POST', `/api/pages/${encodeURIComponent(pageId)}/versions/${previous}/restore`, {})
      const data = await readJson(res)
      if (!res.ok) { toast.error(String(data.error ?? 'Could not undo. Open History to restore it.')); return }
      toast.success('Put back the earlier version')
      refresh()
    } catch {
      toast.error('Could not undo. Open History to restore it.')
    }
  }

  async function replace() {
    if (!picked) return
    setBusy(true); setError('')
    try {
      const body = picked.markdown
        ? { markdown: picked.text, message: `Replaced with ${picked.name}`.slice(0, 200) }
        : { html: picked.text, message: `Replaced with ${picked.name}`.slice(0, 200) }
      const res = await mutate('PUT', `/api/pages/${encodeURIComponent(pageId)}`, body)
      const data = await readJson(res)
      if (!res.ok) {
        setError(data.code === 'plan_limit'
          ? 'This file is bigger than the Free plan allows. Pro takes pages up to 10 MB.'
          : String(data.error ?? `Could not update (error ${res.status}).`))
        return
      }
      setPicked(null)
      refresh()
      const version = typeof data.version === 'number' ? data.version : null
      toast.success('Updated. Same link, new content.', {
        description: version !== null ? `Version ${version}. The earlier one is in History.` : undefined,
        action: version !== null && version > 1 ? { label: 'Undo', onClick: () => { void undo(version - 1) } } : undefined,
        duration: 10000,
      })
    } catch {
      setError('Could not reach aired. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card id="section-replace" {...drop} className={cn('scroll-mt-24 gap-0 border-2 border-dashed border-hairline-strong py-0 ring-0 transition-colors', dragging && 'border-mark bg-[color-mix(in_srgb,var(--mark)_12%,transparent)]')}>
        <div className="flex items-start gap-4 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-input bg-background"><FileUpIcon className="size-[18px]" /></span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Update from a file</p>
            <p className="mt-0.5 text-xs text-subtle">Drop an .html or .md file here to put it on the same link. The current version stays in History, so you can undo.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => input.current?.click()}>Choose a file</Button>
          </div>
        </div>
      </Card>
      <input ref={input} type="file" accept=".html,.htm,.md,.markdown,text/html,text/markdown" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { void take(e.target.files?.[0]); e.target.value = '' }} />

      <AlertDialog open={picked !== null} onOpenChange={(o) => { if (!o && !busy) { setPicked(null); setError('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>Everyone with the link sees the new content. The current version is kept in History.</AlertDialogDescription>
          </AlertDialogHeader>
          {picked && (
            <div className="flex items-center gap-3 rounded-xl border border-hairline bg-tint px-3 py-2.5">
              <FileCodeIcon className="size-5 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{picked.name}</span><span className="text-xs text-subtle">{sizeWords(picked.size)}{picked.markdown ? ' · Markdown' : ''}</span></span>
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}{error.includes('Pro') && <> <a href="#billing" className="font-medium text-foreground underline underline-offset-4">See Pro</a></>}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button onClick={replace} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Updating…' : 'Update page'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
