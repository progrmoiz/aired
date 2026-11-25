import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, ChevronDownIcon, KeyRoundIcon, PlusIcon, TerminalIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClaudeMark, ChatGPTMark, CursorMark } from '@/components/brand'
import { CopyButton, CopyRow, ViewHeader } from '@/components/common'
import { type ApiKey, mutate, readJson } from '@/lib/api'

const CONNECTOR = 'https://aired.sh/mcp/account'

type Tool = { key: string; name: string; sub: string; icon: React.ReactNode; steps: React.ReactNode[]; rows: { text: string; label: string }[]; ask: string }

const TOOLS: Tool[] = [
  {
    key: 'claude', name: 'Claude', sub: 'claude.ai and the Claude app', icon: <ClaudeMark className="size-4" />,
    steps: ['In Claude’s settings, add a custom connector.', <>Paste this link, then sign in to aired and choose <b className="font-medium text-foreground">Allow</b>.</>],
    rows: [{ text: CONNECTOR, label: 'Copy the connector link for Claude' }],
    ask: 'Then ask: “Publish this as a link.”',
  },
  {
    key: 'chatgpt', name: 'ChatGPT', sub: 'chatgpt.com and the ChatGPT app', icon: <ChatGPTMark className="size-4" />,
    steps: ['In ChatGPT’s settings, add a custom connector. Some plans ask you to turn on developer mode first.', <>Paste this link, then sign in to aired and choose <b className="font-medium text-foreground">Allow</b>.</>],
    rows: [{ text: CONNECTOR, label: 'Copy the connector link for ChatGPT' }],
    ask: 'Then ask: “Put this page online with aired.”',
  },
  {
    key: 'cursor', name: 'Cursor', sub: 'The Cursor editor', icon: <CursorMark className="size-4" />,
    steps: ['In Cursor’s settings, add a new tool and paste this link.', <>When Cursor asks, sign in to aired and choose <b className="font-medium text-foreground">Allow</b>.</>],
    rows: [{ text: CONNECTOR, label: 'Copy the connector link for Cursor' }],
    ask: 'Then ask the agent to publish the page you’re working on.',
  },
  {
    key: 'code', name: 'Claude Code', sub: 'Also Codex, Windsurf and other coding agents', icon: <TerminalIcon className="size-4" />,
    steps: ['Run this once in your terminal. It teaches your agent to publish.', 'Then sign in, so pages land in this account.'],
    rows: [{ text: 'npx skills add progrmoiz/aired -g', label: 'Copy the skill install command' }, { text: 'npx aired login', label: 'Copy the sign-in command' }],
    ask: 'Then ask: “Publish this as a link.”',
  },
]

export function ConnectView() {
  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title="Connect your AI tools" description="Let Claude, ChatGPT or Cursor publish for you. Ask for a link and the page lands here, in your account." />

      <Card className="gap-0 py-0">
        <Tabs defaultValue="claude" className="gap-0">
          <div className="overflow-x-auto border-b border-border px-3 pt-3 [scrollbar-width:none]">
            <TabsList variant="line" className="h-auto gap-1 bg-transparent p-0">
              {TOOLS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="h-10 flex-none gap-2 px-3 text-[14px]">{t.icon}{t.name}</TabsTrigger>
              ))}
            </TabsList>
          </div>
          {TOOLS.map((t) => (
            <TabsContent key={t.key} value={t.key} className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-8">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-input bg-background text-foreground [&_svg]:size-5">{t.icon}</span>
                <div>
                  <h2 className="text-[17px] font-medium">{t.name}</h2>
                  <p className="text-[13px] text-subtle">{t.sub}</p>
                  <p className="mt-4 text-[13px] text-subtle">{t.ask}</p>
                </div>
              </div>
              <ol className="grid gap-3">
                {t.steps.map((s, i) => (
                  <li key={i} className="grid gap-2">
                    <span className="grid grid-cols-[22px_1fr] gap-2 text-sm text-muted-foreground">
                      <span className="grid size-[22px] place-items-center rounded-md border border-input text-[11px] font-medium text-foreground">{i + 1}</span>
                      <span>{s}</span>
                    </span>
                    {t.key === 'code' ? t.rows[i] && <CopyRow {...t.rows[i]} /> : i === 1 && t.rows.map((r) => <CopyRow key={r.text} {...r} />)}
                  </li>
                ))}
              </ol>
            </TabsContent>
          ))}
        </Tabs>
        <p className="border-t border-border px-5 py-3 text-xs text-subtle">Menus move between app versions. If you can’t find the setting, search the app’s help for “custom connector”.</p>
      </Card>

      <Card className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
        <div>
          <h2 className="text-[15px] font-medium">What a connected tool can do</h2>
          <p className="mt-1 text-[13px] text-subtle">You can remove it from the tool’s settings at any time.</p>
        </div>
        <ul className="grid gap-2.5 text-sm">
          <li className="flex gap-2.5 text-muted-foreground"><CheckIcon className="mt-0.5 size-4 text-ok" />Publish pages to your account, and update or delete them</li>
          <li className="flex gap-2.5 text-muted-foreground"><CheckIcon className="mt-0.5 size-4 text-ok" />List the pages you already have</li>
          <li className="flex gap-2.5 text-subtle"><XIcon className="mt-0.5 size-4" />See your developer keys or billing, or delete your account</li>
        </ul>
      </Card>

      <DeveloperKeys />
    </div>
  )
}

/* ─── Developer keys (same endpoints and rules as before) ─── */
function when(ms: number | null) {
  if (!ms) return 'never'
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function DeveloperKeys() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ status: 'loading' | 'hidden' | 'error' | 'ready'; keys: ApiKey[]; max: number; error: string }>({ status: 'loading', keys: [], max: 5, error: '' })
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)

  useEffect(() => {
    // Signed in with a session: show the list. 401/403 (signed out, or signed in
    // with a key): keep it hidden. Other errors show, so an outage can't hide a
    // leaked key without the person knowing.
    fetch('/api/me/keys', { credentials: 'same-origin' }).then(async (res) => {
      const data = await readJson(res)
      if (res.status === 401 || res.status === 403) return setState((s) => ({ ...s, status: 'hidden' }))
      if (!res.ok) return setState((s) => ({ ...s, status: 'error', error: (data.error as string) || 'Could not load your keys. Reload to try again.' }))
      setState({ status: 'ready', keys: Array.isArray(data.keys) ? (data.keys as ApiKey[]) : [], max: typeof data.max === 'number' ? data.max : 5, error: '' })
    }).catch(() => setState((s) => ({ ...s, status: 'error', error: 'Could not load your keys. Check your connection and reload.' })))
  }, [])

  if (state.status === 'hidden') return null
  const full = state.keys.length >= state.max

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-0 py-0">
        <CollapsibleTrigger className="flex w-full items-center gap-3.5 rounded-xl px-5 py-4 text-left hover:bg-white/[0.02]">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-input bg-background"><KeyRoundIcon className="size-[18px]" /></span>
          <span className="grid min-w-0 flex-1">
            <span className="text-[15px] font-medium">Developer keys</span>
            <span className="text-[13px] text-subtle">For scripts, CI and tools that can’t sign in</span>
          </span>
          {state.status === 'ready' && <Badge variant="outline" className="border-input text-muted-foreground">{state.keys.length} of {state.max}</Badge>}
          <ChevronDownIcon className={'size-4 text-subtle transition-transform ' + (open ? 'rotate-180' : '')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-4 border-t border-border px-5 py-5">
            <p className="max-w-[46em] text-sm text-muted-foreground">
              A key lets anything that has it publish to this account. Keep it secret, like a password. Set it as <code className="font-mono text-[12.5px] text-foreground">AIRED_API_KEY</code> for the CLI, or send it as a header on <code className="font-mono text-[12.5px] text-foreground">https://aired.sh/mcp</code> from MCP clients that can’t sign in.{' '}
              <a href="/docs#api" className="text-foreground underline decoration-input underline-offset-4">API and CLI docs</a>
            </p>
            {state.status === 'loading' && <p className="text-sm text-subtle">Loading keys…</p>}
            {state.status === 'error' && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
            {state.status === 'ready' && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => setCreating(true)} disabled={full}><PlusIcon />New key</Button>
                  {full && <p className="text-[13px] text-subtle">You have {state.max} keys. Revoke one to add another.</p>}
                </div>
                {state.keys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No keys yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Your keys">
                    {state.keys.map((k) => (
                      <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{k.name}</p>
                          <p className="text-xs text-subtle"><span className="font-mono">{k.prefix}…</span> · created {when(k.createdAt)} · last used {when(k.lastUsedAt)}</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setRevoking(k)} aria-label={`Revoke key ${k.name}`}>Revoke</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Card>
      <NewKeyDialog open={creating} onOpenChange={setCreating} onCreated={(k) => setState((s) => ({ ...s, keys: [k, ...s.keys] }))} />
      <RevokeDialog keyToRevoke={revoking} onClose={() => setRevoking(null)} onRevoked={(id) => setState((s) => ({ ...s, keys: s.keys.filter((k) => k.id !== id) }))} />
    </Collapsible>
  )
}

function NewKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (k: ApiKey) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [secret, setSecret] = useState('')

  // Closing forgets the key: it's never shown again.
  const change = (o: boolean) => {
    if (busy) return
    if (!o) { setName(''); setError(''); setSecret('') }
    onOpenChange(o)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) { setError('Give the key a name.'); return }
    setBusy(true); setError('')
    try {
      const res = await mutate('POST', '/api/me/keys', { name: n })
      const data = await readJson(res)
      if (!res.ok) throw new Error((data.error as string) || 'Could not create the key.')
      onCreated({ id: data.id as string, name: data.name as string, prefix: data.prefix as string, createdAt: (data.createdAt as number) ?? Date.now(), lastUsedAt: null })
      setSecret(data.key as string)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        {!secret ? (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New developer key</DialogTitle>
              <DialogDescription>Name it after where you’ll use it, so you know which one to revoke later.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="GitHub Actions" autoComplete="off" autoFocus aria-invalid={!!error || undefined} />
              {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => change(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Copy your key now</DialogTitle>
              <DialogDescription>You won’t be able to see it again. Store it somewhere safe, like a password manager.</DialogDescription>
            </DialogHeader>
            <code className="block rounded-lg border border-input bg-background p-3 font-mono text-[12.5px] break-all text-foreground">{secret}</code>
            <DialogFooter>
              <CopyButton text={secret} label="Copy key" size="default" />
              <Button onClick={() => change(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RevokeDialog({ keyToRevoke, onClose, onRevoked }: { keyToRevoke: ApiKey | null; onClose: () => void; onRevoked: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const k = keyToRevoke
  const revoke = async () => {
    if (!k) return
    setBusy(true); setError('')
    try {
      const res = await mutate('DELETE', '/api/me/keys/' + encodeURIComponent(k.id))
      const data = await readJson(res)
      if (!res.ok && res.status !== 404) throw new Error((data.error as string) || 'Could not revoke the key.')
      onRevoked(k.id)
      toast.success('Revoked ' + k.name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the key.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={!!k} onOpenChange={(o) => { if (!o && !busy) { setError(''); onClose() } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{k?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>Anything using this key stops working right away.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" className="bg-destructive text-background hover:bg-destructive/85 dark:bg-destructive dark:hover:bg-destructive/85 focus-visible:ring-destructive/40" onClick={revoke} disabled={busy}>{busy ? 'Revoking…' : 'Revoke key'}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

