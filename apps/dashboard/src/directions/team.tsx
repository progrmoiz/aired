// Direction A, team version: a shared workspace's pages (folders, owners,
// access, recent activity) and its settings (members, groups, domains, seats,
// security, audit log). Mock data only.
import type { ReactNode } from 'react'
import {
  ActivityIcon, BadgeCheckIcon, BotIcon, CreditCardIcon, DownloadIcon, EllipsisIcon, FolderIcon, FolderPlusIcon, GlobeIcon, LayoutGridIcon, ListIcon,
  LockKeyholeIcon, MailIcon, PlusIcon, SearchIcon, SettingsIcon, ShieldCheckIcon, UserPlusIcon, UsersIcon, type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DropZone } from '@/components/drop-zone'
import { IconAction } from '@/components/icon-action'
import { PagePreview } from '@/components/page-preview'
import { PageTile } from '@/components/page-tile'
import { AvatarStack, PersonAvatar } from '@/components/person'
import { Segmented } from '@/components/segmented'
import { ChoicePicker } from '@/components/share-dialog'
import { cn } from '@/lib/utils'
import { origin, host } from './data'
import { ACTIVITY, AUDIT, DOMAIN, FOLDERS, GROUPS, GUESTS, INVITES, MEMBERS, SEATS, TEAM_PAGES, byId, type Access, type TeamPage } from './team-data'

const ACCESS: Record<Access, { label: (p: TeamPage) => string; Icon: LucideIcon }> = {
  workspace: { label: () => 'Oakfield School', Icon: UsersIcon },
  link: { label: () => 'Anyone with the link', Icon: GlobeIcon },
  people: { label: (p) => `${p.people} people`, Icon: LockKeyholeIcon },
}

function AccessChip({ page }: { page: TeamPage }) {
  const a = ACCESS[page.access]
  return <span className="inline-flex items-center gap-1 text-subtle" title={`Who can open it: ${a.label(page)}`}><a.Icon className="size-3.5" /><span className="sr-only">{a.label(page)}</span></span>
}

/* ---------- Pages ---------- */

export function TeamPages({ view, onView, onShare }: { view: 'grid' | 'list'; onView: (v: 'grid' | 'list') => void; onShare: (id: string) => void }) {
  return (
    <>
      <DropZone title="Publish to Oakfield School" description="Everyone in the workspace can find it. You choose who else can open it." />

      <section aria-label="Lately" className="mt-8 grid gap-3 md:grid-cols-3">
        {ACTIVITY.map((a) => (
          <Card key={a.page} variant="panel" className="flex-row items-center gap-3 rounded-2xl px-4 py-3">
            <PersonAvatar name={byId(a.who).name} />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground"><b className="font-medium text-foreground">{byId(a.who).name.split(' ')[0]}</b> {a.what} <span className="text-foreground">{a.page}</span></p>
            <span className="shrink-0 text-xs text-subtle">{a.when}</span>
          </Card>
        ))}
      </section>

      <section aria-label="Folders" className="mt-10">
        <div className="flex items-baseline justify-between"><h2 className="text-subheading font-medium tracking-tight">Folders</h2><Button variant="link" className="h-auto p-0 text-sm text-muted-foreground">See all</Button></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {FOLDERS.map((f) => (
            <a key={f.name} href="#" className="group flex items-center gap-3 rounded-2xl border border-hairline bg-card p-3.5 transition-colors hover:border-hairline-strong">
              <span className="relative grid size-10 place-items-center rounded-xl bg-tint"><FolderIcon className="size-5 text-muted-foreground" /><span className={cn('absolute right-1.5 bottom-1.5 size-2 rounded-full', f.tone)} /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{f.name}</span><span className="text-xs text-subtle">{f.count} pages</span></span>
            </a>
          ))}
          <button type="button" className="flex items-center gap-3 rounded-2xl border border-dashed border-hairline-strong p-3.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
            <span className="grid size-10 place-items-center rounded-xl"><FolderPlusIcon className="size-5" /></span>New folder
          </button>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="mr-2 text-subheading font-medium tracking-tight">Pages <span className="text-subtle">49</span></h2>
        <ToggleGroup aria-label="Show" variant="pill" spacing={1.5} defaultValue={['All']} className="max-w-full overflow-x-auto">
          {['All', 'Mine', 'Shared with me', 'Expiring soon'].map((f) => <ToggleGroupItem key={f} value={f}>{f}</ToggleGroupItem>)}
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          <InputGroup className="hidden h-9 w-48 rounded-full border-hairline-strong lg:flex">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput aria-label="Search pages" placeholder="Search" />
          </InputGroup>
          <ChoicePicker label="Made by" prefix="By" value="Anyone" options={['Anyone', 'Me', ...MEMBERS.slice(1, 5).map((m) => m.name)]} className="rounded-full border border-hairline-strong" />
          <ToggleGroup aria-label="Layout" spacing={0} value={[view]} onValueChange={(v) => v[0] && onView(v[0] as 'grid' | 'list')} className="rounded-full border border-hairline-strong p-0.5">
            <ToggleGroupItem value="grid" aria-label="Grid" size="sm" className="rounded-full"><LayoutGridIcon /></ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List" size="sm" className="rounded-full"><ListIcon /></ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="mt-7 grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM_PAGES.map((p) => (
            <PageTile key={p.id} page={p} origin={origin} onOpen={() => onShare(p.id)}
              meta={<p className="mt-1 flex items-center gap-1.5 text-sm text-subtle"><PersonAvatar name={byId(p.by).name} size="xs" />{byId(p.by).you ? 'You' : byId(p.by).name} · {p.published}<span aria-hidden="true">·</span><AccessChip page={p} /></p>}
              actions={<>
                <IconAction label={`Share ${p.title}`} onClick={() => onShare(p.id)}><UserPlusIcon /></IconAction>
                <IconAction label={`More for ${p.title}`}><EllipsisIcon /></IconAction>
              </>} />
          ))}
        </div>
      ) : (
        <Card variant="panel" className="mt-7 gap-0 overflow-hidden rounded-2xl py-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Page</TableHead><TableHead className="hidden md:table-cell">Folder</TableHead><TableHead className="hidden sm:table-cell">Made by</TableHead>
              <TableHead className="hidden lg:table-cell">Who can open it</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="w-24 pr-4"><span className="sr-only">Actions</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {TEAM_PAGES.map((p) => {
                const a = ACCESS[p.access]
                return (
                  <TableRow key={p.id}>
                    <TableCell className="py-2.5 pl-4"><span className="flex items-center gap-3"><span className="w-16 shrink-0 overflow-hidden rounded-md ring-1 ring-hairline"><PagePreview page={p} /></span><span className="min-w-0"><span className="block truncate font-medium">{p.title}</span><span className="text-xs text-subtle">{p.published}</span></span></span></TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{p.folder}</TableCell>
                    <TableCell className="hidden sm:table-cell"><span className="flex items-center gap-2 text-muted-foreground"><PersonAvatar name={byId(p.by).name} size="xs" />{byId(p.by).name}</span></TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell"><span className="flex items-center gap-1.5"><a.Icon className="size-3.5" />{a.label(p)}{p.pin && <Badge variant="chip" className="h-5">PIN</Badge>}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{p.views}</TableCell>
                    <TableCell className="pr-4 text-right"><IconAction label={`Share ${p.title}`} onClick={() => onShare(p.id)}><UserPlusIcon /></IconAction><IconAction label={`More for ${p.title}`}><EllipsisIcon /></IconAction></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}

/* ---------- Settings ---------- */

export const SETTINGS_TABS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'general', label: 'General', Icon: SettingsIcon },
  { id: 'members', label: 'Members', Icon: UsersIcon },
  { id: 'groups', label: 'Groups', Icon: UserPlusIcon },
  { id: 'domains', label: 'Domains', Icon: GlobeIcon },
  { id: 'plan', label: 'Plan & seats', Icon: CreditCardIcon },
  { id: 'security', label: 'Security', Icon: ShieldCheckIcon },
  { id: 'audit', label: 'Audit log', Icon: ActivityIcon },
  { id: 'ai', label: 'AI tools & keys', Icon: BotIcon },
]

function Section({ title, description, action, children, className }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card variant="panel" className={cn('gap-0 rounded-2xl p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-body font-medium text-foreground">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

function SeatMeter() {
  const pct = (SEATS.used / SEATS.total) * 100
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm"><span className="text-muted-foreground"><b className="font-medium text-foreground">{SEATS.used} of {SEATS.total}</b> seats used</span><Button variant="link" className="h-auto p-0 text-sm">Add seats</Button></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-tint ring-1 ring-hairline"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-xs text-subtle">Guests and viewers don’t take a seat.</p>
    </div>
  )
}

const ROLE_HELP = 'Owner: everything, including billing. Admin: people and settings. Member: publish and share. Viewer: open shared pages.'

function Members() {
  return (
    <div className="grid gap-5">
      <Section title="Seats" description="Members who publish take a seat."><SeatMeter /></Section>
      <Card variant="panel" className="gap-0 overflow-hidden rounded-2xl py-0">
        <Tabs defaultValue="members" className="gap-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
            <TabsList variant="line">
              <TabsTrigger value="members">Members <span className="text-subtle">{MEMBERS.length}</span></TabsTrigger>
              <TabsTrigger value="guests">Guests <span className="text-subtle">{GUESTS.length}</span></TabsTrigger>
              <TabsTrigger value="invites">Invites <span className="text-subtle">{INVITES.length}</span></TabsTrigger>
            </TabsList>
            <InputGroup className="ml-auto h-8 w-44 rounded-lg border-hairline-strong">
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              <InputGroupInput aria-label="Search people" placeholder="Search people" />
            </InputGroup>
          </div>
          <TabsContent value="members">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Name</TableHead><TableHead>Role</TableHead><TableHead className="hidden text-right sm:table-cell">Pages</TableHead><TableHead className="hidden md:table-cell">Last active</TableHead><TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {MEMBERS.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="py-2.5 pl-4"><span className="flex items-center gap-3"><PersonAvatar name={m.name} /><span className="min-w-0"><span className="block font-medium">{m.name}{m.you && <span className="font-normal text-subtle"> (you)</span>}</span><span className="block truncate text-xs text-subtle">{m.email}</span></span></span></TableCell>
                    <TableCell>{m.role === 'Owner' ? <span className="px-2.5 text-sm text-muted-foreground">Owner</span> : <ChoicePicker label={`${m.name}'s role`} value={m.role} options={['Admin', 'Member', 'Viewer']} danger="Remove from workspace" className="-ml-1" />}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{m.pages}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{m.active}</TableCell>
                    <TableCell className="pr-4 text-right"><IconAction label={`More for ${m.name}`}><EllipsisIcon /></IconAction></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t border-hairline px-4 py-3 text-xs text-subtle">{ROLE_HELP}</p>
          </TabsContent>
          <TabsContent value="guests">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">Guest</TableHead><TableHead>Can open</TableHead><TableHead className="hidden md:table-cell">Access ends</TableHead><TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {GUESTS.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="py-2.5 pl-4"><span className="flex items-center gap-3"><PersonAvatar name={g.name} /><span><span className="block font-medium">{g.name} <span className="font-normal text-subtle">· {g.note}</span></span><span className="text-xs text-subtle">{g.email}</span></span></span></TableCell>
                    <TableCell className="text-muted-foreground">{g.access}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{g.until}</TableCell>
                    <TableCell className="pr-4 text-right"><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">Remove</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t border-hairline px-4 py-3 text-xs text-subtle">Guests are people outside {DOMAIN}. They sign in with a code by email and see only what’s shared with them.</p>
          </TabsContent>
          <TabsContent value="invites">
            <ul className="divide-y divide-hairline">
              {INVITES.map((i) => (
                <li key={i.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid size-8 place-items-center rounded-full bg-secondary text-muted-foreground"><MailIcon className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.email}</span><span className="text-xs text-subtle">Invited as {i.role} · {i.sent}</span></span>
                  <Button variant="outline" size="sm">Resend</Button><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">Cancel</Button>
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  )
}

function Groups() {
  return (
    <Section title="Groups" description="Share with a group instead of one person at a time." action={<Button variant="outline" size="sm"><PlusIcon />New group</Button>}>
      <ul className="grid gap-3 sm:grid-cols-3">
        {GROUPS.map((g) => (
          <li key={g.name} className="rounded-xl border border-hairline p-4">
            <AvatarStack names={g.people.map((id) => GUESTS.find((x) => x.id === id)?.name ?? byId(id).name)} />
            <p className="mt-3 text-sm font-medium">{g.name}</p>
            <p className="text-xs text-subtle">{g.people.length} people · {g.note}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Domains() {
  return (
    <div className="grid gap-5">
      <Section title="Your domains" description="Pages can live on your school’s own address instead of aired.sh." action={<Button variant="outline" size="sm"><PlusIcon />Add a domain</Button>}>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline p-4">
          <span className="grid size-9 place-items-center rounded-lg bg-ok/15 text-ok"><BadgeCheckIcon className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block font-mono text-sm">pages.{DOMAIN}</span><span className="text-xs text-subtle">Verified Monday · new pages use it by default</span></span>
          <Badge variant="chip">Default</Badge>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-hairline-strong p-4">
          <span className="grid size-9 place-items-center rounded-lg bg-warn-bg text-warn"><GlobeIcon className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block font-mono text-sm">events.{DOMAIN}</span><span className="text-xs text-subtle">Waiting for DNS. Add a CNAME record pointing to <span className="font-mono">{host}</span></span></span>
          <Button variant="outline" size="sm">Check again</Button>
        </div>
      </Section>
      <Section title="Sign-in domain" description={`Anyone signing in with an @${DOMAIN} email can join as a Viewer.`}>
        <Segmented label="New people from your domain" items={['Ask an admin', 'Join as Viewer', 'Join as Member']} value="Join as Viewer" />
      </Section>
    </div>
  )
}

function Plan() {
  return (
    <div className="grid gap-5">
      <Section title="Team plan" description="Renews on 1 January. Billed to the school office." action={<Button variant="outline" size="sm">Manage billing</Button>}>
        <SeatMeter />
      </Section>
      <Section title="Invoices">
        <ul className="divide-y divide-hairline text-sm">
          {['1 Dec 2026', '1 Nov 2026', '1 Oct 2026'].map((d) => (
            <li key={d} className="flex items-center justify-between py-2.5"><span>{d}</span><span className="flex items-center gap-3 text-muted-foreground"><Badge variant="chip">Paid</Badge><IconAction label={`Download invoice for ${d}`}><DownloadIcon /></IconAction></span></li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Security() {
  return (
    <div className="grid gap-5">
      <Section title="Sign-in" description="How people get into the workspace." action={<Badge variant="chip" className="text-ok"><ShieldCheckIcon />Google sign-in on</Badge>}>
        <Segmented label="Members sign in with" items={['Email code', 'Google Workspace', 'Microsoft']} value="Google Workspace" hint={`Only @${DOMAIN} Google accounts`} />
      </Section>
      <Section title="Sharing rules" description="Limits that apply to every page in the workspace.">
        <div className="grid gap-4">
          <Segmented label="New pages start as" items={['Only people with access', 'Anyone in the workspace', 'Anyone with the link']} value="Anyone in the workspace" />
          <Segmented label="Who can make a page public" items={['Members', 'Admins only']} value="Members" />
          <Segmented label="Guests" items={['Allowed', 'Admins invite them', 'Not allowed']} value="Admins invite them" />
          <Segmented label="Public links need a PIN" items={['No', 'Yes']} value="No" />
        </div>
      </Section>
    </div>
  )
}

function Audit() {
  return (
    <Card variant="panel" className="gap-0 overflow-hidden rounded-2xl py-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <h2 className="text-body font-medium">Audit log</h2>
        <span className="text-sm text-subtle">Kept for 1 year</span>
        <div className="ml-auto flex items-center gap-2">
          <ChoicePicker label="Show" value="All events" options={['All events', 'Sharing', 'People and roles', 'Pages', 'Settings']} className="rounded-lg border border-hairline-strong" />
          <Button variant="outline" size="sm"><DownloadIcon />Export CSV</Button>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4">When</TableHead><TableHead>Who</TableHead><TableHead>What</TableHead><TableHead className="hidden pr-4 md:table-cell">Details</TableHead></TableRow></TableHeader>
        <TableBody>
          {AUDIT.map((e) => (
            <TableRow key={e.when + e.action}>
              <TableCell className="py-2.5 pl-4 whitespace-nowrap text-muted-foreground tabular-nums">{e.when}</TableCell>
              <TableCell><span className="flex items-center gap-2"><PersonAvatar name={byId(e.who).name} size="xs" />{byId(e.who).name}</span></TableCell>
              <TableCell>{e.action}</TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground md:table-cell">{e.target}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function General() {
  return (
    <div className="grid gap-5">
      <Section title="Workspace">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-xl font-bold text-orange-950">O</span>
          <Button variant="outline" size="sm">Change icon</Button>
        </div>
        <label className="mt-5 block text-xs font-medium text-subtle" htmlFor="ws-name">Name</label>
        <Input id="ws-name" defaultValue="Oakfield School" className="mt-1.5 max-w-sm" />
        <label className="mt-4 block text-xs font-medium text-subtle" htmlFor="ws-url">Workspace address</label>
        <div className="mt-1.5 flex max-w-sm items-center rounded-lg border border-input bg-background pl-3 text-sm"><span className="text-subtle">{host}/w/</span><input id="ws-url" defaultValue="oakfield" className="h-8 min-w-0 flex-1 bg-transparent pr-3 outline-none" /></div>
      </Section>
      <Section title="Leave or delete" description="Deleting the workspace takes every page in it offline." className="ring-destructive/30">
        <div className="flex flex-wrap gap-2"><Button variant="outline">Transfer ownership</Button><Button variant="destructive">Delete workspace</Button></div>
      </Section>
    </div>
  )
}

function AiKeys() {
  return (
    <Section title="AI tools & keys" description="Pages Claude, ChatGPT or Cursor publish with these keys land in Oakfield School." action={<Button variant="outline" size="sm"><PlusIcon />New key</Button>}>
      <ul className="divide-y divide-hairline text-sm">
        {[['Claude · Grace’s laptop', 'grace', 'Used today'], ['ChatGPT · Office', 'aisha', 'Used 3 days ago'], ['Cursor · Leo', 'leo', 'Never used']].map(([n, who, used]) => (
          <li key={n} className="flex items-center gap-3 py-2.5"><PersonAvatar name={byId(who).name} size="sm" /><span className="min-w-0 flex-1"><span className="block font-medium">{n}</span><span className="text-xs text-subtle">{used}</span></span><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">Revoke</Button></li>
        ))}
      </ul>
    </Section>
  )
}

const PANES: Record<string, () => ReactNode> = { general: General, members: Members, groups: Groups, domains: Domains, plan: Plan, security: Security, audit: Audit, ai: AiKeys }

export function TeamSettings({ tab, onTab, onInvite }: { tab: string; onTab: (t: string) => void; onInvite: () => void }) {
  const cur = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[1]
  const Pane = PANES[cur.id]
  return (
    <div className="grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Settings" className="-mx-5 flex gap-1 overflow-x-auto px-5 md:mx-0 md:flex-col md:px-0">
        <p className="hidden px-3 pb-2 text-xs font-medium text-subtle md:block">Oakfield School</p>
        {SETTINGS_TABS.map((t) => (
          <a key={t.id} href="#" onClick={(e) => { e.preventDefault(); onTab(t.id) }} aria-current={t.id === cur.id ? 'page' : undefined}
            className={cn('flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground', t.id === cur.id && 'bg-tint text-foreground ring-1 ring-hairline')}>
            <t.Icon className="size-4" />{t.label}
          </a>
        ))}
      </nav>
      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-heading font-medium tracking-tight">{cur.label}</h1>
            {cur.id === 'members' && <p className="mt-1 text-sm text-muted-foreground">People in Oakfield School can find every page shared with the workspace.</p>}</div>
          {cur.id === 'members' && <Button shape="pill" size="lg" className="px-4" onClick={onInvite}><UserPlusIcon />Invite people</Button>}
        </div>
        <Pane />
      </div>
    </div>
  )
}
