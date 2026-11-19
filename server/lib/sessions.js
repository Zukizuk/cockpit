// Recent Claude Code chats, from their transcripts (~/.claude/projects/<folder>/<session>.jsonl): title, where,
// whose turn it is, and the last messages. Transcripts can be hundreds of MB, so only their ends are read.
import fs from 'node:fs'
import path from 'node:path'
import { HOME, UserError, within } from './config.js'

const NAME_RE = /^[A-Za-z0-9._-]{1,200}$/
const TAIL_STEPS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024]
const MAX_LINE = 4 * 1024 * 1024
const WORKING_MS = 10 * 60 * 1000
const MAX_SESSIONS = 40

function readRange(file, start, end) {
  const len = Math.max(0, end - start)
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/** Parsed entries from the last `bytes` of a transcript (the first, cut-off line dropped). */
export function tailEntries(file, size, bytes) {
  const start = Math.max(0, size - bytes)
  let text = readRange(file, start, size)
  if (start > 0) {
    const nl = text.indexOf('\n')
    text = nl >= 0 ? text.slice(nl + 1) : ''
  }
  return parseLines(text)
}

export function parseLines(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line || line.length > MAX_LINE || line[0] !== '{') continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // a line still being written
    }
  }
  return out
}

/** Removes what the app and harness add around a person's words. */
export function cleanUserText(text) {
  let t = String(text || '')
  const task = /^\s*<scheduled-task name="([^"]+)"/.exec(t)
  if (task) return `⏰ Scheduled task: ${task[1]}`
  const cmd = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(t)
  if (cmd) {
    const args = (/<command-args>([\s\S]*?)<\/command-args>/.exec(t) || [])[1] || ''
    return `${cmd[1]}${args.trim() ? ` ${args.trim().slice(0, 200)}` : ''}`
  }
  t = t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<local-command-std(out|err)>[\s\S]*?<\/local-command-std(out|err)>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/<\/?(ide_opened_file|ide_selection|user-prompt-submit-hook)[^>]*>/g, '')
  return t.trim()
}

function toolSummary(block) {
  const input = block?.input && typeof block.input === 'object' ? block.input : {}
  const pickKey = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt', 'action', 'title']
  for (const k of pickKey) if (typeof input[k] === 'string' && input[k].trim()) return input[k].replace(/\s+/g, ' ').trim().slice(0, 140)
  const first = Object.values(input).find(v => typeof v === 'string' && v.trim())
  return typeof first === 'string' ? first.replace(/\s+/g, ' ').trim().slice(0, 140) : ''
}

/** One transcript entry as a message for display, or null when it is not part of the conversation. */
export function toMessage(e) {
  if (!e || e.isSidechain) return null
  if (e.type === 'user') {
    if (e.isMeta) return null
    const c = e.message?.content
    if (typeof c === 'string') {
      const text = cleanUserText(c)
      return text ? { role: 'user', text, at: e.timestamp } : null
    }
    if (Array.isArray(c)) {
      if (c.some(b => b?.type === 'tool_result')) return { role: 'tool-result', at: e.timestamp, isError: c.some(b => b?.is_error) }
      const text = cleanUserText(c.filter(b => b?.type === 'text').map(b => b.text).join('\n'))
      const images = c.filter(b => b?.type === 'image').length
      if (!text && !images) return null
      return { role: 'user', text: text + (images ? `${text ? '\n\n' : ''}_(${images} image${images > 1 ? 's' : ''})_` : ''), at: e.timestamp }
    }
    return null
  }
  if (e.type === 'assistant') {
    const c = e.message?.content
    if (!Array.isArray(c)) return null
    const text = c.filter(b => b?.type === 'text' && b.text).map(b => b.text).join('\n\n')
    const tools = c.filter(b => b?.type === 'tool_use').map(b => ({ name: String(b.name || ''), summary: toolSummary(b) }))
    if (!text && !tools.length) return null
    return { role: 'assistant', id: e.message?.id, text, tools, at: e.timestamp }
  }
  return null
}

/** Conversation messages in order, with an assistant reply's blocks (written one per line) joined. */
export function messagesFrom(entries) {
  const out = []
  for (const e of entries) {
    const m = toMessage(e)
    if (!m) continue
    const prev = out[out.length - 1]
    if (m.role === 'assistant' && prev?.role === 'assistant' && m.id && prev.id === m.id) {
      prev.text = [prev.text, m.text].filter(Boolean).join('\n\n')
      prev.tools.push(...m.tools)
      prev.at = m.at
    } else if (m.role === 'tool-result' && prev?.role === 'tool-result') {
      prev.at = m.at
      prev.count = (prev.count || 1) + 1
    } else out.push(m)
  }
  return out
}

const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** your-turn | question | working | quiet, from the last message and how long ago the file changed. */
export function stateOf(last, ageMs) {
  if (!last) return 'quiet'
  if (last.role === 'assistant') {
    if (last.tools?.some(t => ASKING_TOOLS.has(t.name))) return 'question'
    if (last.tools?.length) return ageMs < WORKING_MS ? 'working' : 'quiet'
    return ageMs < 20_000 ? 'working' : 'your-turn'
  }
  if (last.role === 'user' && /^\[Request interrupted/.test(last.text)) return 'your-turn'
  return ageMs < WORKING_MS ? 'working' : 'quiet'
}

function sessionFile(cfg, key) {
  const [dir, id] = String(key || '').split('~')
  if (!NAME_RE.test(dir || '') || !NAME_RE.test(id || '')) throw new UserError('Not a session', 404)
  const root = path.resolve(cfg.claudeProjectsDir)
  const file = path.join(root, dir, `${id}.jsonl`)
  if (!within(root, file)) throw new UserError('Not a session', 404)
  return file
}

function projectLabel(cwd) {
  if (!cwd) return ''
  const norm = path.resolve(cwd)
  if (norm.toLowerCase() === path.resolve(HOME).toLowerCase()) return '~'
  return path.basename(norm)
}

/** Reads from the end until there are at least `want` messages (or the whole file). */
function readTail(file, size, want) {
  let entries = []
  let messages = []
  for (const step of TAIL_STEPS) {
    entries = tailEntries(file, size, step)
    messages = messagesFrom(entries)
    if (messages.length >= want || step >= size) break
  }
  return { entries, messages }
}

/** A chat started by a scheduled task (its first message is the scheduler's), not by the user. */
export function isAutomatic(head) {
  const first = head.find(e => e.type === 'user' && !e.isSidechain)
  if (!first) return false
  const c = first.message?.content
  return first.origin?.subkind === 'scheduled-trigger' || (typeof c === 'string' && /^\s*<scheduled-task\b/.test(c))
}

export function summarizeSession(cfg, dir, id, now = Date.now()) {
  const file = path.join(cfg.claudeProjectsDir, dir, `${id}.jsonl`)
  const st = fs.statSync(file)
  const { entries, messages } = readTail(file, st.size, 2)
  let title = ''
  let cwd = ''
  let entrypoint = ''
  let lastPrompt = ''
  for (const e of entries) {
    if (e.type === 'custom-title' && e.customTitle) title = e.customTitle
    if (e.type === 'last-prompt' && e.lastPrompt) lastPrompt = e.lastPrompt
    if (e.cwd && !e.isSidechain) cwd = e.cwd
    if (e.entrypoint) entrypoint = e.entrypoint
  }
  const head = parseLines(readRange(file, 0, Math.min(st.size, 128 * 1024)))
  for (const e of head) {
    if (!title && e.type === 'custom-title' && e.customTitle) title = e.customTitle
    if (!cwd && e.cwd) cwd = e.cwd
    if (!entrypoint && e.entrypoint) entrypoint = e.entrypoint
  }
  if (!title) title = messagesFrom(head).find(m => m.role === 'user')?.text || ''
  if (!title) title = lastPrompt
  const last = messages[messages.length - 1]
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  const lastReply = [...messages].reverse().find(m => m.role === 'assistant' && m.text)
  const age = now - st.mtimeMs
  return {
    key: `${dir}~${id}`,
    id,
    title: title.replace(/\s+/g, ' ').trim().slice(0, 120) || '(untitled)',
    cwd,
    project: projectLabel(cwd),
    entrypoint,
    automatic: isAutomatic(head),
    lastActivity: st.mtimeMs,
    size: st.size,
    state: stateOf(last, age),
    lastPrompt: (lastUser?.text || lastPrompt || '').replace(/\s+/g, ' ').slice(0, 200),
    lastReply: (lastReply?.text || '').replace(/\s+/g, ' ').slice(0, 280),
    asking: last?.role === 'assistant' ? last.tools?.find(t => ASKING_TOOLS.has(t.name))?.name || '' : '',
  }
}

export function listSessions(cfg, now = Date.now()) {
  const root = cfg.claudeProjectsDir
  const since = now - cfg.sessionsDays * 24 * 3600 * 1000
  const files = []
  let dirs = []
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && NAME_RE.test(d.name))
  } catch {
    return []
  }
  for (const d of dirs) {
    let names = []
    try {
      names = fs.readdirSync(path.join(root, d.name)).filter(n => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const n of names) {
      const id = n.slice(0, -6)
      // agent-*.jsonl are a sub-agent's own transcript, part of another chat
      if (!NAME_RE.test(id) || id.startsWith('agent-')) continue
      try {
        const st = fs.statSync(path.join(root, d.name, n))
        if (st.mtimeMs >= since) files.push({ dir: d.name, id, mtime: st.mtimeMs })
      } catch {
        // gone meanwhile
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const out = []
  for (const f of files.slice(0, MAX_SESSIONS)) {
    try {
      out.push(summarizeSession(cfg, f.dir, f.id, now))
    } catch {
      // unreadable transcript: leave it out
    }
  }
  return out
}

export function readTranscript(cfg, key, want = 120) {
  const file = sessionFile(cfg, key)
  let st
  try {
    st = fs.statSync(file)
  } catch {
    throw new UserError('That session is gone', 404)
  }
  const [dir, id] = key.split('~')
  const summary = summarizeSession(cfg, dir, id)
  const { messages } = readTail(file, st.size, want)
  return { ...summary, messages: messages.slice(-want) }
}
