// Optional: the journal lives on Kokoro, a self-hosted journal service reached over SSH (enabled when kokoroHost is
// set), which sorts it each night at 23:30. Cockpit keeps
// a local copy in notes/journal (one file per Kokoro entry; a day page written here becomes one entry) and swaps
// changes with Kokoro now and then, never live (no background work for instant sync):
//
//   - only when something here changed, at most every 3 hours, and always once from 23:00 so the nightly sort sees the day
//   - a pull at least once a day, when the journal is opened and the last one is over 6 hours old, or on "Sync now"
//
// It goes through SSH with Cockpit's own key (~/.cockpit/kokoro/key), which the server only lets run the journal
// gate (scripts/kokoro-gate.py): list entries, save title and text. No shell, no other part of the server.
// Nothing is deleted either way. A note archived here stops syncing; an entry deleted there stays here.
// Edited in both places since the last sync: both are kept (the Kokoro one as its own file here, ours as a new entry there).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA_DIR, writeFileAtomic } from './config.js'
import { notesRoot } from './notes.js'

export const KOKORO_DIR = path.join(DATA_DIR, 'kokoro')
const STATE = () => path.join(KOKORO_DIR, 'journal.json')
const KEY = () => path.join(KOKORO_DIR, 'key')
const KNOWN = () => path.join(KOKORO_DIR, 'known_hosts')

const HOUR = 3600_000
export const PUSH_EVERY = 3 * HOUR
export const PULL_EVERY = 24 * HOUR
export const PULL_ON_OPEN = 6 * HOUR
export const EVENING = 23 // from 23:00, push what's new before a nightly 23:30 sort

const norm = s => s.replace(/\r\n/g, '\n')
const hash = s => crypto.createHash('sha1').update(norm(s)).digest('hex').slice(0, 16)

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE(), 'utf8'))
    return { files: {}, gone: [], ...s }
  } catch {
    return { files: {}, gone: [] }
  }
}

function writeState(s) {
  fs.mkdirSync(KOKORO_DIR, { recursive: true })
  writeFileAtomic(STATE(), JSON.stringify(s, null, 2) + '\n')
}

export function enabled(cfg) {
  return Boolean(cfg.kokoroHost) && fs.existsSync(KEY())
}

/** "# Heading\n\ntext" -> {title, text}; a file without a heading is all text. */
export function parseEntry(file) {
  const m = /^\s*#\s+(.+?)\s*(\n|$)/.exec(norm(file))
  return m ? { title: m[1].trim(), text: norm(file).slice(m[0].length).trim() } : { title: '', text: norm(file).trim() }
}

const dateLabel = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function entryFile(e) {
  return `# ${e.title || dateLabel(e.created)}\n\n${(e.text || '').trim()}\n`
}

function newFileFor(dir, e) {
  const day = (e.created || '').slice(0, 10) || 'undated'
  const short = String(e.id).slice(-6)
  let rel = `journal/${day}-kokoro-${short}.md`
  for (let i = 2; fs.existsSync(path.join(dir, rel)); i++) rel = `journal/${day}-kokoro-${short}-${i}.md`
  return rel
}

/** One request to the gate on Kokoro, through SSH. */
export function gate(cfg, request, { sshPath } = {}) {
  const ssh = sshPath || (process.platform === 'win32' && fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe') ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh')
  const args = ['-T', '-i', KEY(), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${KNOWN()}`, '-o', 'ConnectTimeout=20', cfg.kokoroHost]
  return new Promise((resolve, reject) => {
    const p = spawn(ssh, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [] // bytes, decoded once at the end: a character split across two chunks stays whole
    let err = ''
    const timer = setTimeout(() => p.kill(), 90_000)
    p.stdout.on('data', d => out.push(d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => {
      clearTimeout(timer)
      reject(new Error(`Could not start ssh: ${e.message}`))
    })
    p.on('close', code => {
      clearTimeout(timer)
      try {
        const got = JSON.parse(Buffer.concat(out).toString('utf8'))
        if (got.error) return reject(new Error(`Kokoro: ${got.error}`))
        resolve(got)
      } catch {
        const why = err.split('\n').map(s => s.trim()).filter(s => s && !/^Pseudo-terminal/.test(s)).pop()
        reject(new Error(why ? `Could not reach Kokoro: ${why}` : `Could not reach Kokoro (ssh exited ${code})`))
      }
    })
    p.stdin.end(Buffer.from(JSON.stringify(request), 'utf8'))
  })
}

function localFiles(cfg) {
  const dir = path.join(notesRoot(cfg), 'journal')
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.')).map(e => `journal/${e.name}`)
  } catch {
    return []
  }
}

/** Whether anything here changed since the last sync (new pages with writing in them, or edits). */
export function localChanges(cfg, state = readState()) {
  const root = notesRoot(cfg)
  let n = 0
  for (const rel of localFiles(cfg)) {
    let file
    try {
      file = fs.readFileSync(path.join(root, rel), 'utf8')
    } catch {
      continue
    }
    const m = state.files[rel]
    if (m ? hash(file) !== m.hash : parseEntry(file).text) n++
  }
  return n
}

let running = null

/** Swaps changes with Kokoro. Returns what happened: {pushed, pulled, updated, conflicts, at}. */
export function sync(cfg, deps = {}) {
  if (!running) running = doSync(cfg, deps).finally(() => (running = null))
  return running
}

async function doSync(cfg, { call = req => gate(cfg, req), now = () => Date.now() } = {}) {
  const root = notesRoot(cfg)
  fs.mkdirSync(path.join(root, 'journal'), { recursive: true })
  const state = readState()
  state.lastTry = now()
  const done = { pushed: 0, pulled: 0, updated: 0, conflicts: 0 }
  try {
    const { entries = [] } = await call({ op: 'list' })
    const remote = new Map(entries.map(e => [e.id, e]))
    const saves = []

    for (const rel of localFiles(cfg)) {
      const abs = path.join(root, rel)
      let file
      try {
        file = fs.readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      const h = hash(file)
      const m = state.files[rel]
      const { title, text } = parseEntry(file)
      if (!m) {
        if (text) saves.push({ rel, h, entry: { title, text } })
        continue
      }
      const r = remote.get(m.id)
      if (h !== m.hash) saves.push({ rel, h, entry: { id: m.id, rev: m.rev, title, text } })
      else if (r && r.rev !== m.rev) {
        const next = entryFile(r)
        writeFileAtomic(abs, next)
        state.files[rel] = { ...m, rev: r.rev, hash: hash(next) }
        done.updated++
      }
    }

    // a note archived or moved away here: stop syncing it, and don't bring it back
    for (const [rel, m] of Object.entries(state.files)) {
      if (!fs.existsSync(path.join(root, rel))) {
        state.gone.push(m.id)
        delete state.files[rel]
      }
    }

    // entries written on Kokoro (from a phone, say): a file each here
    const known = new Set([...Object.values(state.files).map(m => m.id), ...state.gone])
    for (const e of entries) {
      if (known.has(e.id)) continue
      const rel = newFileFor(root, e)
      const next = entryFile(e)
      writeFileAtomic(path.join(root, rel), next)
      state.files[rel] = { id: e.id, rev: e.rev, hash: hash(next) }
      done.pulled++
    }

    // our changes, then a second round for those that clashed with an edit made there
    let round = saves
    for (let pass = 0; pass < 2 && round.length; pass++) {
      const { results = [] } = await call({ op: 'save', entries: round.map(s => s.entry) })
      const again = []
      round.forEach((s, i) => {
        const r = results[i] || { status: 0, error: 'no answer' }
        if (r.status === 200) {
          state.files[s.rel] = { id: r.entry.id, rev: r.entry.rev, hash: s.h }
          done.pushed++
        } else if (r.status === 409 && pass === 0) {
          // keep both: theirs as its own file here, ours as a new entry there
          const rel = newFileFor(root, r.entry)
          const next = entryFile(r.entry)
          writeFileAtomic(path.join(root, rel), next)
          state.files[rel] = { id: r.entry.id, rev: r.entry.rev, hash: hash(next) }
          delete state.files[s.rel]
          again.push({ ...s, entry: { title: s.entry.title, text: s.entry.text } })
          done.conflicts++
        } else {
          throw new Error(`Kokoro refused ${s.rel}: ${r.error || r.status}`)
        }
      })
      round = again
    }

    state.lastSync = now()
    state.lastError = ''
    state.lastResult = done
    return { ...done, at: state.lastSync }
  } catch (e) {
    state.lastError = e.message
    throw e
  } finally {
    writeState(state)
  }
}

/** What the timer should do now: 'push', 'pull' or ''. Cheap: reads the journal folder, no network. */
export function due(cfg, at = new Date(), state = readState()) {
  if (!enabled(cfg)) return ''
  const last = state.lastSync || 0
  const tried = state.lastTry || 0
  if (at.getTime() - tried < 10 * 60_000 && state.lastError) return '' // failed just now: wait a little
  const changed = localChanges(cfg, state) > 0
  if (changed) {
    if (at.getTime() - last >= PUSH_EVERY) return 'push'
    const evening = new Date(at)
    evening.setHours(EVENING, 0, 0, 0)
    if (at >= evening && last < evening.getTime()) return 'push'
  }
  if (at.getTime() - last >= PULL_EVERY) return 'pull'
  return ''
}

export function status(cfg) {
  const s = readState()
  return {
    enabled: enabled(cfg),
    lastSync: s.lastSync || 0,
    lastError: s.lastError || '',
    lastResult: s.lastResult || null,
    changes: enabled(cfg) ? localChanges(cfg, s) : 0,
    syncing: Boolean(running),
  }
}
