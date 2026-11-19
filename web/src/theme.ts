// Light, dark, or as Windows is set (Settings > Theme). public/theme.js puts the last one on the page before it's
// drawn, so a light board doesn't flash dark first; this keeps it in step with the setting and with Windows.
import { useEffect } from 'react'

export type Theme = 'system' | 'dark' | 'light'

const lightQuery = () => matchMedia('(prefers-color-scheme: light)')

/** The theme to draw: "system" is whatever Windows uses now. */
export const resolveTheme = (t: Theme): 'dark' | 'light' => (t === 'system' ? (lightQuery().matches ? 'light' : 'dark') : t)

/** Whether the board is drawn light right now (diagrams follow it). */
export const isLight = () => document.documentElement.dataset.theme === 'light'

export function paintTheme(t: Theme) {
  const now = resolveTheme(t)
  const root = document.documentElement
  root.dataset.theme = now
  root.classList.toggle('dark', now === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', now === 'light' ? '#f3f3f3' : '#121212')
  try {
    localStorage.setItem('cockpit.theme', t)
  } catch {
    // drawn right anyway; only the next start may flash
  }
}

/** Draws the chosen theme, and follows Windows while it's "system". */
export function useTheme(t: Theme) {
  useEffect(() => {
    paintTheme(t)
    if (t !== 'system') return
    const q = lightQuery()
    const follow = () => paintTheme('system')
    q.addEventListener('change', follow)
    return () => q.removeEventListener('change', follow)
  }, [t])
}
