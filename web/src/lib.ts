// Small shared helpers: routing, live events, data loading, time.
import { useCallback, useEffect, useRef, useState } from 'react'

// ---- routing (#/section/arg) ----------------------------------------------------------------------------

export type Section = 'library' | 'item' | 'note' | 'settings'
const SECTIONS: Section[] = ['library', 'item', 'note', 'settings']

export function parseHash(hash: string): { section: Section; arg: string } {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const section = (SECTIONS as string[]).includes(parts[0]) ? (parts[0] as Section) : 'library'
  let arg = ''
  try {
    arg = parts.slice(1).map(decodeURIComponent).join('/')
  } catch {
    arg = ''
  }
  return { section, arg }
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function hrefFor(section: Section, arg?: string) {
  return `#/${section}${arg ? `/${arg.split('/').map(encodeURIComponent).join('/')}` : ''}`
}

export function go(section: Section, arg?: string) {
  location.hash = hrefFor(section, arg)
}

// ---- live events from the server -----------------------------------------------------------------------

type Listener = (data: any) => void
const listeners = new Map<string, Set<Listener>>()

export function emit(name: string, data: any = {}) {
  listeners.get(name)?.forEach(fn => fn(data))
}

/** Listens outside React; returns the function that stops listening. */
export function onEvent(name: string, fn: Listener) {
  if (!listeners.has(name)) listeners.set(name, new Set())
  listeners.get(name)!.add(fn)
  return () => {
    listeners.get(name)?.delete(fn)
  }
}

export function useEvent(name: string, fn: Listener) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const wrapped: Listener = d => ref.current(d)
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name)!.add(wrapped)
    return () => {
      listeners.get(name)?.delete(wrapped)
    }
  }, [name])
}

let source: EventSource | null = null
export function startEvents() {
  if (source) return
  source = new EventSource('/api/events')
  for (const name of ['shown', 'notes', 'opened', 'notice', 'outputs', 'journal', 'pinned', 'snippets']) {
    source.addEventListener(name, e => {
      let data = {}
      try {
        data = JSON.parse((e as MessageEvent).data || '{}')
      } catch {
        // empty event
      }
      emit(name, data)
    })
  }
  source.onopen = () => emit('connection', { up: true })
  source.onerror = () => emit('connection', { up: false })
}

// ---- data loading -----------------------------------------------------------------------------------------

export function useData<T>(load: () => Promise<T>, deps: unknown[], { refreshEvery = 0, refreshOn = [] as string[] } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const d = await loadRef.current()
      if (mine === seq.current) {
        setData(d)
        setError('')
      }
    } catch (e: any) {
      if (mine === seq.current) setError(e?.message || String(e))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setData(null)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    if (!refreshEvery) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, refreshEvery)
    return () => clearInterval(t)
  }, [refreshEvery, reload])

  // reload on each event named in refreshOn (whatever it is: shown, notes, pinned…)
  const on = refreshOn.join(',')
  useEffect(() => {
    if (!on) return
    const stops = on.split(',').map(name => onEvent(name, () => reload()))
    return () => stops.forEach(stop => stop())
  }, [on, reload])

  return { data, error, loading, reload, setData }
}

// ---- time ---------------------------------------------------------------------------------------------------

export function ago(when: number | string | undefined, now = Date.now()) {
  if (!when) return ''
  const t = typeof when === 'number' ? when : Date.parse(when)
  if (!Number.isFinite(t)) return ''
  const s = Math.round((now - t) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d ago`
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function clock(when: number | string | undefined) {
  if (!when) return ''
  const t = typeof when === 'number' ? when : Date.parse(when)
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function useLocal<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`cockpit.${key}`)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(`cockpit.${key}`, JSON.stringify(v))
      } catch {
        // storage blocked: keep it for this visit
      }
    },
    [key],
  )
  return [value, set] as const
}

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function isNarrow() {
  return matchMedia('(max-width: 900px)').matches
}
