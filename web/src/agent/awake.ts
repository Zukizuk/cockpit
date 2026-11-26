// Keeps an agent's call quick while Cockpit's window is minimised or behind others. A hidden page's timers are slowed
// by the browser, after a few minutes to about once a minute, and screen frames stop; UI SDK waits on both while it
// runs a step (for a change to settle, for the page to redraw), so a call could take minutes, the agent give up, and
// the change still go through after. While a call runs on a hidden page, timers (and frames) are kept by a worker
// instead, whose timers the browser leaves alone; once the call is answered they're the page's own again.

type Saved = { st: typeof setTimeout; ct: typeof clearTimeout; raf: typeof requestAnimationFrame; caf: typeof cancelAnimationFrame }

const FIRST_ID = 1_000_000_000
let worker: Worker | null = null
let seq = FIRST_ID
const waiting = new Map<number, () => void>()
let depth = 0
let saved: Saved | null = null

function clock() {
  if (worker) return worker
  const code = 'onmessage = e => { const [id, ms] = e.data; setTimeout(() => postMessage(id), ms) }'
  worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
  worker.onmessage = (e: MessageEvent<number>) => {
    const run = waiting.get(e.data)
    waiting.delete(e.data)
    run?.()
  }
  return worker
}

function keepAwake() {
  const own: Saved = { st: window.setTimeout, ct: window.clearTimeout, raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame }
  saved = own
  const later = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = ++seq
    waiting.set(id, () => fn(...args))
    clock().postMessage([id, Math.max(0, Number(ms) || 0)])
    return id
  }
  window.setTimeout = ((fn: unknown, ms?: number, ...args: unknown[]) =>
    typeof fn === 'function' ? later(fn as (...a: unknown[]) => void, ms, ...args) : own.st.call(window, fn as never, ms)) as typeof setTimeout
  window.clearTimeout = ((id?: number) => {
    if (typeof id === 'number' && id > FIRST_ID) waiting.delete(id)
    else own.ct.call(window, id)
  }) as typeof clearTimeout
  window.requestAnimationFrame = (fn => later(() => fn(performance.now()), 16)) as typeof requestAnimationFrame
  window.cancelAnimationFrame = (id => window.clearTimeout(id)) as typeof cancelAnimationFrame
}

function letSleep() {
  if (!saved) return
  const own = saved
  window.setTimeout = own.st
  // a timer started during the call can still be stopped after it
  window.clearTimeout = ((id?: number) => {
    if (typeof id === 'number' && id > FIRST_ID) waiting.delete(id)
    else own.ct.call(window, id)
  }) as typeof clearTimeout
  window.requestAnimationFrame = own.raf
  window.cancelAnimationFrame = ((id: number) => {
    if (id > FIRST_ID) waiting.delete(id)
    else own.caf.call(window, id)
  }) as typeof cancelAnimationFrame
  saved = null
}

/** Runs an agent's call with timers that keep their pace while the window is hidden. */
export async function awake<T>(call: () => Promise<T>): Promise<T> {
  if (!document.hidden || typeof Worker === 'undefined') return call()
  try {
    if (depth++ === 0) keepAwake()
  } catch {
    // no worker here: the call runs as it is
  }
  try {
    return await call()
  } finally {
    if (--depth === 0) letSleep()
  }
}
