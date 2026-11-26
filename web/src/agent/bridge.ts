// The page's end of Cockpit's board tools: a Claude Code chat calls board_snapshot, board_act or board_query (the MCP
// server), Cockpit's server passes the call to one open window (this one, if it was used last), UI SDK's bridge runs it
// on the components on the board, and the result goes back the same way.
// What an agent may do: read and use the board (spaces, cards, comments), Today, Later and Snippets (agent/*); every
// removal waits for the person to allow it.
// Experimental (spike/ui-sdk-today).
import { createAgent } from '@ui-sdk/react/agent'
import { post, type AgentAccess } from '../api'
import { agentView, setAgentAccess } from './view'
import { emit, lastEvent, onEvent } from '../lib'
import { awake } from './awake'

type Call = { id: string; client: number; tool: 'snapshot' | 'act' | 'query'; input?: unknown; access?: AgentAccess; agent?: string }
/** Puts a question to the person (a toast with a button); true when they press it. */
export type Ask = (text: string, button?: string) => Promise<boolean>

// what an agent may reach, and how a removal there is put to the person
const WHERE: Record<string, string> = { 'task-list': 'from Today', board: 'from the board', card: 'from the board', 'later-list': 'from Later', 'snippet-list': 'from Snippets', 'question-list': 'from Questions' }

/**
 * What an act answers: whether it worked and each step's result (a read() gives its contents there). UI SDK also adds
 * every component's value ("values") and what appeared with its state: the whole board again after each step, which
 * the agent didn't ask for. Those go; what appeared keeps its ref, kind and title, so a new card can be used next.
 */
function trimAct(out: unknown) {
  if (!out || typeof out !== 'object') return out
  const { values: _values, appeared, ...rest } = out as { values?: unknown; appeared?: { ref?: string; component?: string; label?: string }[]; steps?: { result?: unknown }[] }
  const fresh = Array.isArray(appeared) ? appeared.map(a => ({ ref: a.ref, component: a.component, label: a.label })) : []
  // a change that takes a moment (a note, a table) reports through its card's pending and error, which act waits on:
  // a step that comes back "pending" without an error has finished, so it says so (else the agent can't tell)
  const steps = rest.steps
  // a step's "changes" (the components it changed, with their whole value: the board's again, for a focus) go too
  if (Array.isArray(steps))
    rest.steps = steps.map(st => {
      const { changes: _c, ...step } = st as { result?: unknown; changes?: unknown }
      return step.result === 'pending' ? { ...step, result: 'done' } : step
    })
  return { ...rest, ...(fresh.length ? { appeared: fresh } : {}) }
}

/**
 * What a step that waits for the person would do, in words ("remove "Ideas" from the board"), or null when it doesn't
 * wait. Taking something away is the person's call; so is writing over a whole note or table, taking a row out of a
 * table, or an arrow away. A card is named by its own label; a list item by the step's argument.
 */
function needsAllow(component: string, action: string, args: unknown[] | undefined, label: unknown): string | null {
  const where = WHERE[component]
  if (!where) return null
  const arg = String(args?.[0] ?? '')
  if (action === 'remove') return `remove "${component === 'card' ? String(label) : arg}" ${where}`
  if (component === 'board' && action === 'removeSection')
    return `remove the section "${arg}"${args?.[1] === true || String(args?.[1]) === 'true' ? ' and everything in it' : ' (its cards stay)'}`
  if (component !== 'card') return null
  if (action === 'setRows') return `replace everything in the table "${String(label)}"`
  if (action === 'setText') return `rewrite the note "${String(label)}"`
  if (action === 'removeRow') return `take row "${arg}" out of the table "${String(label)}"`
  if (action === 'disconnect') return `take away the arrow between "${String(label)}" and "${arg}"`
  return null
}

/**
 * What is on the board now. UI SDK keeps listing a component that left the page ("offPage", with the state it had):
 * on a board, that's a card taken off, which is gone, so it's left out (else an agent sees cards that aren't there).
 */
function onPage<T>(out: T): T {
  return (Array.isArray(out) ? out.filter(c => !(c && typeof c === 'object' && (c as { offPage?: unknown }).offPage)) : out) as T
}

let started = false
let me = 0
/** The steps of the call running now that the person has already allowed, all at once: how many of each action. */
let allowed = new Map<string, number>()

/** The last Allow nobody pressed: whether Cockpit's window was out of sight while it waited (for what Claude is told). */
let unanswered: { away: boolean } | null = null

export function startAgentBridge(asker: Ask) {
  if (started) return
  started = true
  const ask: Ask = async (text, button) => {
    const away = document.hidden
    const ok = await asker(text, button)
    if (!ok) unanswered = { away: away || document.hidden }
    return ok
  }
  /** What Claude is told when an Allow went unanswered: why, and what to do. */
  const noAllow = () =>
    unanswered?.away
      ? "Nobody pressed Allow: Cockpit's window was minimised or behind others, so the user likely didn't see it (its taskbar button flashed). Nothing was changed. Ask the user in the chat to bring Cockpit up, then try again."
      : 'Nobody pressed Allow in Cockpit within 20 seconds, so nothing was changed. Ask the user in the chat whether they want it, then try again while they watch the board.'
  const agent = createAgent({
    allow: ({ component, action, args, label }) => {
      if (!WHERE[component]) return false
      const what = needsAllow(component, action, args, label)
      if (!what) return true
      // a change that waits for the person: the card it's on is framed while they decide (agent/presence.tsx)
      emit('agent-asking', { component, action, label: String(label ?? ''), arg: String(args?.[0] ?? '') })
      // allowed with the rest of its call
      const left = allowed.get(action) ?? 0
      if (left > 0) {
        allowed.set(action, left - 1)
        return true
      }
      return ask(`Claude wants to ${what}`)
    },
  })

  /** A step the app refused because nobody pressed Allow: says so, and why, instead of only "refused". */
  const explainRefusal = (out: unknown) => {
    const o = out as { ok?: boolean; error?: { message?: string } } | null
    if (!o || o.ok !== false || !unanswered || !o.error?.message || !/refused/i.test(o.error.message)) return out
    return { ...o, error: { ...o.error, message: `${o.error.message} ${noAllow()}` } }
  }
  /**
   * After a change: what the user now sees that may need fixing, cards on top of each other or sticking out of their
   * section (from the board's own value), so the agent needn't ask the user to look.
   */
  const ARRANGING = new Set(['addSection', 'tidy', 'placeNextTo', 'moveToSection', 'fitSection', 'addTable', 'addSticky', 'show', 'addPage', 'bringBack', 'unfold', 'tuckSection', 'foldSection', 'setRows', 'addRows'])
  const withLayout = async (out: unknown, steps: unknown) => {
    const acts = Array.isArray(steps) ? steps.map(s => String((s as { action?: unknown })?.action ?? '')) : []
    if (!acts.some(a => ARRANGING.has(a))) return out
    // what moved settles first (a new section lays its cards out a moment after it's made; a card is measured once drawn)
    await new Promise(r => setTimeout(r, 300))
    try {
      const b = (agent.snapshot() as { component?: string; value?: { overlapping?: string[]; stickingOut?: string[] } }[]).find(c => c.component === 'board')?.value
      if (!b?.overlapping?.length && !b?.stickingOut?.length) return out
      return {
        ...(out as object),
        layout: {
          ...(b.overlapping?.length ? { overlapping: b.overlapping } : {}),
          ...(b.stickingOut?.length ? { stickingOut: b.stickingOut } : {}),
          fix: 'tidy(section) lays out what is in a section in rows and fits it; placeNextTo moves one card; tidy() packs the loose cards.',
        },
      }
    } catch {
      return out
    }
  }

  /**
   * Several steps of one call that would each wait for the person: one question for all of them, before any runs
   * ("Claude wants to do 4 things: …", Allow all). Allowed, they go through; not, the call doesn't run at all. A step
   * named by a ref or title the page doesn't know is left to ask on its own.
   */
  const askAllAtOnce = async (steps: { ref?: unknown; action?: unknown; args?: unknown[] }[]) => {
    allowed = new Map()
    const page = agent.snapshot() as { ref?: string; component?: string; label?: string }[]
    const find = (ref: unknown) => {
      const r = String(ref ?? '')
      return page.find(c => c.ref === r) ?? page.find(c => c.label === r) ?? page.find(c => c.label?.toLowerCase() === r.toLowerCase())
    }
    const asks = steps.flatMap(s => {
      const c = find(s.ref)
      const what = c && needsAllow(String(c.component), String(s.action ?? ''), s.args, c.label)
      return what ? [{ what, action: String(s.action), component: String(c!.component), label: String(c!.label ?? ''), arg: String(s.args?.[0] ?? '') }] : []
    })
    if (asks.length < 2) return true
    for (const a of asks) emit('agent-asking', { component: a.component, action: a.action, label: a.label, arg: a.arg })
    // one per line
    const list = asks.map((a, i) => `${i + 1}. ${a.what[0].toUpperCase()}${a.what.slice(1)}`).join('\n')
    const ok = await ask(`Claude wants to do ${asks.length} things:\n${list}`, 'Allow all')
    if (ok) for (const a of asks) allowed.set(a.action, (allowed.get(a.action) ?? 0) + 1)
    return ok
  }
  // the server says which window this is; the one used last answers the board tools
  const here = () => me && document.visibilityState === 'visible' && post('/api/agent/here', { client: me }).catch(() => {})
  onEvent('hello', (d: { client?: number }) => {
    me = Number(d.client) || 0
    here()
  })
  // this window may have been told before the bridge started
  me = Number(lastEvent('hello')?.client) || 0
  here()
  addEventListener('focus', here)
  document.addEventListener('visibilitychange', here)

  onEvent('agent-call', (c: Call) => {
    if (!me || c.client !== me) return
    // minimised or behind other windows: the call keeps its pace all the same (agent/awake.ts)
    void awake(() => answer(c))
  })
  const answer = async (c: Call) => {
    let output: unknown
    // for the log (Settings > Agents): what it asked, and the cards it could see then (titles only)
    let what = ''
    let saw: string[] = []
    // the board says an agent is at work (agent/presence.tsx), until the answer has gone back
    emit('agent-busy', { on: true, tool: c.tool, agent: c.agent || '' })
    try {
      // the board shows this agent only what its access allows (agent/view.ts)
      await setAgentAccess(c.access === 'all' || c.access === 'off' ? c.access : 'shared', c.agent || '')
      saw = agentView().titles
      if (c.tool === 'query') what = `looked for "${String((c.input as { text?: unknown })?.text ?? '').slice(0, 80)}"`
      if (c.tool === 'act') {
        const steps = ((c.input as { steps?: { ref?: unknown; action?: unknown }[] })?.steps || []).slice(0, 5)
        what = steps.map(s => `${String(s.action ?? '')} on ${String(s.ref ?? '')}`).join(', ')
        saw = []
      }
      if (c.tool === 'snapshot') {
        output = onPage(agent.snapshot())
        // the board itself always answers; nothing at all means the page couldn't be read, not an empty board
        if (Array.isArray(output) && !output.some(x => (x as { component?: string })?.component === 'board'))
          output = [{ component: 'note', text: "Cockpit's board couldn't be read just now (the page may be reloading). Nothing is lost: look again in a moment, and don't take this for an empty board." }, ...output]
      }
      else if (c.tool === 'act') {
        const steps = (c.input as { steps?: { ref?: unknown; action?: unknown; args?: unknown[] }[] })?.steps
        unanswered = null
        if (Array.isArray(steps) && !(await askAllAtOnce(steps))) output = { ok: false, error: { message: `The user did not allow these changes, so none of the steps ran. ${noAllow()}` }, steps: [] }
        else output = await withLayout(explainRefusal(trimAct(await agent.act(c.input as Parameters<typeof agent.act>[0]))), steps)
        allowed = new Map()
      }
      else if (c.tool === 'query') output = onPage(await agent.query((c.input || {}) as Parameters<typeof agent.query>[0]))
      else output = { error: `No tool ${c.tool}` }
    } catch (e: any) {
      output = { error: e?.message || String(e) }
    }
    emit('agent-busy', { on: false })
    post('/api/agent/result', { id: c.id, output, what, saw }).catch(() => {})
  }
}
