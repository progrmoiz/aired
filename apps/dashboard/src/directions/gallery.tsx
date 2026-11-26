// Direction A: Gallery. Your pages as a wall of live previews, like files in
// Canva or Figma. Top navigation, a big drop area, no sidebar. A workspace
// switcher next to the logo moves between your own pages and a team's; the
// team gets folders, owners, a share dialog and a settings area.
// State lives in the URL (?ws= &screen= &tab= &share= &view=) so any screen
// can be linked.
import { ChevronDownIcon, SearchIcon, UserPlusIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AccountMenu } from '@/components/account-menu'
import { DropZone } from '@/components/drop-zone'
import { PageTile } from '@/components/page-tile'
import { AvatarStack } from '@/components/person'
import { ChoicePicker, ShareDialog, type AccessEntry } from '@/components/share-dialog'
import { TopBar } from '@/components/top-bar'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { PAGES, USER, origin } from './data'
import { BarButton, StyleBar, setParam, useParam, useStyle } from './style'
import { TeamPages, TeamSettings } from './team'
import { DOMAIN, GUESTS, MEMBERS, TEAM_PAGES, WORKSPACES, byId } from './team-data'

function accessFor(pageId: string): { list: AccessEntry[]; general: 'people' | 'workspace' | 'link' } {
  const p = TEAM_PAGES.find((x) => x.id === pageId) ?? TEAM_PAGES[0]
  const owner = byId(p.by)
  const list: AccessEntry[] = [
    { name: owner.you ? `${owner.name} (you)` : owner.name, detail: owner.email, role: 'Owner', kind: 'person', fixed: true },
  ]
  if (p.access !== 'people') list.push({ name: 'Oakfield School', detail: `Everyone in the workspace · ${MEMBERS.length} people`, role: 'Can view', kind: 'workspace' })
  list.push({ name: 'Year 9 team', detail: 'Group · 4 people', role: 'Can edit', kind: 'group', members: ['Priya Shah', 'Sam Ortiz', 'Grace Liu', 'Moiz'] })
  const guest = GUESTS.find((g) => g.access === p.title) ?? GUESTS[0]
  list.push({ name: guest.name, detail: `${guest.email} · ${guest.until}`, role: 'Can view', kind: 'guest' })
  return { list, general: p.access }
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-2xl p-6 shadow-pop sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium tracking-tight">Invite people to Oakfield School</DialogTitle>
          <DialogDescription>They’ll get an email with a sign-in link. Members take a seat; viewers don’t.</DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Email addresses" placeholder={`name@${DOMAIN}, another@${DOMAIN}`} className="min-h-24 rounded-xl" />
        <div className="flex items-center justify-between rounded-xl bg-tint px-3 py-1.5 text-sm text-muted-foreground">
          Invite as <ChoicePicker label="Invite as" value="Member" options={['Admin', 'Member', 'Viewer']} />
        </div>
        <DialogFooter className="-mx-6 -mb-6 rounded-b-2xl border-t border-hairline bg-tint px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button>Send invites</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonalPages({ empty }: { empty: boolean }) {
  return empty ? (
    <>
      <DropZone size="hero" title="Put your first page online" description="Drop the file Claude or ChatGPT made for you, or paste the code. You get a link anyone can open, on any phone or laptop." />
      <h2 className="mt-16 text-center text-sm font-medium text-subtle">Your pages will show up here, like this</h2>
      <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-9 opacity-45 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {PAGES.slice(0, 3).map((p) => <PageTile key={p.id} page={p} origin={origin} />)}
      </div>
    </>
  ) : (
    <>
      <DropZone title="Drop a file or paste HTML" description="You get a link anyone can open. Free, and it takes seconds." />
      <div className="mt-12 flex flex-wrap items-center gap-3">
        <h2 className="mr-2 text-subheading font-medium tracking-tight">Your pages <span className="text-subtle">{PAGES.length}</span></h2>
        <ToggleGroup aria-label="Show" variant="pill" spacing={1.5} defaultValue={['All']} className="max-w-full overflow-x-auto">
          {['All', 'Live', 'Expiring soon', 'Private'].map((f) => <ToggleGroupItem key={f} value={f}>{f}</ToggleGroupItem>)}
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          <InputGroup className="hidden h-9 w-52 rounded-full border-hairline-strong sm:flex">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput aria-label="Search pages" placeholder="Search" />
          </InputGroup>
          <Button variant="outline" shape="pill" size="lg">Newest <ChevronDownIcon /></Button>
        </div>
      </div>
      <div className="mt-7 grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {PAGES.map((p) => <PageTile key={p.id} page={p} origin={origin} />)}
      </div>
    </>
  )
}

export function GalleryDirection({ empty }: { empty: boolean }) {
  const style = useStyle('midnight')
  const ws = (useParam('ws') === 'team' ? 'oakfield' : 'personal') as 'personal' | 'oakfield'
  const team = ws === 'oakfield'
  const screenParam = useParam('screen')
  const screen = team && screenParam === 'settings' ? 'settings' : 'pages'
  const tab = useParam('tab') ?? 'members'
  const share = useParam('share')
  const invite = useParam('invite') === '1'
  const view = useParam('view') === 'list' ? 'list' : 'grid'
  const switcherOpen = useParam('switcher') === '1'

  const go = (next: Partial<Record<'ws' | 'screen' | 'tab' | 'share' | 'invite' | 'view' | 'switcher', string | null>>) =>
    Object.entries(next).forEach(([k, v]) => setParam(k, v ?? null))

  const sharePage = TEAM_PAGES.find((p) => p.id === share)
  const access = sharePage && accessFor(sharePage.id)

  const links = team
    ? [
        { label: 'Pages', href: '#', current: screen === 'pages', onClick: () => go({ screen: null }) },
        { label: 'Members', href: '#', current: screen === 'settings' && tab === 'members', onClick: () => go({ screen: 'settings', tab: 'members' }) },
        { label: 'Settings', href: '#', current: screen === 'settings' && tab !== 'members', onClick: () => go({ screen: 'settings', tab: 'general' }) },
      ]
    : [{ label: 'Pages', href: '#', current: true }, { label: 'AI tools', href: '#' }, { label: 'Plan', href: '#' }]

  return (
    <div className="min-h-screen bg-background pb-16 text-foreground">
      <TopBar
        switcher={<WorkspaceSwitcher workspaces={WORKSPACES} current={ws} defaultOpen={switcherOpen}
          onChange={(id) => go({ ws: id === 'personal' ? null : 'team', screen: null, share: null, switcher: null })} />}
        links={links}
        right={team ? <>
          <button type="button" onClick={() => go({ screen: 'settings', tab: 'members' })} className="hidden rounded-full sm:block" aria-label={`${MEMBERS.length} members`}>
            <AvatarStack names={MEMBERS.map((m) => m.name)} max={4} />
          </button>
          <Button variant="outline" shape="pill" size="lg" className="hidden px-3.5 sm:inline-flex" onClick={() => go({ invite: '1' })}><UserPlusIcon />Invite</Button>
          <AccountMenu name={USER.first} plan="Team" initial={USER.initial} />
        </> : <>
          <Badge variant="outline" className="hidden h-8 rounded-full border-hairline-strong px-3 text-sm text-muted-foreground sm:inline-flex" render={<a href="#" />}>{USER.plan} plan · <span className="text-foreground">Go Pro</span></Badge>
          <AccountMenu name={USER.first} plan={USER.plan} initial={USER.initial} />
        </>}
      />
      <main className="mx-auto max-w-(--aired-page-max) px-5 pt-8 pb-24 sm:px-8 sm:pt-10">
        {!team && <PersonalPages empty={empty} />}
        {team && screen === 'pages' && <TeamPages view={view} onView={(v) => go({ view: v === 'list' ? 'list' : null })} onShare={(id) => go({ share: id })} />}
        {team && screen === 'settings' && <TeamSettings tab={tab} onTab={(t) => go({ tab: t })} onInvite={() => go({ invite: '1' })} />}
      </main>

      {sharePage && access && (
        <ShareDialog open onOpenChange={(o) => !o && go({ share: null })}
          title={sharePage.title} where={`In ${sharePage.folder} · Oakfield School · ${sharePage.views} views`} workspace="Oakfield School"
          access={access.list} general={access.general} pin={sharePage.pin} expires={sharePage.expires.replace('Expires ', '').replace('Never expires', 'Never')}
          url={`${origin}/p/${sharePage.id}`} urlLabel={`pages.${DOMAIN}/${sharePage.id}`} />
      )}
      <InviteDialog open={invite} onOpenChange={(o) => !o && go({ invite: null })} />

      <StyleBar style={style}>
        <BarButton active={!team} onClick={() => go({ ws: null, screen: null, share: null })}>Personal</BarButton>
        <BarButton active={team && screen === 'pages' && !share} onClick={() => go({ ws: 'team', screen: null, share: null })}>Team</BarButton>
        <BarButton active={!!share} onClick={() => go({ ws: 'team', screen: null, share: TEAM_PAGES[4].id })}>Share</BarButton>
        <BarButton active={screen === 'settings' && tab === 'members'} onClick={() => go({ ws: 'team', screen: 'settings', tab: 'members', share: null })}>Members</BarButton>
      </StyleBar>
    </div>
  )
}
