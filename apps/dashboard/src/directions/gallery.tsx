// Direction A: Gallery. Your pages as a wall of live previews, like files in
// Canva or Figma. Top navigation, a big drop area, no sidebar.
import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AccountMenu } from '@/components/account-menu'
import { DropZone } from '@/components/drop-zone'
import { PageTile } from '@/components/page-tile'
import { TopBar } from '@/components/top-bar'
import { PAGES, USER, origin } from './data'

export function GalleryDirection({ empty }: { empty: boolean }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar
        links={[{ label: 'Pages', href: '#', current: true }, { label: 'AI tools', href: '#' }, { label: 'Plan', href: '#' }]}
        right={<>
          <Badge variant="outline" className="hidden h-8 rounded-full border-hairline-strong px-3 text-sm text-muted-foreground sm:inline-flex" render={<a href="#" />}>{USER.plan} plan · <span className="text-foreground">Go Pro</span></Badge>
          <AccountMenu name={USER.first} plan={USER.plan} initial={USER.initial} />
        </>}
      />
      <main className="mx-auto max-w-(--aired-page-max) px-5 pt-8 pb-24 sm:px-8 sm:pt-10">
        {empty ? (
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
        )}
      </main>
    </div>
  )
}
