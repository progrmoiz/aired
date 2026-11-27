import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { AccountMenu } from '@/components/account-menu'
import { SiteFooter } from '@/components/site-chrome'
import { TopBar } from '@/components/top-bar'
import { type Page, type User, SIGN_IN, initialOf, loadAllPages, signOut } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { useHashSub, useHashView } from '@/hooks/use-hash-view'
import { usePlan } from '@/hooks/use-plan'
import { PagesView } from '@/views/pages-view'
import { ConnectView } from '@/views/connect-view'
import { BillingView } from '@/views/billing-view'
import { AccountView } from '@/views/account-view'
import { ResponsesView } from '@/views/responses-view'

// The Views page (charts, flags, brand icons) loads only when it's opened.
const ViewsView = lazy(() => import('@/views/views-view').then((m) => ({ default: m.ViewsView })))

export type PagesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; pages: Page[]; projects: string[]; truncated: boolean }

export default function App() {
  const view = useHashView()
  const sub = useHashSub()
  const [theme, setTheme] = useTheme()
  const [user, setUser] = useState<User | null>(null)
  const [pages, setPages] = useState<PagesState>({ status: 'loading' })
  const planApi = usePlan()
  const plan = planApi.plan

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

  const links = [
    { label: 'Pages', href: '#pages', current: view === 'pages' },
    { label: 'Views', href: '#views', current: view === 'views' },
    { label: 'AI tools', href: '#connect', current: view === 'connect' },
    { label: 'Plan', href: '#billing', current: view === 'billing' },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <TopBar
        links={links}
        right={<>
          {plan.loaded && plan.enabled && !plan.isPro && (
            <Badge variant="outline" className="hidden h-8 rounded-full border-hairline-strong px-3 text-sm text-muted-foreground sm:inline-flex" render={<a href="#billing" />}>
              Free plan · <span className="text-foreground">Go Pro</span>
            </Badge>
          )}
          <AccountMenu
            name={user?.name || (user ? '@' + user.login : 'Signed in')}
            plan={plan.loaded ? plan.tile.value + ' plan' : user ? '@' + user.login : ''}
            initial={initialOf(user)}
            theme={theme}
            onTheme={setTheme}
            onSignOut={signOut}
          />
        </>}
      />
      <main id="main" className="mx-auto w-full max-w-(--aired-page-max) min-w-0 flex-1 px-5 pt-8 pb-20 sm:px-8 sm:pt-10">
        {view === 'pages' && <PagesView pages={pages} reload={reloadPages} removePage={removePage} isPro={plan.loaded && plan.isPro} />}
        {view === 'views' && <Suspense fallback={<div aria-busy="true" className="min-h-[60vh]" />}><ViewsView pageId={sub} pages={pages} /></Suspense>}
        {view === 'responses' && <ResponsesView pageId={sub} pages={pages} />}
        {view === 'connect' && <ConnectView />}
        {view === 'billing' && <BillingView {...planApi} />}
        {view === 'account' && <AccountView user={user} />}
      </main>
      <SiteFooter />
    </div>
  )
}
