// The page's end of Cockpit's board tools: a Claude Code chat calls board_snapshot, board_act or board_query (the MCP
// server), Cockpit's server passes the call to one open window (this one, if it was used last), UI SDK's bridge runs it
// on the components on the board, and the result goes back the same way.
// What an agent may do: read and use the board (spaces, cards, comments), Today, Later and Snippets (agent/*); every
// removal waits for the person to allow it.
// Experimental (spike/ui-sdk-today).
import { createAgent } from '@ui-sdk/react/agent'
import { post } from '../api'
import { lastEvent, onEvent } from '../lib'

type Call = { id: string; client: number; tool: 'snapshot' | 'act' | 'query'; input?: unknown }
export type Ask = (text: string) => Promise<boolean>

// what an agent may reach, and how a removal there is put to the person
const WHERE: Record<string, string> = { 'task-list': 'from Today', board: 'from the board', card: 'from the board', 'later-list': 'from Later', 'snippet-list': 'from Snippets' }

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
      if (component === 'card' && action === 'removeRow') return ask(`Claude wants to take row "${String(args?.[0] ?? '')}" out of the table "${String(label)}"`)
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
    try {
      if (c.tool === 'snapshot') output = agent.snapshot()
      else if (c.tool === 'act') output = await agent.act(c.input as Parameters<typeof agent.act>[0])
      else if (c.tool === 'query') output = await agent.query((c.input || {}) as Parameters<typeof agent.query>[0])
      else output = { error: `No tool ${c.tool}` }
    } catch (e: any) {
      output = { error: e?.message || String(e) }
    }
    post('/api/agent/result', { id: c.id, output }).catch(() => {})
  })
}
