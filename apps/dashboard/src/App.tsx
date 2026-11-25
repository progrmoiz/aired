import { useCallback, useEffect, useState } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteFooter, SiteHeader } from '@/components/site-chrome'
import { type Page, type User, SIGN_IN, loadAllPages } from '@/lib/api'
import { useHashView } from '@/hooks/use-hash-view'
import { usePlan } from '@/hooks/use-plan'
import { PagesView } from '@/views/pages-view'
import { ConnectView } from '@/views/connect-view'
import { BillingView } from '@/views/billing-view'
import { AccountView } from '@/views/account-view'

export type PagesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; pages: Page[]; projects: string[]; truncated: boolean }

export default function App() {
  const view = useHashView()
  const [user, setUser] = useState<User | null>(null)
  const [pages, setPages] = useState<PagesState>({ status: 'loading' })
  const planApi = usePlan()

  const reloadPages = useCallback(() => {
    setPages((p) => (p.status === 'ready' ? p : { status: 'loading' }))
    loadAllPages().then((r) => setPages({ status: 'ready', ...r })).catch(() => setPages({ status: 'error' }))
  }, [])

  useEffect(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.status === 401) { window.location.href = SIGN_IN; return }
        setUser(await res.json())
        reloadPages()
      })
      .catch(() => setPages({ status: 'error' }))
  }, [reloadPages])

  const removePage = useCallback((id: string) => {
    setPages((p) => (p.status === 'ready' ? { ...p, pages: p.pages.filter((x) => x.id !== id) } : p))
  }, [])

  return (
    <SidebarProvider>
      <AppSidebar view={view} user={user} plan={planApi.plan} />
      <SidebarInset className="min-w-0">
        <SiteHeader user={user} />
        <main id="main" className="mx-auto w-full max-w-[1120px] min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-8 sm:pt-8 lg:px-10">
          {view === 'pages' && <PagesView pages={pages} reload={reloadPages} removePage={removePage} plan={planApi.plan} />}
          {view === 'connect' && <ConnectView />}
          {view === 'billing' && <BillingView {...planApi} />}
          {view === 'account' && <AccountView user={user} />}
        </main>
        <SiteFooter />
      </SidebarInset>
    </SidebarProvider>
  )
}
