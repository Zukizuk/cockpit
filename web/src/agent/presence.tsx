// Where an agent is at work, on the board, so the person always sees what Claude looks at and changes, not only the
// result:
// - a frame round each card it reads, writes, comments on or arranges (or made), named "Claude · reading" and so on,
//   staying a moment after the call is answered, then fading;
// - a small pill at the top while a call is running: looking (a snapshot or a search), or working (an act).
// The bridge (agent/bridge.ts) says when a call starts and ends; the board's agent components (agent/boardAgent.tsx)
// say which card each action touched.
import { useEffect, useState } from 'react'
import { ViewportPortal, useStore } from '@xyflow/react'
import { emit, onEvent } from '../lib'
import { cn } from '@/lib/utils'

export type Verb = 'reading' | 'writing' | 'commenting' | 'arranging' | 'made'
const SAY: Record<Verb, string> = { reading: 'reading', writing: 'writing', commenting: 'commenting', arranging: 'arranging', made: 'made this' }
/** How long a frame stays after the agent last touched its card (and after the call is answered). */
const LINGER = 2200
/** How long a frame takes to fade. */
const FADE = 400

/** An agent touched this card: its frame shows (agent/boardAgent.tsx calls this from each card action). */
export const touchCard = (id: string | undefined, verb: Verb) => void (id && emit('agent-touch', { id, verb }))

// the server names the agent as the log does: "Claude Code", or the chat's own label ("Claude · …"), or "An agent"
const nameOf = (agent: string) => (/^claude/i.test(agent) ? 'Claude' : 'An agent')
let who = 'Claude'
type Busy = { on: boolean; tool?: string; agent?: string }

/** The frames, drawn on the board itself (they move and zoom with it). Inside <ReactFlow>. */
export function AgentFrames() {
  const [touched, setTouched] = useState<Map<string, { verb: Verb; until: number; who: string }>>(() => new Map())
  const [busy, setBusy] = useState(false)
  // a turn of the clock: the frames that have faded go, and the next fade is timed
  const [ticks, tick] = useState(0)
  useEffect(() => onEvent('agent-touch', (d: { id: string; verb: Verb }) => setTouched(m => new Map(m).set(d.id, { verb: d.verb, until: Date.now() + LINGER, who }))), [])
  useEffect(
    () =>
      onEvent('agent-busy', (d: Busy) => {
        if (d.on) who = nameOf(d.agent || '')
        setBusy(d.on)
        // answered: what it touched stays framed a moment longer, then fades
        if (!d.on) setTouched(m => new Map([...m].map(([id, t]) => [id, { ...t, until: Math.max(t.until, Date.now() + LINGER) }])))
      }),
    [],
  )
  // the next frame to fade, or to go once faded
  useEffect(() => {
    if (!touched.size || busy) return
    const now = Date.now()
    const next = Math.min(...[...touched.values()].map(t => (t.until > now ? t.until : t.until + FADE)))
    const timer = setTimeout(() => {
      const at = Date.now()
      setTouched(m => (([...m.values()].some(t => t.until + FADE <= at) ? new Map([...m].filter(([, t]) => t.until + FADE > at)) : m)))
      tick(x => x + 1)
    }, Math.max(30, next - now))
    return () => clearTimeout(timer)
  }, [touched, busy, ticks])
  // where the touched cards are now (a string, so this draws again only when one moves)
  const ids = [...touched.keys()]
  const key = useStore(s =>
    JSON.stringify(
      ids.flatMap(id => {
        const n = s.nodeLookup.get(id)
        if (!n || n.hidden) return []
        const { x, y } = n.internals.positionAbsolute
        return [[id, Math.round(x), Math.round(y), Math.round(n.measured?.width ?? n.width ?? 0), Math.round(n.measured?.height ?? n.height ?? 0)]]
      }),
    ),
  )
  const zoom = useStore(s => s.transform[2])
  const boxes = JSON.parse(key) as [string, number, number, number, number][]
  if (!boxes.length) return null
  const now = Date.now()
  // the tag stays readable zoomed out, as a section's title does
  const tagScale = Math.min(2.5, Math.max(1, 1 / zoom))
  return (
    <ViewportPortal>
      {boxes.map(([id, x, y, w, h]) => {
        const t = touched.get(id)
        if (!t) return null
        const leaving = !busy && now >= t.until
        return (
          <div key={id} className={cn('agent-frame', leaving && 'is-leaving')} style={{ transform: `translate(${x - 6}px, ${y - 6}px)`, width: w + 12, height: h + 12 }} aria-hidden>
            <span className="agent-frame-tag" style={{ scale: tagScale }}>
              {t.who} · {SAY[t.verb]}
            </span>
          </div>
        )
      })}
    </ViewportPortal>
  )
}

/** The pill at the top while a call runs: at least a moment, so a quick look is seen too. */
export function AgentPill() {
  const [state, setState] = useState<{ text: string; shown: boolean }>({ text: '', shown: false })
  useEffect(() => {
    let since = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    return onEvent('agent-busy', (d: Busy) => {
      if (timer) clearTimeout(timer)
      if (d.on) {
        since = Date.now()
        const name = nameOf(d.agent || '')
        setState({ text: d.tool === 'act' ? `${name} is working on the board` : `${name} is looking at the board`, shown: true })
      } else timer = setTimeout(() => setState(s => ({ ...s, shown: false })), Math.max(700, 1400 - (Date.now() - since)))
    })
  }, [])
  return (
    <div className={cn('agent-pill glass', state.shown && 'is-shown')} role="status" aria-live="polite">
      <span className="agent-pill-dot" aria-hidden />
      {state.text}
    </div>
  )
}
