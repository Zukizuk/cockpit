// Todoist, through Todoist API v1 with a personal token kept in Cockpit's settings.
// Endpoints checked on 15 Nov 2026: tasks/filter, tasks/{id}/close, tasks/quick and projects answer under
// https://api.todoist.com/api/v1 (REST v2 answers 410 Gone).
import { UserError } from './config.js'

const BASE = 'https://api.todoist.com/api/v1'
const CACHE_MS = 60_000
let cache = { key: '', at: 0, data: null }

async function call(token, method, p, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403) throw new UserError('Todoist refused the token. Check it in Settings.', 502)
  if (!res.ok) throw new UserError(`Todoist answered ${res.status}`, 502)
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const listOf = r => (Array.isArray(r) ? r : Array.isArray(r?.results) ? r.results : Array.isArray(r?.items) ? r.items : [])

async function all(token, p, fetchImpl, max = 1000) {
  const out = []
  let cursor = null
  for (let page = 0; page < 10; page++) {
    const sep = p.includes('?') ? '&' : '?'
    const r = await call(token, 'GET', `${p}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, null, fetchImpl)
    out.push(...listOf(r))
    cursor = Array.isArray(r) ? null : r?.next_cursor
    if (!cursor || out.length >= max) break
  }
  return out
}

const pad = n => String(n).padStart(2, '0')
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** A task in the shape the app uses, with overdue worked out against the local date. */
export function normalizeTask(t, projects = {}, today = localDay()) {
  const due = t.due && typeof t.due === 'object' ? t.due : null
  const dueWhen = due ? String(due.datetime || due.date || '') : ''
  const dueDay = dueWhen.slice(0, 10)
  const hasTime = /T\d{2}:\d{2}/.test(dueWhen)
  return {
    id: String(t.id),
    content: String(t.content || ''),
    description: String(t.description || ''),
    projectId: t.project_id ? String(t.project_id) : '',
    projectName: projects[String(t.project_id)] || '',
    priority: Number(t.priority) || 1,
    labels: Array.isArray(t.labels) ? t.labels : [],
    due: due ? { day: dueDay, when: dueWhen, hasTime, string: String(due.string || ''), recurring: Boolean(due.is_recurring) } : null,
    overdue: Boolean(dueDay && dueDay < today),
    url: t.url || `https://app.todoist.com/app/task/${encodeURIComponent(String(t.id))}`,
  }
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) ||
    b.priority - a.priority ||
    String(a.due?.when || '9').localeCompare(String(b.due?.when || '9')) ||
    a.content.localeCompare(b.content))
}

/** Overdue and today's tasks, cached for a minute unless forced. */
export async function todayTasks(token, { force = false, fetchImpl = fetch } = {}) {
  if (!token) return { configured: false, tasks: [] }
  const key = token.slice(-6)
  if (!force && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data
  const [raw, projectList] = await Promise.all([
    all(token, `/tasks/filter?query=${encodeURIComponent('overdue | today')}`, fetchImpl),
    all(token, '/projects', fetchImpl).catch(() => []),
  ])
  const projects = Object.fromEntries(projectList.map(p => [String(p.id), String(p.name || '')]))
  const today = localDay()
  const tasks = sortTasks(raw.filter(t => !t.checked && !t.is_completed).map(t => normalizeTask(t, projects, today)))
  const data = { configured: true, tasks, fetchedAt: Date.now() }
  cache = { key, at: Date.now(), data }
  return data
}

export function forgetCache() {
  cache = { key: '', at: 0, data: null }
}

export async function closeTask(token, id, fetchImpl = fetch) {
  if (!token) throw new UserError('Add your Todoist token in Settings first')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new UserError('Not a task id')
  await call(token, 'POST', `/tasks/${encodeURIComponent(id)}/close`, null, fetchImpl)
  forgetCache()
}

/**
 * Adds a task from one line in Todoist's own language ("call Andrew tomorrow 3pm p1"). Typed into the Today card, a
 * line with no date of its own is for today (18 Nov: one without a date went to the Inbox and seemed to vanish).
 */
export async function quickAdd(token, text, fetchImpl = fetch) {
  if (!token) throw new UserError('Add your Todoist token in Settings first')
  const line = String(text || '').trim()
  if (!line) throw new UserError('Nothing to add')
  let r = await call(token, 'POST', '/tasks/quick', { text: line.slice(0, 1000) }, fetchImpl)
  if (r?.id && !r.due) r = (await call(token, 'POST', `/tasks/${encodeURIComponent(r.id)}`, { due_string: 'today' }, fetchImpl)) || r
  forgetCache()
  return r
}
