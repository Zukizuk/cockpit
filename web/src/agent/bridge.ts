// The page's end of Cockpit's board tools: a Claude Code chat calls board_snapshot, board_act or board_query (the MCP
// server), Cockpit's server passes the call to one open window (this one, if it was used last), UI SDK's bridge runs it
// on the components on the board, and the result goes back the same way.
// What an agent may do: read anything UI SDK shows it; on the Today list, add, tick off, reopen and rename; a removal
// waits for the person to allow it. Nothing else on the board is a UI SDK component, so nothing else is reachable.
// Experimental (spike/ui-sdk-today).
import { createAgent } from '@ui-sdk/react/agent'
import { post } from '../api'
import { lastEvent, onEvent } from '../lib'

type Call = { id: string; client: number; tool: 'snapshot' | 'act' | 'query'; input?: unknown }
export type Ask = (text: string) => Promise<boolean>

let started = false
let me = 0

export function startAgentBridge(ask: Ask) {
  if (started) return
  started = true
  const agent = createAgent({
    allow: ({ component, action, args }) => {
      if (component !== 'task-list') return false
      if (action === 'remove') return ask(`Claude wants to remove "${String(args?.[0] ?? '')}" from Today`)
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
