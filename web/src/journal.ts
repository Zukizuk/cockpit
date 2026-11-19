// The journal's sync with Kokoro, as a journal page shows it: when it last synced, and "Sync now".
// Opening a journal page brings in what was written on the phone if the last sync is over 6 hours old.
import { useEffect, useState } from 'react'
import { get, post } from './api'
import { ago, useEvent } from './lib'

export interface JournalSync {
  enabled: boolean
  lastSync: number
  lastError: string
  changes: number
  syncing: boolean
  result?: { pushed: number; pulled: number; updated: number; conflicts: number }
}

export function useJournalSync(active: boolean) {
  const [s, setS] = useState<JournalSync | null>(null)
  useEffect(() => {
    if (!active) return
    get<JournalSync>('/api/journal/status')
      .then(st => {
        setS(st)
        if (st.enabled) post<JournalSync>('/api/journal/sync', { ifOlder: true }).then(setS, () => {})
      })
      .catch(() => {})
  }, [active])
  useEvent('journal', (d: JournalSync) => active && setS(d))

  const syncNow = async () => {
    setS(p => (p ? { ...p, syncing: true } : p))
    try {
      const r = await post<JournalSync>('/api/journal/sync', {})
      setS(r)
      const x = r.result
      if (!x) return 'Synced with Kokoro'
      const parts = [x.pushed && `${x.pushed} sent`, x.pulled + x.updated && `${x.pulled + x.updated} brought in`, x.conflicts && `${x.conflicts} kept twice (edited in both places)`].filter(Boolean)
      return `Synced with Kokoro${parts.length ? `: ${parts.join(', ')}` : ', nothing new'}`
    } catch (e: any) {
      get<JournalSync>('/api/journal/status').then(setS, () => {})
      return e.message as string
    }
  }

  const text = !active || !s?.enabled
    ? ''
    : s.syncing
      ? 'Syncing…'
      : s.lastError
        ? 'Kokoro sync failed'
        : s.lastSync
          ? `Synced ${ago(s.lastSync)}${s.changes ? ' · changes waiting' : ''}`
          : 'Not on Kokoro yet'
  return { sync: s, text, enabled: Boolean(active && s?.enabled), syncNow }
}

// ---- days ---------------------------------------------------------------------------------------------------
// The journal card always shows today: on a new day it moves to the new page by itself. ‹ › step back through
// earlier pages (a day page, or an entry written on Kokoro); those are read-only until unlocked.

const DAY_PAGE = /^journal\/(\d{4})-(\d{2})-(\d{2})/
const pad = (n: number) => String(n).padStart(2, '0')

/** journal/YYYY-MM-DD.md for today (this computer's date). */
export const todayPage = (d = new Date()) => `journal/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`

/** The day a journal file belongs to (YYYY-MM-DD), or '' for a file that isn't dated. */
export const dayOf = (ref: string) => {
  const m = DAY_PAGE.exec(ref)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/** "Tue 17 Nov" for a journal file. */
export const dayLabel = (ref: string) => {
  const m = DAY_PAGE.exec(ref)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) })
}

/** Today's page, kept current: it changes at midnight, and when the window comes back after a sleep. */
export function useTodayPage() {
  const [today, setToday] = useState(todayPage)
  useEffect(() => {
    const check = () => setToday(todayPage())
    const timer = window.setInterval(check, 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  return today
}

/** Every dated journal file, oldest first, with today's page among them even before it's written. */
export function journalPages(paths: string[], today: string) {
  const pages = paths.filter(p => dayOf(p))
  if (!pages.includes(today)) pages.push(today)
  return pages.sort()
}

/** Makes sure today's page exists (with its date heading) and returns its path. */
export const openToday = () => post<{ path: string }>('/api/notes/new', { kind: 'journal' }).then(r => r.path)
