// Cockpit's local server: the app's API and its built pages, on 127.0.0.1 only. No dependencies.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DATA_DIR, HOST, PORT, VERSION, UserError, loadConfig, publicConfig, saveConfig, within } from './lib/config.js'
import { checkApiRequest, checkHost } from './lib/security.js'
import { mimeOf, openOutside, openUrl } from './lib/files.js'
import * as shown from './lib/shown.js'
import * as notes from './lib/notes.js'
import * as journalSync from './lib/journal-sync.js'
import * as pinned from './lib/pinned.js'
import * as usage from './lib/usage.js'
import * as snippets from './lib/snippets.js'
import { listProjects, projectFile, readProject } from './lib/projects.js'
import { listSessions, readTranscript } from './lib/sessions.js'
import { readTrackers } from './lib/tracker.js'
import * as todoist from './lib/todoist.js'
import * as tasks from './lib/tasks.js'
import * as folders from './lib/folders.js'
import { readOffice } from './lib/office.js'
import * as outputs from './lib/outputs.js'
import { hasBoard, readBoard, saveBoard, welcomeBoard } from './lib/board.js'
import * as telemetry from './lib/telemetry.js'
import * as updates from './lib/updates.js'
import * as runs from './lib/runs.js'
import { changesFor } from './lib/changes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(here, '..', 'web', 'dist')
const LOG = path.join(DATA_DIR, 'server.log')
const startedAt = Date.now()

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(LOG, line)
  } catch {
    // logging must never take the server down
  }
  if (process.stdout.isTTY) process.stdout.write(line)
}

function rotateLog() {
  try {
    if (fs.statSync(LOG).size > 1024 * 1024) fs.renameSync(LOG, `${LOG}.1`)
  } catch {
    // no log yet
  }
}

const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
  "media-src 'self' blob:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'",
].join('; ')

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers })
  res.end(body)
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
}

async function readBody(req, limit = 12 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new UserError('Too large', 413)
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new UserError('Not JSON')
  }
}

/** Streams a file, with Range support so audio and video can seek. */
function sendFile(req, res, file, headers = {}) {
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return json(res, 404, { error: 'That file is no longer there' })
  }
  if (!st.isFile()) return json(res, 404, { error: 'Not a file' })
  const base = { 'Content-Type': mimeOf(file), 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString(), 'Accept-Ranges': 'bytes', ...headers }
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]))
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1
    end = Math.min(end, st.size - 1)
    if (start > end || start >= st.size) return send(res, 416, '', { ...base, 'Content-Range': `bytes */${st.size}` })
    res.writeHead(206, { ...BASE_HEADERS, ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    return fs.createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...BASE_HEADERS, ...base, 'Content-Length': st.size })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

// ---- live updates (server-sent events) -------------------------------------------------------------------

/** How to open a file outside: 'editor' means the program chosen in Settings (Notepad unless changed). */
function howToOpen(cfg, how) {
  if (how === 'editor') return cfg.editor || 'notepad'
  return ['default', 'reveal', 'vscode', 'notepad'].includes(how) ? how : 'default'
}

const clients = new Set()

function broadcast(event, data = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const c of clients) c.write(msg)
}

setInterval(() => broadcast('ping', { t: Date.now() }), 25_000).unref()

function debounce(fn, ms) {
  let timer = null
  let lastArgs = []
  return (...args) => {
    lastArgs = args
    clearTimeout(timer)
    timer = setTimeout(() => fn(...lastArgs), ms)
  }
}

const watchers = {}

function watch(name, dir, recursive, onChange) {
  try {
    watchers[name]?.close()
  } catch {
    // already closed
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    const w = fs.watch(dir, { recursive }, debounce(onChange, 250))
    w.on('error', () => {})
    watchers[name] = w
  } catch (e) {
    log(`could not watch ${dir}: ${e.message}`)
  }
}

// New entries (from a chat's show tool or the Claude app's "Cockpit" button) open by themselves in the app.
const known = new Map() // id -> when it was last shown
function noteNewEntries(announce) {
  for (const e of shown.listShown({ includeHidden: true })) {
    const at = e.shownAt || e.createdAt
    if (known.get(e.id) === at) continue
    known.set(e.id, at)
    const fresh = Date.now() - Date.parse(at) < 60_000
    if (announce && fresh && e.from !== 'you' && !e.hidden && !e.later) broadcast('opened', { id: e.id })
  }
}

/** A tracker a Claude Code chat works in (from the Outputs hook): listed from now on, unless it was taken off. */
function addTracker(file) {
  const cfg = loadConfig()
  const key = p => path.resolve(String(p)).toLowerCase()
  if (typeof file !== 'string' || !path.isAbsolute(file) || !fs.existsSync(file)) return
  if ([...cfg.trackers, ...cfg.hiddenTrackers].some(t => key(t) === key(file) || key(t) === key(path.dirname(file)))) return
  saveConfig({ trackers: [...cfg.trackers, file] })
  log(`tracker added: ${file}`)
  broadcast('trackers')
}

/** ~/.cockpit/inbox/*.json: requests written by other programs ({path} | {url} | {left, right} | {outputs} | {tracker}). */
const inboxDir = () => path.join(DATA_DIR, 'inbox')
let inboxBusy = false
async function drainInbox() {
  if (inboxBusy) return
  inboxBusy = true
  try {
    let names = []
    try {
      names = fs.readdirSync(inboxDir()).filter(n => n.endsWith('.json'))
    } catch {
      return
    }
    for (const n of names) {
      const file = path.join(inboxDir(), n)
      let req
      try {
        req = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        continue // still being written
      }
      try {
        fs.rmSync(file, { force: true })
        const from = typeof req.from === 'string' ? req.from : 'Claude'
        if (req.tracker) addTracker(req.tracker)
        else if (req.outputs) outputs.addOutputs(req.outputs)
        else if (req.url) await shown.addLink({ url: req.url, from })
        else if (req.left && req.right) shown.addCompare({ left: req.left, right: req.right, from })
        else if (req.path) shown.addShown({ path: req.path, from })
      } catch (e) {
        log(`inbox ${n}: ${e.message}`)
        broadcast('notice', { text: e.message })
      }
    }
  } finally {
    inboxBusy = false
  }
}

function startWatchers(cfg) {
  noteNewEntries(false)
  watch('shown', shown.shownDir(), false, () => {
    noteNewEntries(true)
    broadcast('shown')
  })
  watch('inbox', inboxDir(), false, () => drainInbox())
  watch('outputs', outputs.outputsDir(), false, () => broadcast('outputs'))
  drainInbox()
  watch('notes', notes.notesRoot(cfg), true, (_evt, name) => broadcast('notes', { path: name ? String(name).split(path.sep).join('/') : '' }))
  // snippets: one left by Claude (the MCP tool) is announced, so its card comes up
  fs.mkdirSync(snippets.snippetsDir(), { recursive: true })
  let known = new Set(snippets.listSnippets().map(s => s.id))
  watch('snippets', snippets.snippetsDir(), false, () => {
    const now = snippets.listSnippets()
    const added = now.filter(s => !known.has(s.id) && s.from && s.from !== 'you').map(s => ({ id: s.id, title: s.title, from: s.from }))
    known = new Set(now.map(s => s.id))
    broadcast('snippets', { added })
  })
}

// ---- journal sync with Kokoro: a 10-minute look at the journal folder; the network only when one is due ----

async function syncJournal(cfg, why) {
  broadcast('journal', { ...journalSync.status(cfg), syncing: true })
  try {
    const r = await journalSync.sync(cfg)
    log(`journal sync (${why}): ${JSON.stringify(r)}`)
    return r
  } catch (e) {
    log(`journal sync (${why}) failed: ${e.message}`)
    throw e
  } finally {
    broadcast('journal', journalSync.status(cfg))
  }
}

function startJournalSync() {
  const tick = () => {
    const cfg = loadConfig()
    const why = journalSync.due(cfg)
    if (why) syncJournal(cfg, why).catch(() => {})
  }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, 10 * 60_000).unref()
}

/** Counts one use of a feature (only with a yes; never fails the request). */
const counted = name => {
  try {
    telemetry.count(name)
  } catch {}
}

/** Anonymous usage counts (only with a yes, see telemetry.js): finished days go out about once an hour. */
/** An installed copy looks for a newer release about once a day (updates.js keeps it to that). */
function startUpdateChecks() {
  const tick = () => updates.check(loadConfig()).catch(() => {})
  setTimeout(tick, 90_000).unref()
  setInterval(tick, 60 * 60_000).unref()
}

function startTelemetry() {
  const tick = () => telemetry.sendDue().then(r => r.sent && log(`telemetry: sent ${r.sent} day(s)`), e => log(String(e.message || e)))
  setTimeout(tick, 2 * 60_000).unref()
  setInterval(tick, 60 * 60_000).unref()
}

// ---- API ---------------------------------------------------------------------------------------------------

/** Counts a card or note read full screen in Cockpit, for Quick access's "Often opened". Never fails the request. */
function countCockpitOpen(cfg, body) {
  try {
    if (body.note) {
      notes.resolveNote(cfg, body.note)
      return usage.recordOpen({ kind: 'note', target: String(body.note).replace(/\\/g, '/'), title: body.title, where: 'cockpit' })
    }
    if (body.id && shown.validId(body.id)) {
      const e = shown.getShown(body.id)
      if (e.kind === 'link' && e.url) usage.recordOpen({ kind: 'link', target: e.url, title: e.title, where: 'cockpit', shownId: e.id })
      else if (e.kind === 'file' && e.path) usage.recordOpen({ kind: 'file', target: e.path, title: e.title, where: 'cockpit', shownId: e.id })
    }
  } catch {
    // gone meanwhile: nothing to count
  }
}

/** Counts an open outside Cockpit (its own program, Explorer, the browser). */
function countOutsideOpen(cfg, body, target) {
  try {
    if (body.kind === 'shown') {
      const e = shown.getShown(body.id)
      usage.recordOpen({ kind: 'file', target, title: e.title, where: 'outside', shownId: e.id })
    } else if (body.kind === 'note') usage.recordOpen({ kind: 'note', target: String(body.path).replace(/\\/g, '/'), where: 'outside' })
    else if (body.kind === 'output') usage.recordOpen({ kind: 'file', target, where: 'outside' })
    else if (body.kind === 'path' && !folders.isFolder(target)) usage.recordOpen({ kind: 'file', target, where: 'outside' })
  } catch {
    // nothing to count
  }
}

function resolveOpenTarget(cfg, body) {
  if (body.kind === 'shown') {
    const e = shown.getShown(body.id)
    if (!e.path) throw new UserError('This item has no file')
    return body.side === 'right' && e.path2 ? e.path2 : e.path
  }
  if (body.kind === 'note') return notes.resolveNote(cfg, body.path)
  if (body.kind === 'notes-folder') return notes.ensureNotes(cfg)
  if (body.kind === 'project') return projectFile(cfg, body.id)
  // a file or folder on a folder card: any full path that is there
  if (body.kind === 'path') {
    const p = String(body.path || '')
    if (!path.isAbsolute(p) || !fs.existsSync(p)) throw new UserError('That is no longer there', 404)
    return path.resolve(p)
  }
  throw new UserError('Nothing to open')
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1) // after "api"
  const [area, a, b, ...rest] = parts
  const method = req.method || 'GET'
  const looseRead = area === 'shown' && b === 'files' && (method === 'GET' || method === 'HEAD')
  const refused = checkApiRequest(req, PORT, { looseRead })
  if (refused) return json(res, 403, { error: `Refused (${refused})` })
  const cfg = loadConfig()

  if (area === 'health') return json(res, 200, { ok: true, app: 'cockpit', version: VERSION, pid: process.pid, startedAt })

  if (area === 'events' && method === 'GET') {
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.write('retry: 3000\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (area === 'update') {
    if (!a && method === 'GET') return json(res, 200, updates.status(cfg))
    if (a === 'check' && method === 'POST') return json(res, 200, await updates.check(cfg, { force: true }))
    if (a === 'apply' && method === 'POST') return json(res, 200, await updates.apply(cfg, { log }))
  }

  if (area === 'telemetry') {
    if (!a && method === 'GET') return json(res, 200, telemetry.status())
    if (!a && method === 'POST') return json(res, 200, telemetry.choose((await readBody(req)).choice))
    if (a === 'count' && method === 'POST') {
      telemetry.count((await readBody(req)).event)
      return json(res, 200, { ok: true })
    }
  }

  if (area === 'config') {
    if (method === 'GET') return json(res, 200, { ...publicConfig(cfg), mcpScript: path.join(here, 'mcp.js') })
    if (method === 'POST') {
      const body = await readBody(req)
      const next = saveConfig(body)
      if (body.notesDir) startWatchers(next)
      if (typeof body.todoistToken === 'string') todoist.forgetCache()
      return json(res, 200, { ...publicConfig(next), mcpScript: path.join(here, 'mcp.js') })
    }
  }

  if (area === 'shown') {
    if (!a && method === 'GET') return json(res, 200, shown.listShown({ includeHidden: url.searchParams.get('all') === '1' }))
    if (!a && method === 'POST') {
      const body = await readBody(req)
      if (body.url) return json(res, 200, await shown.addLink({ url: body.url, title: body.title, tags: body.tags, from: 'you' }))
      if (body.left || body.right) return json(res, 200, shown.addCompare({ left: body.left, right: body.right, from: 'you' }))
      // a folder becomes a folder card (its files, as a tree), not an entry
      if (body.path && folders.isFolder(body.path)) return json(res, 200, { folder: folders.folderPath(body.path) })
      return json(res, 200, shown.addShown({ path: body.path, content: body.content, format: body.format, title: body.title, tags: body.tags, from: 'you' }))
    }
    if (a === 'meta' && method === 'GET') {
      // one call for every card on the board: { id: mtime }
      const ids = String(url.searchParams.get('ids') || '').split(',').filter(shown.validId).slice(0, 300)
      const out = {}
      for (const id of ids) {
        try {
          out[id] = shown.entryState(shown.getShown(id)).mtime
        } catch {
          out[id] = -1
        }
      }
      return json(res, 200, out)
    }
    if (a && !b && method === 'GET') {
      const r = shown.readShown(a)
      if (r.exists && ['docx', 'sheet', 'slides'].includes(r.entry.format)) Object.assign(r, await readOffice(r.entry, { sheet: url.searchParams.get('sheet') }))
      return json(res, 200, r)
    }
    if (a && !b && method === 'POST') return json(res, 200, shown.updateShown(a, await readBody(req)))
    if (a && b === 'refresh' && method === 'POST') return json(res, 200, await shown.refreshLink(a))
    if (a && b === 'meta' && method === 'GET') return json(res, 200, shown.entryState(shown.getShown(a)))
    if (a && b === 'files') {
      const entry = shown.getShown(a)
      const file = shown.resolveShownFile(entry, rest.join('/'))
      // Files open in a sandbox (an opaque origin): HTML may run its scripts but cannot reach Cockpit; other
      // files run nothing even when opened on their own. PDF is left alone, as Chrome won't render it sandboxed.
      const ext = path.extname(file).toLowerCase()
      const sandbox = ext === '.pdf' ? {} : { 'Content-Security-Policy': ext === '.html' || ext === '.htm' ? 'sandbox allow-scripts allow-popups allow-forms allow-modals' : 'sandbox' }
      return sendFile(req, res, file, { ...sandbox, 'Cross-Origin-Resource-Policy': 'cross-origin' })
    }
  }

  // Later: a link (read in the background) or a short note, kept to check when there's time
  if (area === 'later' && !a && method === 'POST') {
    const body = await readBody(req)
    counted(body.url ? 'later.link' : body.path ? 'item.file' : 'later.note')
    return json(res, 200, shown.saveForLater({ url: body.url, path: body.path, text: body.text, title: body.title }))
  }

  // Quick access: what the user pinned (one click opens it; the most used first), and what they keep opening
  // ("Often opened", counted by usage.js), so a card they visit all the time shows up there by itself.
  if (area === 'pinned') {
    if (!a && method === 'GET') {
      const list = pinned.listPinned()
      const keys = new Set(list.items.map(p => usage.keyOf(p.kind === 'folder' ? 'file' : p.kind, p.target)))
      return json(res, 200, { ...list, often: usage.oftenOpened(keys) })
    }
    const done = r => (broadcast('pinned'), json(res, 200, r))
    if (!a && method === 'POST') {
      const body = await readBody(req)
      if (body.note) notes.resolveNote(cfg, body.note)
      counted('quick.pin')
      return done(pinned.addPin(body))
    }
    if (a && b === 'open' && method === 'POST') {
      const r = pinned.openPin(a, (await readBody(req)).how)
      counted('quick.open')
      usage.recordOpen({ kind: r.kind, target: r.target, title: r.title, where: r.kind === 'note' ? 'cockpit' : 'outside' })
      return done(r)
    }
    if (a && !b && method === 'POST') return done(pinned.updatePin(a, await readBody(req)))
    if (a && b === 'remove' && method === 'POST') return done(pinned.removePin(a))
  }

  // Snippets: short things to copy; a secret's text only ever leaves through /text, on request
  if (area === 'snippets') {
    if (!a && method === 'GET') return json(res, 200, snippets.listSnippets())
    if (!a && method === 'POST') {
      const body = await readBody(req)
      counted('snippet.add')
      return json(res, 200, await snippets.addSnippet({ text: body.text, title: body.title, secret: body.secret, language: body.language, keep: body.keep, from: 'you' }))
    }
    if (a && b === 'text' && method === 'GET') return json(res, 200, { text: await snippets.snippetText(a) })
    if (a && !b && method === 'POST') return json(res, 200, await snippets.updateSnippet(a, await readBody(req)))
    if (a && b === 'remove' && method === 'POST') return json(res, 200, snippets.removeSnippet(a))
    if (a && b === 'copy' && method === 'POST') {
      counted('snippet.copy')
      return json(res, 200, await snippets.copySnippet(a))
    }
  }

  if (area === 'usage' && method === 'POST') {
    const body = await readBody(req)
    // read in Cockpit (a card or note full screen): counted only
    if (!a) {
      countCockpitOpen(cfg, body)
      broadcast('pinned')
      return json(res, 200, { ok: true })
    }
    const t = usage.thing(String(body.key || ''))
    if (a === 'hide') {
      usage.hide(body.key)
      broadcast('pinned')
      return json(res, 200, { ok: true })
    }
    if (a === 'pin') {
      const p = pinned.addPin(t.kind === 'link' ? { url: t.target, title: t.title } : t.kind === 'note' ? { note: t.target, title: t.title } : { path: t.target, title: t.title })
      broadcast('pinned')
      return json(res, 200, p)
    }
    if (a === 'open') {
      counted('quick.open')
      // the way the user usually opens it: read in Cockpit, or in its own program / Explorer / the browser
      // how=outside: its own program / Explorer / the browser, whatever the user usually does
      const outside = body.how === 'outside' && t.kind !== 'note'
      if (t.kind === 'note') return json(res, 200, { expand: { type: 'note', ref: t.target } })
      if (!outside && (t.inCockpit || 0) > (t.outside || 0) && t.shownId && shown.validId(t.shownId)) {
        try {
          shown.getShown(t.shownId)
          return json(res, 200, { expand: { type: 'item', ref: t.shownId } })
        } catch {
          // the kept item is gone: open it outside instead
        }
      }
      if (t.kind === 'link') openUrl(t.target)
      else openOutside(t.target, 'default')
      usage.recordOpen({ kind: t.kind, target: t.target, title: t.title, where: 'outside' })
      broadcast('pinned')
      return json(res, 200, { opened: true })
    }
  }

  if (area === 'outputs') {
    if (!a && method === 'GET') return json(res, 200, outputs.listOutputs())
    if (a === 'clear' && method === 'POST') return json(res, 200, outputs.clearOutputs())
    if (a && !b && method === 'POST') return json(res, 200, outputs.updateOutputs(a, await readBody(req)))
  }

  if (area === 'changes' && method === 'GET') return json(res, 200, await changesFor(url.searchParams.get('group'), url.searchParams.get('item')))

  // A web link opened the way every other link on this PC opens: through Windows, so the default browser (or a
  // browser picker set as the default) decides where it goes.
  if (area === 'open-url' && method === 'POST') {
    const body = await readBody(req)
    let u
    try {
      u = new URL(String(body.url || ''))
    } catch {
      throw new UserError('Not a link')
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UserError('Only web links open this way')
    openUrl(u.href)
    try {
      const kept = shown.listShown().find(e => e.url === u.href || e.savedUrl === u.href)
      usage.recordOpen({ kind: 'link', target: u.href, title: kept?.title, where: 'outside', shownId: kept?.id })
    } catch {
      // counting is best effort
    }
    return json(res, 200, { ok: true })
  }

  if (area === 'run') {
    if (!a && method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, runs.startRun({ groupId: body.group, index: body.index, shell: body.shell, cwd: body.cwd }))
    }
    if (a === 'info' && method === 'GET') {
      const { command, cwd } = runs.commandFor(url.searchParams.get('group'), url.searchParams.get('index'))
      return json(res, 200, { command, cwd, shell: runs.guessShell(command), shells: runs.shells() })
    }
    if (a === 'terminal' && method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, runs.openInTerminal({ groupId: body.group, index: body.index, shell: body.shell, cwd: body.cwd }))
    }
    if (a && !b && method === 'GET') return json(res, 200, runs.getRun(a, url.searchParams.get('from')))
    if (a && b === 'stop' && method === 'POST') return json(res, 200, runs.stopRun(a))
  }

  if (area === 'board') {
    if (method === 'GET') {
      telemetry.count('app.open')
      return json(res, 200, hasBoard() ? readBoard() : welcomeBoard(cfg))
    }
    if (method === 'PUT') return json(res, 200, saveBoard(await readBody(req)))
  }

  if (area === 'open' && method === 'POST') {
    const body = await readBody(req)
    if (body.kind === 'output') {
      const item = outputs.outputTarget(body.id, body.index)
      if (item.kind === 'link') throw new UserError('Links open in the browser')
      openOutside(item.target, howToOpen(cfg, body.how))
      if (!body.how || body.how === 'default') countOutsideOpen(cfg, body, item.target)
      return json(res, 200, { ok: true })
    }
    const how = howToOpen(cfg, body.how)
    const target = resolveOpenTarget(cfg, body)
    openOutside(target, body.kind === 'notes-folder' ? 'default' : how)
    if (how === 'default') countOutsideOpen(cfg, body, target)
    return json(res, 200, { ok: true })
  }

  if (area === 'notes') {
    if (!a && method === 'GET') {
      notes.ensureNotes(cfg)
      return json(res, 200, { root: notes.notesRoot(cfg), notes: notes.listNotes(cfg), today: notes.journalPath() })
    }
    if (a === 'file' && method === 'GET') return json(res, 200, notes.readNote(cfg, url.searchParams.get('p')))
    if (a === 'file' && method === 'PUT') {
      const body = await readBody(req)
      return json(res, 200, notes.writeNote(cfg, body.path, body.text, body.baseMtime))
    }
    if (a === 'new' && method === 'POST') {
      const body = await readBody(req)
      const kind = ['journal', 'draft', 'note', 'sticky'].includes(body.kind) ? body.kind : 'note'
      if (kind === 'sticky') counted('sticky.new')
      if (kind === 'journal') counted('journal.open')
      return json(res, 200, { path: notes.newNote(cfg, kind, body.title, new Date(), typeof body.text === 'string' ? body.text : '') })
    }
    // a thought goes into today's journal, which a nightly job can sort (thoughts and the journal are one)
    if (a === 'thought' && method === 'POST') return json(res, 200, notes.appendJournal(cfg, (await readBody(req)).text))
    if (a === 'append' && method === 'POST') return json(res, 200, notes.appendJournal(cfg, (await readBody(req)).text))
    if (a === 'archive' && method === 'POST') return json(res, 200, notes.archiveNote(cfg, (await readBody(req)).path))
    if (a === 'title' && method === 'POST') {
      const body = await readBody(req)
      const r = notes.setTitle(cfg, body.path, body.title)
      if (r.title) counted('note.title')
      broadcast('notes', { path: body.path })
      return json(res, 200, r)
    }
    if (a === 'discard' && method === 'POST') return json(res, 200, notes.discardEmpty(cfg, (await readBody(req)).path))
    if (a === 'asset' && method === 'GET') {
      return sendFile(req, res, notes.resolveNote(cfg, url.searchParams.get('p'), { anyExt: true }), { 'Content-Security-Policy': 'sandbox' })
    }
  }

  if (area === 'journal') {
    if (a === 'status' && method === 'GET') return json(res, 200, journalSync.status(cfg))
    if (a === 'sync' && method === 'POST') {
      const body = await readBody(req)
      if (!journalSync.enabled(cfg)) throw new UserError('The journal sync with Kokoro is not set up')
      // "when I open the journal": only if the last sync is a while ago
      const st = journalSync.status(cfg)
      if (body.ifOlder && Date.now() - st.lastSync < journalSync.PULL_ON_OPEN) return json(res, 200, { ...st, skipped: true })
      const r = await syncJournal(cfg, body.ifOlder ? 'opened' : 'asked')
      return json(res, 200, { ...journalSync.status(cfg), result: r })
    }
  }

  if (area === 'projects' && method === 'GET') return json(res, 200, a ? readProject(cfg, a) : listProjects(cfg))
  if (area === 'sessions' && method === 'GET') return json(res, 200, a ? readTranscript(cfg, a) : listSessions(cfg))
  if (area === 'trackers' && method === 'GET') return json(res, 200, readTrackers(cfg))
  // taken off the list: no longer read, and not added back by a chat or the scan
  if (area === 'trackers' && a === 'remove' && method === 'POST') {
    const file = String((await readBody(req)).file || '')
    if (!file) throw new UserError('Which tracker?')
    const key = p => path.resolve(String(p)).toLowerCase()
    saveConfig({ trackers: cfg.trackers.filter(t => key(t) !== key(file) && key(t) !== key(path.dirname(file))), hiddenTrackers: [...cfg.hiddenTrackers.filter(t => key(t) !== key(file)), file] })
    broadcast('trackers')
    return json(res, 200, readTrackers(loadConfig()))
  }

  if (area === 'todoist') {
    if (!a && method === 'GET') {
      try {
        return json(res, 200, await todoist.todayTasks(cfg.todoistToken, { force: url.searchParams.get('force') === '1' }))
      } catch (e) {
        return json(res, 200, { configured: Boolean(cfg.todoistToken), tasks: [], error: e instanceof UserError ? e.message : 'Could not reach Todoist' })
      }
    }
    if (a === 'close' && method === 'POST') {
      await todoist.closeTask(cfg.todoistToken, (await readBody(req)).id)
      return json(res, 200, { ok: true })
    }
    if (a === 'add' && method === 'POST') return json(res, 200, { ok: true, task: await todoist.quickAdd(cfg.todoistToken, (await readBody(req)).text) })
    if (a === 'rename' && method === 'POST') {
      const body = await readBody(req)
      await todoist.renameTask(cfg.todoistToken, body.id, body.content)
      return json(res, 200, { ok: true })
    }
    if (a === 'delete' && method === 'POST') {
      await todoist.deleteTask(cfg.todoistToken, (await readBody(req)).id)
      return json(res, 200, { ok: true })
    }
  }

  // the Today card's own list, when Todoist isn't connected
  if (area === 'tasks') {
    if (!a && method === 'GET') return json(res, 200, tasks.listTasks())
    if (!a && method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, tasks.addTask(body.content, body.id))
    }
    if (a && !b && method === 'POST') return json(res, 200, tasks.updateTask(a, await readBody(req)))
    if (a && b === 'remove' && method === 'POST') return json(res, 200, tasks.removeTask(a))
  }

  if (area === 'folder' && method === 'GET') return json(res, 200, folders.listFolder(url.searchParams.get('path')))

  return json(res, 404, { error: 'No such API' })
}

// ---- pages -------------------------------------------------------------------------------------------------

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Cockpit</title><body style="font:16px system-ui;padding:40px">
<h1>Cockpit isn't built yet</h1><p>Run <code>npm run build</code> in the cockpit folder, then reload.</p></body>`

function serveStatic(req, res, url) {
  if (!checkHost(req, PORT)) return send(res, 421, 'Misdirected request', { 'Content-Type': 'text/plain' })
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '')
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return send(res, 503, NOT_BUILT, { 'Content-Type': 'text/html; charset=utf-8' })
  let p = '/'
  try {
    p = decodeURIComponent(url.pathname)
  } catch {
    return send(res, 400, '')
  }
  // /share is where Windows' Share sends a page (the app's share target). Only a share or a typed address may
  // land there with something to save; a link from another website goes to the plain board instead.
  if (p === '/share' && url.search) {
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'none' && site !== 'same-origin') return send(res, 303, '', { Location: '/' })
  }
  let file = path.resolve(DIST, `.${p === '/' ? '/index.html' : p}`)
  const exists = within(DIST, file) && fs.existsSync(file) && fs.statSync(file).isFile()
  if (!exists) {
    if (path.extname(p)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' })
    file = path.join(DIST, 'index.html')
  }
  const name = path.basename(file)
  const headers = {
    'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(name.endsWith('.html') ? { 'Content-Security-Policy': APP_CSP } : {}),
    ...(name === 'manifest.webmanifest' ? { 'Content-Type': 'application/manifest+json' } : {}),
  }
  sendFile(req, res, file, headers)
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await api(req, res, url)
    return serveStatic(req, res, url)
  } catch (err) {
    const status = err?.status || 500
    if (status >= 500) log(`error ${req.method} ${url.pathname}: ${err?.stack || err}`)
    if (!res.headersSent) json(res, status, { error: err instanceof UserError || status < 500 ? err.message : 'Something went wrong (see server.log in ~/.cockpit)' })
    else res.end()
  }
}

function isCockpitRunning() {
  return new Promise(resolve => {
    const req = http.get({ host: HOST, port: PORT, path: '/api/health', timeout: 1000, headers: { host: `${HOST}:${PORT}` } }, r => {
      let body = ''
      r.on('data', c => (body += c))
      r.on('end', () => resolve(body.includes('"app":"cockpit"')))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

export function start() {
  rotateLog()
  const cfg = loadConfig()
  notes.ensureNotes(cfg)
  startWatchers(cfg)
  startJournalSync()
  startTelemetry()
  startUpdateChecks()
  // secrets: unlock their key in the background now, so the first copy is instant; drop expired ones hourly
  snippets.warmKey().catch(e => log(`snippets: ${e.message}`))
  setInterval(() => {
    if (snippets.sweep()) broadcast('snippets', { added: [] })
  }, 3600_000).unref()
  const server = http.createServer((req, res) => {
    handle(req, res)
  })
  server.on('error', async err => {
    if (err.code === 'EADDRINUSE') {
      const ours = await isCockpitRunning()
      log(ours ? 'Cockpit is already running; this copy exits.' : `Port ${PORT} is taken by another program.`)
      process.exit(ours ? 0 : 1)
    }
    log(`server error: ${err.stack || err}`)
    process.exit(1)
  })
  server.listen(PORT, HOST, () => log(`Cockpit ${VERSION} on http://${HOST}:${PORT} (pid ${process.pid})`))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start()
