// What the agent calling right now may see on the board: its access (Settings > Agents, sent by the server with each
// call), and, worked out by BoardAgent, which cards that leaves in view. Cards it may not see are drawn inside
// data-agent-hidden, so UI SDK's agent never lists them, finds them or acts on them.
import { useSyncExternalStore } from 'react'
import type { AgentAccess } from '../api'

type View = { access: AgentAccess; agent: string; visible: Set<string>; titles: string[] }

let view: View = { access: 'shared', agent: '', visible: new Set(), titles: [] }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export const agentView = () => view
export function useAgentView() {
  return useSyncExternalStore(
    l => (listeners.add(l), () => listeners.delete(l)),
    () => view,
  )
}

/** Before a call: the caller's access. A change redraws the board's agent layer first. */
export async function setAgentAccess(access: AgentAccess, agent: string) {
  const changed = access !== view.access
  view = { ...view, access, agent }
  if (!changed) return
  emit()
  // the redraw happens on the next turn; give it a moment (a background window's timers are slower)
  await new Promise(r => setTimeout(r, 60))
}

/** From BoardAgent: the cards the caller can see now (ids, and their titles for the log). */
export function setVisible(visible: Set<string>, titles: string[]) {
  const same = visible.size === view.visible.size && [...visible].every(id => view.visible.has(id))
  if (same && titles.join('|') === view.titles.join('|')) return
  view = { ...view, visible, titles }
  emit()
}
