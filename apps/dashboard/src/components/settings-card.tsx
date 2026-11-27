// A page's name, how long it lasts and its view limit, changed after
// publishing with PATCH /api/pages/:id. Only what changed is sent.
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type Page, mutate, readJson } from '@/lib/api'
import { expiryWords, plural, viewsOf } from '@/lib/format'
import { cn } from '@/lib/utils'

const LASTS = [
  { key: 'keep', label: 'Keep as is', body: null },
  { key: 'never', label: 'Never expires', body: { permanent: true } },
  { key: '30d', label: '30 days', body: { ttl: 2592000 } },
  { key: '7d', label: '7 days', body: { ttl: 604800 } },
  { key: '1d', label: '1 day', body: { ttl: 86400 } },
  { key: '1h', label: '1 hour', body: { ttl: 3600 } },
] as const
type Lasts = (typeof LASTS)[number]['key']

export function SettingsCard({ page, onSaved }: { page: Page; onSaved: () => void }) {
  const [title, setTitle] = useState(page.title ?? '')
  const [lasts, setLasts] = useState<Lasts>('keep')
  const [limitOn, setLimitOn] = useState(typeof page.reads === 'number' && page.reads > 0)
  const [limit, setLimit] = useState(page.reads ? String(page.reads) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const views = viewsOf(page)
  const e = expiryWords(page)
  const nextReads = limitOn ? Number(limit) : null
  const titleChanged = title.trim() !== (page.title ?? '')
  const readsChanged = (nextReads ?? null) !== (page.reads || null)
  const dirty = titleChanged || lasts !== 'keep' || readsChanged

  const reset = () => {
    setTitle(page.title ?? ''); setLasts('keep'); setLimitOn(typeof page.reads === 'number' && page.reads > 0); setLimit(page.reads ? String(page.reads) : ''); setError('')
  }

  async function save() {
    const body: Record<string, unknown> = {}
    if (titleChanged) {
      if (!title.trim() && page.title) body.title = null
      else body.title = title.trim()
    }
    const choice = LASTS.find((l) => l.key === lasts)
    if (choice?.body) Object.assign(body, choice.body)
    if (readsChanged) {
      if (nextReads !== null && (!Number.isInteger(nextReads) || nextReads < 1)) { setError('Write the view limit as a whole number, like 50.'); return }
      body.reads = nextReads
    }
    if (Object.keys(body).length === 0) return
    setSaving(true); setError('')
    try {
      const res = await mutate('PATCH', `/api/pages/${encodeURIComponent(page.id)}`, body)
      const data = await readJson(res)
      if (!res.ok) { setError(String(data.error ?? 'Could not save. Try again.')); return }
      toast.success('Saved')
      setLasts('keep')
      onSaved()
    } catch {
      setError('Could not save. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="scroll-mt-24 gap-0 py-0" id="section-settings">
      <div className="grid gap-2 border-b border-border px-5 py-4">
        <Label htmlFor="page-title">Name</Label>
        <Input id="page-title" value={title} maxLength={200} onChange={(ev) => setTitle(ev.target.value)} placeholder="Untitled page" />
        <p className="text-xs text-subtle">Shows on your pages and in the browser tab. The link stays the same.</p>
      </div>

      <div className="grid gap-2 border-b border-border px-5 py-4">
        <span className="text-sm font-medium" id="page-lasts">How long it lasts</span>
        <p className="text-xs text-subtle">Now: <span className={cn(e.tone === 'warn' ? 'text-warn' : e.tone === 'good' ? 'text-ok' : 'text-foreground')} title={e.title || undefined}>{e.text}</span>. A new choice counts from today.</p>
        <ToggleGroup aria-labelledby="page-lasts" variant="pill" spacing={1.5} value={[lasts]} onValueChange={(v: unknown[]) => { if (v.length) setLasts(v[0] as Lasts) }} className="flex-wrap">
          {LASTS.map((l) => <ToggleGroupItem key={l.key} value={l.key}>{l.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>

      <div className="grid gap-2 px-5 py-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={limitOn} onChange={(ev) => { setLimitOn(ev.target.checked); if (ev.target.checked && !limit) setLimit(String(Math.max(views + 10, 10))) }} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Stop opening after a number of views</span>
            <span className="block text-xs text-subtle">It has {plural(views, 'view')} so far. Past the limit, the link shows that the page is gone.</span>
          </span>
        </label>
        {limitOn && (
          <div className="flex items-center gap-2 pl-7">
            <Input aria-label="View limit" inputMode="numeric" value={limit} onChange={(ev) => setLimit(ev.target.value.replace(/[^0-9]/g, ''))} className="w-28" />
            <span className="text-sm text-muted-foreground">views in all</span>
          </div>
        )}
        {limitOn && Number(limit) > 0 && Number(limit) <= views && <p className="pl-7 text-xs text-warn">That’s no more than it already has, so it stops opening as soon as you save.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
        <Button onClick={save} disabled={!dirty || saving} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Save'}</Button>
        {dirty && !saving && <Button variant="ghost" onClick={reset}>Cancel</Button>}
        {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
      </div>
    </Card>
  )
}
