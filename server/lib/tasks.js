// A simple to-do list kept on this PC, for the Today card when Todoist isn't connected: add, tick off, change,
// remove. One file, ~/.cockpit/tasks.json. Ticked-off tasks stay (struck through) until the next day.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'
import { localDay } from './todoist.js'

const file = () => path.join(DATA_DIR, 'tasks.json')
const MAX = 500

function readAll() {
  try {
    const t = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return Array.isArray(t.tasks) ? t.tasks.filter(x => x && typeof x.id === 'string' && typeof x.content === 'string') : []
  } catch {
    return []
  }
}
const writeAll = tasks => writeFileAtomic(file(), JSON.stringify({ tasks }, null, 2))
const text = v => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  if (!s) throw new UserError('A task needs some words')
  return s.slice(0, 500)
}

/** Open tasks in the order they were added, then those ticked off today; older ticked-off ones are cleared. */
export function listTasks(today = localDay()) {
  const all = readAll()
  const kept = all.filter(t => !t.doneOn || t.doneOn >= today)
  if (kept.length !== all.length) writeAll(kept)
  return [...kept.filter(t => !t.doneOn), ...kept.filter(t => t.doneOn)]
}

export function addTask(content, id) {
  const all = readAll()
  if (all.length >= MAX) throw new UserError('That is a lot of tasks: tick some off first')
  // the card makes its own id so the task shows at once; a repeat of the same id is the same task
  const tid = typeof id === 'string' && /^[a-z0-9-]{6,40}$/i.test(id) ? id : crypto.randomUUID()
  const existing = all.find(t => t.id === tid)
  if (existing) return existing
  const t = { id: tid, content: text(content), createdAt: new Date().toISOString(), doneOn: '' }
  all.push(t)
  writeAll(all)
  return t
}

export function updateTask(id, patch, today = localDay()) {
  const all = readAll()
  const t = all.find(x => x.id === id)
  if (!t) throw new UserError('That task is gone', 404)
  if (patch.content !== undefined) t.content = text(patch.content)
  if (patch.done !== undefined) t.doneOn = patch.done ? today : ''
  writeAll(all)
  return t
}

export function removeTask(id) {
  writeAll(readAll().filter(t => t.id !== id))
  return { ok: true }
}
