// Midnight (dark) and Daylight (light). The person picks System, Midnight or
// Daylight; System follows the device. Stored in localStorage; dashboard.html
// applies the same rule before first paint so there's no flash.
import { useEffect, useState } from 'react'

export type ThemePref = 'system' | 'midnight' | 'daylight'
export const THEME_KEY = 'aired-theme'
const LIGHT = '(prefers-color-scheme: light)'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'midnight' || v === 'daylight' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(pref: ThemePref): 'midnight' | 'daylight' {
  if (pref !== 'system') return pref
  return window.matchMedia?.(LIGHT).matches ? 'daylight' : 'midnight'
}

export function applyTheme(theme: 'midnight' | 'daylight') {
  const html = document.documentElement
  if (theme === 'daylight') html.dataset.theme = 'daylight'
  else delete html.dataset.theme
  html.classList.toggle('dark', theme === 'midnight')
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readThemePref)
  useEffect(() => {
    applyTheme(resolveTheme(pref))
    if (pref !== 'system') return
    const mq = window.matchMedia?.(LIGHT)
    const on = () => applyTheme(resolveTheme('system'))
    mq?.addEventListener('change', on)
    return () => mq?.removeEventListener('change', on)
  }, [pref])
  const set = (p: ThemePref) => {
    try { if (p === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, p) } catch { /* private mode */ }
    setPref(p)
  }
  return [pref, set]
}
