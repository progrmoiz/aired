import { useState } from 'react'
import { LogOutIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar } from '@/components/app-sidebar'
import { ViewHeader } from '@/components/common'
import { type User, afterSignOut, mutate, readJson } from '@/lib/api'
import { formatDate } from '@/lib/format'

export function AccountView({ user }: { user: User | null }) {
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    try {
      const res = await fetch('/auth/logout', { method: 'POST', headers: { 'X-Aired-Request': '1' }, credentials: 'same-origin' })
      afterSignOut(await readJson(res))
    } catch {
      window.location.href = '/'
    }
  }
  const since = formatDate(user?.createdAt, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="grid min-w-0 gap-5">
      <ViewHeader title="Account" description="Who you’re signed in as." />

      <Card className="gap-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar user={user} className="size-14 text-[22px]" />
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-[17px] font-medium">{user?.name || (user ? '@' + user.login : 'Signed in')}</span>
            {user && <span className="text-sm text-subtle">@{user.login}</span>}
          </div>
          <Button variant="outline" size="lg" onClick={signOut} disabled={signingOut}><LogOutIcon />{signingOut ? 'Signing out…' : 'Sign out'}</Button>
        </div>
        {(user?.email || since) && (
          <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {user?.email && <div><dt className="text-xs text-subtle">Email</dt><dd className="mt-0.5 text-sm break-all">{user.email}</dd></div>}
            {since && <div><dt className="text-xs text-subtle">Member since</dt><dd className="mt-0.5 text-sm">{since}</dd></div>}
          </dl>
        )}
      </Card>

      <Card className="gap-3 border-destructive/25 px-5 py-5">
        <div>
          <h2 className="text-[15px] font-medium">Delete account</h2>
          <p className="mt-1 max-w-[46em] text-sm text-muted-foreground">
            Your account and keys are removed, and connected AI tools lose access. Your pages stay online but no longer belong to anyone, so delete any you want gone first. If you have Pro, cancel it in Manage billing first.
          </p>
        </div>
        <DeleteAccount />
      </Card>
    </div>
  )
}

function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ok = text.trim().toUpperCase() === 'DELETE'

  const change = (o: boolean) => {
    if (busy) return
    if (!o) { setText(''); setError('') }
    setOpen(o)
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ok) return
    setBusy(true); setError('')
    try {
      const res = await mutate('DELETE', '/api/me')
      const data = await readJson(res)
      if (res.ok) { afterSignOut(data); return }
      throw new Error((data.error as string) || 'Could not delete your account. Try again.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account. Try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <div><Button variant="outline" size="lg" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>Delete account…</Button></div>
      <AlertDialog open={open} onOpenChange={change}>
        <AlertDialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>This can’t be undone. Your pages stay online without an owner.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="del-confirm">Type DELETE to confirm</Label>
              <Input id="del-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} placeholder="DELETE" autoFocus />
              {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive" className="bg-destructive text-background hover:bg-destructive/85 dark:bg-destructive dark:hover:bg-destructive/85 focus-visible:ring-destructive/40" disabled={!ok || busy}>{busy ? 'Deleting…' : 'Delete my account'}</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
