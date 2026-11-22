// Anonymous usage counts, only with your yes. Cockpit asks once (after its first day) and does nothing until then.
//
// What's kept: how many times each feature was used each day (a fixed list of names, below), the Cockpit version and
// the Windows build, under a random id made on this PC. Never what's on your board: no text, titles, links, paths or
// file names. It's sent once a day, as one event per day, to the project's PostHog (EU). "See what's sent" in Settings
// shows the exact data.
//
// Where it goes is set in package.json ("cockpitTelemetry": { host, key }). With no key (a fork, a dev build without
// one) nothing is counted, nothing is asked and nothing is sent.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, VERSION, UserError, writeFileAtomic } from './config.js'

/** The only things ever counted. */
export const EVENTS = new Set([
  'app.open', // Cockpit opened (once a day at most)
  'card.later', 'card.snippets', 'card.tasks', 'card.tracker', 'card.outputs', 'card.note', 'card.item', 'card.command',
  'sticky.new', 'note.title', 'journal.open', 'journal.past',
  'later.link', 'later.note', 'later.done',
  'item.fullscreen', 'item.link', 'item.file',
  'snippet.add', 'snippet.copy',
  'quick.open', 'quick.pin',
  'board.tidy', 'board.undo', 'board.lock', 'board.foldall', 'board.menu',
  'palette.open', 'keys.open', 'settings.open', 'feedback.open',
  'outputs.open', 'mcp.show', 'mcp.snippet',
  'add.pick', 'add.sendto', 'card.folder',
])
const ASK_AFTER = 24 * 3600_000
const MAX_DAYS = 30

const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'))
/** Where counts go (empty key: telemetry is off for this build). */
export const target = () => ({ host: pkg.cockpitTelemetry?.host || '', key: process.env.COCKPIT_TELEMETRY_KEY ?? pkg.cockpitTelemetry?.key ?? '' })

const file = () => path.join(DATA_DIR, 'telemetry.json')
const today = (d = new Date()) => d.toISOString().slice(0, 10)

export function readState() {
  let s = {}
  try {
    s = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}
  } catch {}
  if (!s.id) {
    s = { id: crypto.randomUUID(), firstSeen: Date.now(), choice: null, days: {} }
    writeState(s)
  }
  return { choice: null, days: {}, ...s }
}

function writeState(s) {
  writeFileAtomic(file(), JSON.stringify(s, null, 1) + '\n')
}

/** What Settings and the one-time question need. */
export function status(now = Date.now()) {
  const s = readState()
  const available = !!target().key
  return { available, choice: s.choice, ask: available && s.choice === null && now - s.firstSeen > ASK_AFTER, preview: preview(s), lastSent: s.lastSent || null }
}

/** Yes or no (asked once; changeable in Settings). No also forgets anything counted. */
export function choose(choice) {
  if (choice !== 'yes' && choice !== 'no') throw new UserError('Choose yes or no')
  const s = readState()
  s.choice = choice
  if (choice === 'no') s.days = {}
  writeState(s)
  return status()
}

/** One use of a feature, counted only with a yes. Unknown names are ignored. */
export function count(event, at = new Date()) {
  if (!EVENTS.has(event) || !target().key) return
  const s = readState()
  if (s.choice !== 'yes') return
  const day = today(at)
  const d = (s.days[day] ||= {})
  if (event === 'app.open' && d[event]) return
  d[event] = (d[event] || 0) + 1
  writeState(s)
}

/** Exactly what would be sent: one event per finished day. */
export function preview(s = readState(), at = new Date()) {
  const now = today(at)
  return Object.entries(s.days)
    .filter(([day]) => day < now)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-MAX_DAYS)
    .map(([day, counts]) => ({
      event: 'daily_usage',
      distinct_id: s.id,
      timestamp: `${day}T12:00:00Z`,
      properties: { day, ...counts, version: VERSION, windows: os.release(), $process_person_profile: false },
    }))
}

/** Sends finished days (called now and then by the server); forgets them once sent. */
export async function sendDue({ post = defaultPost, at = new Date() } = {}) {
  const t = target()
  const s = readState()
  if (s.choice !== 'yes' || !t.key) return { sent: 0 }
  const batch = preview(s, at)
  if (!batch.length) return { sent: 0 }
  await post(`${t.host.replace(/\/$/, '')}/batch/`, { api_key: t.key, batch })
  const fresh = readState()
  for (const e of batch) delete fresh.days[e.properties.day]
  // what went last (shown in Settings, since a sent day is no longer on this PC)
  fresh.lastSent = { at: Date.now(), days: batch.map(e => e.properties.day) }
  writeState(fresh)
  return { sent: batch.length }
}

async function defaultPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`telemetry: ${r.status}`)
}
