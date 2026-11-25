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

type Call = { id: string; client: number; tool: 'snapshot' | 'act' | 'query'; input?: unknown; access?: AgentAccess; agent?: string }
export type Ask = (text: string) => Promise<boolean>

// what an agent may reach, and how a removal there is put to the person
const WHERE: Record<string, string> = { 'task-list': 'from Today', board: 'from the board', card: 'from the board', 'later-list': 'from Later', 'snippet-list': 'from Snippets' }

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

let started = false
let me = 0

export function startAgentBridge(ask: Ask) {
  if (started) return
  started = true
  const agent = createAgent({
    allow: ({ component, action, args, label }) => {
      const where = WHERE[component]
      if (!where) return false
      // taking something away is the person's call
      // a card is named by its own label; a list item by the step's argument
      if (action === 'remove') return ask(`Claude wants to remove "${String(component === 'card' ? label : (args?.[0] ?? ''))}" ${where}`)
      // a table: writing over all of it, or taking a row out, is the person's call too
      if (component === 'card' && action === 'setRows') return ask(`Claude wants to replace everything in the table "${String(label)}"`)
      if (component === 'card' && action === 'setText') return ask(`Claude wants to rewrite the note "${String(label)}"`)
      if (component === 'card' && action === 'removeRow') return ask(`Claude wants to take row "${String(args?.[0] ?? '')}" out of the table "${String(label)}"`)
      if (component === 'card' && action === 'disconnect') return ask(`Claude wants to take away the arrow between "${String(label)}" and "${String(args?.[0] ?? '')}"`)
      return true
    },
  })
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

  onEvent('agent-call', async (c: Call) => {
    if (!me || c.client !== me) return
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
      if (c.tool === 'snapshot') output = agent.snapshot()
      else if (c.tool === 'act') output = trimAct(await agent.act(c.input as Parameters<typeof agent.act>[0]))
      else if (c.tool === 'query') output = await agent.query((c.input || {}) as Parameters<typeof agent.query>[0])
      else output = { error: `No tool ${c.tool}` }
    } catch (e: any) {
      output = { error: e?.message || String(e) }
    }
    emit('agent-busy', { on: false })
    post('/api/agent/result', { id: c.id, output, what, saw }).catch(() => {})
  })
}
