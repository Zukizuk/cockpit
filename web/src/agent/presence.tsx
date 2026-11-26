// Where an agent is at work, on the board, so the person always sees what Claude looks at and changes, not only the
// result:
// - a frame round each card it reads, writes, comments on or arranges (or made), named "Claude · reading" and so on,
//   staying a moment after the call is answered, then fading;
// - a small pill at the top while a call is running: looking (a snapshot or a search), or working (an act).
// The bridge (agent/bridge.ts) says when a call starts and ends; the board's agent components (agent/boardAgent.tsx)
// say which card each action touched.
import { useEffect, useRef, useState } from 'react'
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import { ArrowUp, X } from 'lucide-react'
import { get, post } from '../api'
import { emit, onEvent } from '../lib'
import { cn } from '@/lib/utils'

export type Verb = 'reading' | 'writing' | 'commenting' | 'arranging' | 'made' | 'removing' | 'rewriting'
const SAY: Record<Verb, string> = { reading: 'reading', writing: 'writing', commenting: 'commenting', arranging: 'arranging', made: 'made this', removing: 'wants to remove', rewriting: 'wants to rewrite' }
/** How long a frame stays after the agent last touched its card (and after the call is answered). */
const LINGER = 5000
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
  const rf = useReactFlow()
  // The view follows the agent: a card it changes, makes or asks about, on the space shown, that is mostly off the
  // screen, glides into view (the zoom stays). Not for reading: that would jump about.
  const follow = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () =>
      onEvent('agent-touch', (d: { id: string; verb: Verb }) => {
        setTouched(m => new Map(m).set(d.id, { verb: d.verb, until: Date.now() + LINGER, who }))
        if (d.verb === 'reading') return
        clearTimeout(follow.current)
        // the last one touched in a moment, once it has its place
        follow.current = setTimeout(() => {
          const n = rf.getInternalNode(d.id)
          if (!n || n.hidden) return
          const { x, y } = n.internals.positionAbsolute
          const w = n.measured?.width ?? n.width ?? 0
          const h = n.measured?.height ?? n.height ?? 0
          const { x: vx, y: vy, zoom } = rf.getViewport()
          const sx0 = x * zoom + vx
          const sy0 = y * zoom + vy
          const sx1 = sx0 + w * zoom
          const sy1 = sy0 + h * zoom
          const seen = Math.max(0, Math.min(sx1, innerWidth) - Math.max(sx0, 0)) * Math.max(0, Math.min(sy1, innerHeight) - Math.max(sy0, 0))
          if (seen >= 0.6 * Math.max(1, (sx1 - sx0) * (sy1 - sy0))) return
          rf.setCenter(x + w / 2, y + Math.min(h / 2, innerHeight / zoom / 2 - 60), { zoom, duration: 420 })
        }, 150)
      }),
    [rf],
  )
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

/** How long the pill stays once the agent is done, saying when it last was at work. */
const AFTER = 30_000

/**
 * The pill at the top right: while a call runs, what the agent is doing ("Claude is working on the board"); once it's
 * done, for half a minute, when it last was ("Claude worked on the board · 12 s ago"), then it goes. Calls close
 * together count as one stretch of work: "worked" if any of them changed something, "looked" if they only looked.
 */
export function AgentPill() {
  const [s, setS] = useState<{ phase: 'idle' | 'busy' | 'after'; name: string; acted: boolean; tool: string; at: number }>({ phase: 'idle', name: 'Claude', acted: false, tool: '', at: 0 })
  const [, tick] = useState(0)
  useEffect(
    () =>
      onEvent('agent-busy', (d: Busy) =>
        setS(prev => {
          const fresh = prev.phase === 'idle'
          if (d.on) return { phase: 'busy', name: nameOf(d.agent || ''), acted: (fresh ? false : prev.acted) || d.tool === 'act', tool: d.tool || '', at: Date.now() }
          return { ...prev, phase: 'after', at: Date.now() }
        }),
      ),
    [],
  )
  // after: the time ago, a second at a time, and gone after half a minute
  useEffect(() => {
    if (s.phase !== 'after') return
    const t = setInterval(() => {
      if (Date.now() - s.at >= AFTER) setS(prev => (prev.phase === 'after' ? { ...prev, phase: 'idle' } : prev))
      else tick(x => x + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [s.phase, s.at])
  const listening = useListening()
  const ago = Math.round((Date.now() - s.at) / 1000)
  const when = ago < 5 ? 'just now' : `${ago} s ago`
  const text =
    s.phase === 'busy'
      ? s.tool === 'act'
        ? `${s.name} is working on the board`
        : `${s.name} is looking at the board`
      : s.phase === 'after'
        ? `${s.name} ${s.acted ? 'worked on' : 'looked at'} the board · ${when}`
        : listening.length
          ? `${nameOf(listening[0])} is listening`
          : ''
  const shown = s.phase !== 'idle' || listening.length > 0
  return (
    <div className={cn('agent-pill glass', shown && 'is-shown', s.phase === 'after' && 'is-after', s.phase === 'idle' && 'is-listening')} role="status" aria-live="polite">
      <span className="agent-pill-dot" aria-hidden />
      <span>{text}</span>
      {listening.length > 0 && s.phase !== 'busy' && <TellClaude who={listening} />}
      {/* the chat stops listening (it's told not to start again unasked) */}
      {listening.length > 0 && s.phase !== 'busy' && (
        <button type="button" className="tell-btn tell-stop" title={`${nameOf(listening[0])} stops listening for the board`} onClick={() => post('/api/agent/stop-listening').catch(() => {})}>
          Stop listening
        </button>
      )}
    </div>
  )
}

/** The chats listening for the user right now (each running scripts/wait-ping.mjs), by name. */
export function useListening() {
  const [labels, setLabels] = useState<string[]>([])
  useEffect(() => {
    get<{ listening: string[] }>('/api/agent/listening').then(r => setLabels(r.listening), () => {})
    return onEvent('agent-listening', (d: { listening?: string[] }) => setLabels(d.listening || []))
  }, [])
  return labels
}

/** Tells the listening chat something: a few words, or just that the user wants it to look. Enter sends, Esc closes. */
export function TellClaude({ who, about, text: preset, label = 'Tell Claude' }: { who: string[]; about?: string; text?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState('')
  const name = who.length === 1 ? who[0] : `${who.length} chats`
  const send = async (words: string) => {
    try {
      const r = await post<{ told: string[] }>('/api/agent/ping', { text: words, ...(about ? { about } : {}) })
      setSent(r.told.length ? 'Sent' : 'No one is listening now')
    } catch {
      setSent("Couldn't send it")
    }
    setOpen(false)
    setText('')
    setTimeout(() => setSent(''), 2500)
  }
  if (sent) return <span className="tell-sent">{sent}</span>
  // a set message (the Questions card's "I've answered"): one click
  if (preset) return <button type="button" className="tell-btn" title={`Wakes ${name} with: ${preset}`} onClick={() => send(preset)}>{label}</button>
  return open ? (
    <form
      className="tell-form"
      onSubmit={e => {
        e.preventDefault()
        send(text)
      }}
    >
      <input
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            setOpen(false)
            setText('')
          }
        }}
        placeholder="Look at the board, or say what…"
        aria-label={`Tell ${name}`}
        maxLength={2000}
      />
      <button type="submit" className="tell-send" aria-label="Send">
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
      {/* changed your mind: nothing is sent, and Tell Claude is there again for later */}
      <button
        type="button"
        className="tell-close"
        aria-label="Close without telling Claude"
        title="Close without telling Claude (Esc)"
        onClick={() => {
          setOpen(false)
          setText('')
        }}
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </form>
  ) : (
    <button type="button" className="tell-btn" title={`Wakes ${name}, so it looks at the board`} onClick={() => setOpen(true)}>
      {label}
    </button>
  )
}
