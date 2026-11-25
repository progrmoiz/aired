// Plan & billing state. A straight port of the old dashboard's plan strip:
// same endpoints, same states, same messages. Only the webhook changes the
// plan; this reads /api/billing/status and starts checkout or the portal.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type BillingStatus, SIGN_IN, getJson, isNavigableUrl, mutate, readJson } from '@/lib/api'
import { formatDate } from '@/lib/format'

type Mode = 'checkout' | 'portal' | null

export type PlanView = {
  loaded: boolean
  enabled: boolean
  isPro: boolean
  label: string
  detail: string
  mode: Mode
  state: 'idle' | 'pending' | 'error'
  error: string
  /** Short line for the Pages summary tile and the sidebar. */
  tile: { value: string; sub: string }
}

const ACTIONS = {
  checkout: { label: 'Get Pro', pending: 'Opening checkout…', error: 'Could not open checkout. Try again.' },
  portal: { label: 'Manage billing', pending: 'Opening billing…', error: 'Could not open billing. Try again.' },
} as const

const POLL_MS = 2000
const POLL_LIMIT_MS = 30000
const FREE_HELPER = 'Pro takes the aired badge off your pages and lets them be up to 10 MB. $108 a year.'

function describe(status: BillingStatus | null, detail?: string): Omit<PlanView, 'loaded' | 'state' | 'error'> {
  if (!status || !status.enabled) {
    return { enabled: false, isPro: false, label: 'Free plan', detail: "Paid plans aren't open here yet. Everything you use today is free.", mode: null, tile: { value: 'Free', sub: 'Everything here is free' } }
  }
  if (status.plan === 'pro') {
    const date = formatDate(status.renewsAt)
    let label = 'Pro plan'
    if (date) label += status.cancelAtPeriodEnd ? ' · ends ' + date : ' · renews ' + date
    const helper = status.status === 'past_due' ? 'Last payment failed. Update your card in billing' : ''
    return { enabled: true, isPro: true, label, detail: detail ?? helper, mode: 'portal', tile: { value: 'Pro', sub: status.cancelAtPeriodEnd && date ? 'Ends ' + date : 'Manage billing' } }
  }
  if (status.status === 'past_due' || status.status === 'unpaid') {
    return { enabled: true, isPro: false, label: 'Free plan', detail: detail ?? 'Your last payment failed. Update your card to get Pro back.', mode: 'portal', tile: { value: 'Free', sub: 'Payment failed. Update card' } }
  }
  return { enabled: true, isPro: false, label: 'Free plan', detail: detail ?? FREE_HELPER, mode: 'checkout', tile: { value: 'Free', sub: 'See what Pro adds' } }
}

function clearParam(name: string) {
  const params = new URLSearchParams(window.location.search)
  if (!params.has(name)) return
  params.delete(name)
  const qs = params.toString()
  try { window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash) } catch { /* ignore */ }
}

const loadStatus = () => getJson<BillingStatus>('/api/billing/status')

export function usePlan() {
  const [view, setView] = useState<PlanView>({ loaded: false, ...describe(null), state: 'idle', error: '' })
  const modeRef = useRef<Mode>(null)
  modeRef.current = view.mode

  const render = useCallback((status: BillingStatus | null, detail?: string, forcePortal = false) => {
    const d = describe(status, detail)
    if (forcePortal && d.enabled) d.mode = 'portal'
    setView({ loaded: true, ...d, state: 'idle', error: '' })
  }, [])

  const message = useCallback((label: string, detail: string) => {
    setView((v) => ({ ...v, loaded: true, enabled: true, label, detail, mode: null, state: 'idle', error: '' }))
  }, [])

  // After checkout the webhook may land a few seconds later; poll until it does.
  const poll = useCallback(() => {
    const started = Date.now()
    message('Payment received', 'Confirming your plan…')
    const finish = (status: BillingStatus | null) => {
      clearParam('upgraded')
      if (status) {
        render(status, "You're on Pro")
        toast.success("You're on Pro")
      } else {
        message('Payment received. Refresh in a minute.', '')
        toast('Payment received. Refresh in a minute.')
      }
    }
    const next = () => {
      if (Date.now() - started + POLL_MS > POLL_LIMIT_MS) return finish(null)
      setTimeout(tick, POLL_MS)
    }
    const tick = () => {
      loadStatus().then((status) => {
        if (status && !status.enabled) { clearParam('upgraded'); render(status); return }
        if (status && status.plan === 'pro') return finish(status)
        next()
      }).catch(next)
    }
    tick()
  }, [message, render])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const upgraded = params.get('upgraded') === '1'
    loadStatus().then((status) => {
      if (!status || !status.enabled) {
        if (upgraded) clearParam('upgraded')
        render(status)
        return
      }
      if (!upgraded) {
        // /upgrade sends someone whose payment failed here with ?billing=payment_failed.
        if (params.get('billing') === 'payment_failed') {
          render(status, 'Your last payment failed. Update your card in Manage billing.', true)
          clearParam('billing')
        } else {
          render(status)
        }
      } else if (status.plan === 'pro') {
        clearParam('upgraded')
        render(status, "You're on Pro")
        toast.success("You're on Pro")
      } else {
        poll()
      }
    }).catch(() => {
      // Billing info is secondary: stay quiet unless we came back from checkout.
      if (upgraded) poll()
      else setView((v) => ({ ...v, loaded: true }))
    })
    // Back from Stripe through the bfcache: the page comes back mid-"pending".
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setView((v) => (v.state === 'pending' ? { ...v, state: 'idle' } : v))
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [poll, render])

  const run = useCallback(async () => {
    const mode = modeRef.current
    if (!mode) return
    const action = ACTIONS[mode]
    setView((v) => ({ ...v, state: 'pending', error: '' }))
    try {
      const res = await mutate('POST', '/api/billing/' + mode, mode === 'checkout' ? { interval: 'year' } : undefined)
      const data = await readJson(res)
      if (res.ok && isNavigableUrl(data.url)) {
        window.location.assign(data.url) // stay pending while the browser leaves for Stripe
        return
      }
      if (res.status === 401) {
        window.location.href = SIGN_IN
        return
      }
      if (mode === 'checkout' && res.status === 409) {
        // Checkout refused because a subscription exists: show the real state.
        const msg = typeof data.error === 'string' ? data.error : ''
        const status = await loadStatus()
        if (data.code === 'payment_failed') { render(status, msg, true); toast(msg) }
        else if (status && status.plan === 'pro') { render(status); toast("You're on Pro") }
        else { render(status, msg); if (msg) toast(msg) }
        return
      }
      if (mode === 'portal' && res.status === 404) {
        setView((v) => ({ ...v, state: 'error', error: 'No billing account yet.' }))
        return
      }
      throw new Error(String(res.status))
    } catch {
      setView((v) => ({ ...v, state: 'error', error: action.error }))
    }
  }, [render])

  const buttonLabel = view.mode ? (view.state === 'pending' ? ACTIONS[view.mode].pending : view.state === 'error' ? 'Try again' : ACTIONS[view.mode].label) : ''
  return { plan: view, runPlanAction: run, planButtonLabel: buttonLabel }
}
