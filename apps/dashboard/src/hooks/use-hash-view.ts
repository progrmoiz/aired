import { useEffect, useState } from 'react'

export const VIEWS = ['pages', 'connect', 'billing', 'account'] as const
export type View = (typeof VIEWS)[number]

const TITLES: Record<View, string> = { pages: 'your pages', connect: 'connect your AI tools', billing: 'plan & billing', account: 'account' }

const read = (): View => {
  const h = window.location.hash.replace('#', '') as View
  return VIEWS.includes(h) ? h : 'pages'
}

/** #pages, #connect, #billing, #account. Back from Stripe opens #billing. */
export function useHashView(): View {
  const [view, setView] = useState<View>(() => {
    const params = new URLSearchParams(window.location.search)
    if ((params.get('upgraded') === '1' || params.has('billing')) && !window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#billing') } catch { /* ignore */ }
    }
    return read()
  })
  useEffect(() => {
    document.title = 'aired — ' + TITLES[view]
  }, [view])
  useEffect(() => {
    const on = () => {
      setView(read())
      window.scrollTo(0, 0)
      // Move focus to the new view's heading so keyboard and screen reader users land there,
      // After the mobile drawer has closed and handed focus back.
      setTimeout(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }), 400)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return view
}
