// Snippets: short things to copy, kept for as long as they're needed (a command, a bit of code, a connection string,
// a token for the next few days). Copy in one click; a secret stays hidden until you ask to see it, and goes the
// moment you delete it (or when its time is up: a week unless you say otherwise). Claude can leave one here too
// (the MCP tool `snippet`), instead of pasting it into the chat.
//
// One file per snippet in ~/.cockpit/snippets, so the app and the MCP server never write over each other.
// A secret's text is encrypted (AES-256-GCM). Its key sits in ~/.cockpit/snippets.key, itself locked with Windows'
// per-user protection (DPAPI): the folder copied elsewhere, or read by another account, gives nothing away. Anything
// running as you can still unlock it; this is a place to copy from, not a password manager.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'

export const snippetsDir = () => path.join(DATA_DIR, 'snippets')
const KEY_FILE = () => path.join(DATA_DIR, 'snippets.key')
const MAX_TEXT = 100_000
const DAY = 86_400_000
export const KEEP = { day: DAY, week: 7 * DAY, month: 30 * DAY, forever: 0 }

// ---- the key --------------------------------------------------------------------------------------------------

const PS = op =>
  `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ` +
  `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}($b, $null, 'CurrentUser'))`
const psArgs = op => ['-NoProfile', '-NonInteractive', '-Command', PS(op)]
const win = process.platform === 'win32'

let keyCache = null
let keyLoading = null

function dpapiSync(op, b64) {
  const r = spawnSync('powershell.exe', psArgs(op), { input: b64, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const out = (r.stdout || '').trim()
  if (r.status !== 0 || !out) throw new Error(`Windows could not ${op.toLowerCase()} the snippets key: ${(r.stderr || '').trim().split('\n')[0]}`)
  return out
}

function dpapiAsync(op, b64) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', psArgs(op), { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', reject)
    p.on('close', code => (code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(`Windows could not unlock the snippets key: ${err.trim().split('\n')[0]}`))))
    p.stdin.end(b64)
  })
}

/** Makes the key the first time it's needed. Sync: used when a secret is saved (the MCP tool, a save in the app). */
function keySync() {
  if (keyCache) return keyCache
  const file = KEY_FILE()
  if (fs.existsSync(file)) {
    const stored = fs.readFileSync(file, 'utf8').trim()
    keyCache = Buffer.from(win ? dpapiSync('Unprotect', stored) : stored, 'base64')
    return keyCache
  }
  const raw = crypto.randomBytes(32).toString('base64')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  writeFileAtomic(file, (win ? dpapiSync('Protect', raw) : raw) + '\n')
  if (!win) fs.chmodSync(file, 0o600)
  keyCache = Buffer.from(raw, 'base64')
  return keyCache
}

/** Unlocks the key without holding the server up (Windows takes a few seconds the first time). */
export function warmKey() {
  if (keyCache || keyLoading || !fs.existsSync(KEY_FILE())) return keyLoading || Promise.resolve()
  const stored = fs.readFileSync(KEY_FILE(), 'utf8').trim()
  keyLoading = (win ? dpapiAsync('Unprotect', stored) : Promise.resolve(stored))
    .then(b64 => {
      keyCache = Buffer.from(b64, 'base64')
    })
    .finally(() => (keyLoading = null))
  return keyLoading
}

async function key() {
  if (keyCache) return keyCache
  if (fs.existsSync(KEY_FILE())) await warmKey()
  return keyCache || keySync()
}

function seal(k, text) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }
}

function open(k, enc) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(enc.iv, 'base64'))
  d.setAuthTag(Buffer.from(enc.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8')
}

// ---- snippets -------------------------------------------------------------------------------------------------

const fileOf = id => path.join(snippetsDir(), `${id}.json`)
const validId = id => typeof id === 'string' && /^s[0-9a-z]{6,24}$/.test(id)
const newId = () => `s${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

function readOne(id) {
  if (!validId(id)) throw new UserError('No such snippet', 404)
  try {
    return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'))
  } catch {
    throw new UserError('That snippet is gone', 404)
  }
}

/** Looks like a key, token or password: one long run of letters, digits and symbols with no spaces. */
export function looksSecret(text) {
  const t = String(text || '').trim()
  if (/^(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abp]|AKIA|eyJ)[A-Za-z0-9_\-.]{8,}/.test(t)) return true
  if (/\b(password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]/i.test(t)) return true
  if (/\s/.test(t) || t.length < 12 || t.length > 400) return false
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(t)).length
  if (t.length >= 20) return kinds >= 3
  // 12 to 19 characters (a generated password): both cases and a digit or symbol, mixed all through as random text
  // is, not words with a number on the end (HelloWorld2024) or a date (2026-11-24T10:00)
  const cls = c => (/[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 1 : /[0-9]/.test(c) ? 2 : 3)
  let switches = 0
  for (let i = 1; i < t.length; i++) if (cls(t[i]) !== cls(t[i - 1])) switches++
  return kinds >= 3 && /[a-z]/.test(t) && /[A-Z]/.test(t) && /[A-Za-z][^A-Za-z]+[A-Za-z]/.test(t) && switches >= (t.length - 1) / 2
}

const firstLine = t => String(t).trim().split('\n')[0].trim()

function checkInput({ text, secret } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new UserError('Nothing to keep')
  if (text.length > MAX_TEXT) throw new UserError('That is over 100,000 characters; show it as a file instead')
  return secret === undefined || secret === null ? looksSecret(text) : Boolean(secret)
}

/** Keeps a snippet. secret: hidden and encrypted (guessed when not given); keep: day | week | month | forever (secrets default to a week). */
export async function addSnippet(input = {}, now = Date.now()) {
  const isSecret = checkInput(input)
  return make(input, isSecret, isSecret ? await key() : null, now)
}

/** The same in one go, for the MCP server: makes or unlocks the key in line (a few seconds the first time). */
export function addSnippetSync(input = {}, now = Date.now()) {
  const isSecret = checkInput(input)
  return make(input, isSecret, isSecret ? keySync() : null, now)
}

function make({ text, title, language, keep, from }, isSecret, k, now) {
  const span = KEEP[keep] ?? (isSecret ? KEEP.week : KEEP.forever)
  const s = {
    id: newId(),
    title: String(title || '').trim().slice(0, 120) || (isSecret ? 'Secret' : firstLine(text).slice(0, 80)),
    secret: isSecret,
    language: typeof language === 'string' ? language.trim().slice(0, 30) : '',
    length: text.length,
    lines: text.split('\n').length,
    createdAt: now,
    expiresAt: span ? now + span : null,
    from: typeof from === 'string' ? from.slice(0, 120) : '',
  }
  if (isSecret) s.enc = seal(k, text)
  else s.text = text
  fs.mkdirSync(snippetsDir(), { recursive: true })
  writeFileAtomic(fileOf(s.id), JSON.stringify(s))
  return view(s)
}

/** As the list shows it: never a secret's text. */
function view(s) {
  return {
    id: s.id,
    title: s.title,
    secret: s.secret,
    language: s.language,
    length: s.length,
    lines: s.lines,
    preview: s.secret ? '' : String(s.text).slice(0, 400),
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    from: s.from,
  }
}

/** Deletes those whose time is up. */
export function sweep(now = Date.now()) {
  let gone = 0
  let names = []
  try {
    names = fs.readdirSync(snippetsDir()).filter(n => n.endsWith('.json'))
  } catch {
    return 0
  }
  for (const n of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(snippetsDir(), n), 'utf8'))
      if (s.expiresAt && s.expiresAt <= now) {
        fs.rmSync(path.join(snippetsDir(), n), { force: true })
        gone++
      }
    } catch {
      // half-written: next time
    }
  }
  return gone
}

export function listSnippets(now = Date.now()) {
  sweep(now)
  const out = []
  let names = []
  try {
    names = fs.readdirSync(snippetsDir()).filter(n => n.endsWith('.json'))
  } catch {
    return out
  }
  for (const n of names) {
    try {
      out.push(view(JSON.parse(fs.readFileSync(path.join(snippetsDir(), n), 'utf8'))))
    } catch {
      // half-written
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** The text itself, to copy or to see. */
export async function snippetText(id) {
  const s = readOne(id)
  if (s.expiresAt && s.expiresAt <= Date.now()) {
    fs.rmSync(fileOf(id), { force: true })
    throw new UserError('That snippet is gone', 404)
  }
  if (!s.secret) return s.text
  try {
    return open(await key(), s.enc)
  } catch {
    throw new UserError("That secret can't be unlocked on this account", 500)
  }
}

/**
 * Puts a snippet on the Windows clipboard from here, so copying works in any window (a browser may refuse the page
 * clipboard access) and a secret's text never has to reach the page just to be copied.
 */
export async function copySnippet(id, { setClipboard = toClipboard } = {}) {
  await setClipboard(await snippetText(id))
  return { copied: id }
}

export function toClipboard(text) {
  return new Promise((resolve, reject) => {
    const cmd = win ? 'clip.exe' : process.platform === 'darwin' ? 'pbcopy' : 'xclip'
    const p = spawn(cmd, win || process.platform === 'darwin' ? [] : ['-selection', 'clipboard'], { windowsHide: true })
    p.on('error', e => reject(new Error(`Could not reach the clipboard: ${e.message}`)))
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`Could not reach the clipboard (${cmd} exited ${code})`))))
    // clip.exe takes UTF-16 with its byte-order mark as Unicode, exactly as given (no newline added)
    p.stdin.end(win ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : Buffer.from(text, 'utf8'))
  })
}

/** Renames it, changes how long it's kept, or makes it secret (encrypted, hidden) or plain again. */
export async function updateSnippet(id, { title, keep, secret } = {}, now = Date.now()) {
  const s = readOne(id)
  if (typeof title === 'string' && title.trim()) s.title = title.trim().slice(0, 120)
  if (keep !== undefined) {
    if (!(keep in KEEP)) throw new UserError('Keep it for a day, a week, a month, or until you delete it')
    s.expiresAt = KEEP[keep] ? now + KEEP[keep] : null
  }
  if (typeof secret === 'boolean' && secret !== s.secret) {
    const k = await key()
    if (secret) {
      s.enc = seal(k, s.text)
      delete s.text
    } else {
      s.text = open(k, s.enc)
      delete s.enc
    }
    s.secret = secret
  }
  writeFileAtomic(fileOf(id), JSON.stringify(s))
  return view(s)
}

/** Gone at once: the file is overwritten, then deleted. */
export function removeSnippet(id) {
  const s = readOne(id)
  const file = fileOf(id)
  try {
    fs.writeFileSync(file, '0'.repeat(Math.max(64, JSON.stringify(s).length)))
  } catch {
    // deleting is what matters
  }
  fs.rmSync(file, { force: true })
  return { removed: id }
}
