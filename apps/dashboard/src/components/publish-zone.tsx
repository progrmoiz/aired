// The working publish area for the dashboard: drop or choose an .html file,
// or paste code, pick how long it lasts and an optional PIN, then publish
// with the same POST /api/publish the homepage uses. Signed in, the page
// lands in this account.
import { useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { FileCodeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DropZone } from '@/components/drop-zone'
import { copyText, mutate, readJson } from '@/lib/api'
import { sizeWords } from '@/lib/format'

const LASTS = [
  { label: 'Never', body: { permanent: true } },
  { label: '30 days', body: { ttl: 2592000 } },
  { label: '7 days', body: { ttl: 604800 } },
  { label: '1 day', body: { ttl: 86400 } },
  { label: '1 hour', body: { ttl: 3600 } },
] as const

const isHtmlFile = (f: File) => /\.html?$/i.test(f.name) || f.type === 'text/html'

export function PublishZone({ size = 'compact', title, description, onPublished }: {
  size?: 'compact' | 'hero'; title: string; description: string; onPublished: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const [html, setHtml] = useState('')
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [lasts, setLasts] = useState<string>('Never')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsPro, setNeedsPro] = useState(false)

  const start = (code: string, from: { name: string; size: number } | null) => {
    setHtml(code); setFile(from); setPin(''); setError(''); setNeedsPro(false); setLasts('Never'); setOpen(true)
  }

  const takeFile = async (f: File | undefined) => {
    if (!f) return
    if (!isHtmlFile(f)) { toast.error('That isn’t an .html file. Choose the page your AI made, or paste its code.'); return }
    start(await f.text(), { name: f.name, size: f.size })
  }

  const drop = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDragging(true) },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) },
    onDrop: (e: DragEvent) => { e.preventDefault(); setDragging(false); void takeFile(e.dataTransfer.files[0]) },
  }

  const publish = async () => {
    if (!html.trim()) { setError('Paste the page’s HTML first.'); return }
    setBusy(true); setError(''); setNeedsPro(false)
    try {
      const choice = LASTS.find((l) => l.label === lasts) ?? LASTS[0]
      const res = await mutate('POST', '/api/publish', { html, ...choice.body, ...(pin ? { pin } : {}) })
      const data = await readJson(res)
      if (!res.ok) {
        if (data.code === 'plan_limit') {
          setNeedsPro(true)
          setError(data.limit === 'publish_rate'
            ? 'You’ve published a lot in a short time, more than the Free plan allows. Try again later, or get Pro for a higher limit.'
            : 'This page is bigger than the Free plan allows. Pro takes pages up to 10 MB.')
          return
        }
        setError(typeof data.error === 'string' ? data.error : `Could not publish (error ${res.status}).`)
        return
      }
      const url = typeof data.url === 'string' ? data.url : ''
      setOpen(false)
      onPublished()
      toast.success('Published', {
        description: url,
        action: url ? { label: 'Copy link', onClick: () => { void copyText(url); toast.success('Link copied') } } : undefined,
      })
    } catch {
      setError('Could not reach aired. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropZone size={size} title={title} description={description} dragging={dragging} drop={drop} aiHref="#connect"
        onChoose={() => input.current?.click()} onPaste={() => start('', null)} />
      <input ref={input} type="file" accept=".html,.htm,text/html" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = '' }} />

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o) }}>
        <DialogContent className="gap-5 rounded-2xl p-6 shadow-pop sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-lg font-medium tracking-tight">Publish a page</DialogTitle>
            <DialogDescription>You get a link anyone can open, on any phone or laptop.</DialogDescription>
          </DialogHeader>

          {file ? (
            <div className="flex items-center gap-3 rounded-xl border border-hairline bg-tint px-3 py-2.5">
              <FileCodeIcon className="size-5 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{file.name}</span><span className="text-xs text-subtle">{sizeWords(file.size)}</span></span>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)}>Edit the code</Button>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="publish-html">HTML</Label>
              <Textarea id="publish-html" value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<!doctype html>…" spellCheck={false}
                className="max-h-64 min-h-36 rounded-xl font-mono text-xs" autoFocus />
            </div>
          )}

          <div className="grid gap-1.5">
            <span className="text-sm font-medium" id="publish-lasts">How long it lasts</span>
            <ToggleGroup aria-labelledby="publish-lasts" variant="segment" spacing={1} value={[lasts]} onValueChange={(v) => v[0] && setLasts(v[0] as string)} className="w-full rounded-xl bg-tint p-1">
              {LASTS.map((l) => <ToggleGroupItem key={l.label} value={l.label}>{l.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="publish-pin">PIN <span className="font-normal text-subtle">(optional)</span></Label>
            <Input id="publish-pin" inputMode="numeric" autoComplete="off" maxLength={20} value={pin} onChange={(e) => setPin(e.target.value.trim())} placeholder="No PIN" className="max-w-48" />
            <p className="text-xs text-subtle">People need it to open the page. Send it separately from the link.</p>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}{needsPro && <> <a href="#billing" onClick={() => setOpen(false)} className="font-medium text-foreground underline underline-offset-4">See Pro</a></>}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-6 rounded-b-2xl border-t border-hairline bg-tint px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={publish} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Publishing…' : 'Publish'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
