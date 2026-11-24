// What agents did through Cockpit's board tools, so the person can see it (Settings > Agents): each call, which agent,
// and the cards it could see or acted on. The last 200, kept in ~/.cockpit/agent-log.json. Only titles, never contents.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, writeFileAtomic } from './config.js'

const KEEP = 200
const file = () => path.join(DATA_DIR, 'agent-log.json')

export function readAgentLog() {
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

const clip = (s, n = 120) => String(s ?? '').slice(0, n)

/** One call: { agent, tool, what (a line saying what it asked), saw (card titles), refused? }. */
export function logAgentCall({ agent, tool, what, saw, refused }, now = Date.now()) {
  const entry = {
    at: now,
    agent: clip(agent, 80),
    tool: clip(tool, 20),
    ...(what ? { what: clip(what, 200) } : {}),
    ...(Array.isArray(saw) && saw.length ? { saw: saw.slice(0, 40).map(t => clip(t)) } : {}),
    ...(refused ? { refused: clip(refused, 200) } : {}),
  }
  const list = [...readAgentLog(), entry].slice(-KEEP)
  writeFileAtomic(file(), JSON.stringify(list))
  return entry
}

export function clearAgentLog() {
  writeFileAtomic(file(), '[]')
}
