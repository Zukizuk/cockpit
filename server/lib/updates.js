// Updates for an installed Cockpit (one put in place by Install.cmd, with its own runtime\node.exe beside the app).
//
//   - about once a day it asks GitHub for the project's latest release (just that: the request carries nothing
//     about you or your board); Settings turns this off
//   - when there's a newer one, Settings says so and offers Update now
//   - Update now downloads the release zip, checks its SHA-256 against the one GitHub publishes, unzips it and runs
//     its installer with -Update, apart from this server (which the installer stops and starts again)
// A copy run from a clone never checks by itself (it's updated with git), only when asked (Check now).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, REPOSITORY, VERSION, writeFileAtomic } from './config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
/** The installed layout: <dir>\app\server\lib (here) and <dir>\runtime\node.exe. */
export const installDir = () => path.resolve(here, '..', '..', '..')
export const isInstalled = () => process.platform === 'win32' && fs.existsSync(path.join(installDir(), 'runtime', 'node.exe')) && fs.existsSync(path.join(installDir(), 'uninstall.ps1'))

const CHECK_EVERY = 20 * 3600_000
/** The one-off Task Scheduler task that runs an update's installer (install.ps1 -Update removes it). */
export const UPDATE_TASK = 'Cockpit update'
const stateFile = () => path.join(DATA_DIR, 'update.json')
let busy = '' // 'downloading' | 'installing' while an update runs
let lastError = ''

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}
  } catch {
    return {}
  }
}

/** -1, 0 or 1, comparing "0.1.10" and "v0.2.0" by their numbers. */
export function compareVersions(a, b) {
  const n = v => String(v).replace(/^v/i, '').split(/[.-]/).map(x => Number(x) || 0)
  const x = n(a)
  const y = n(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1
  }
  return 0
}

/** owner/repo from package.json's repository (https://github.com/owner/repo). */
const repoPath = () => /github\.com\/([^/]+\/[^/#?]+)/i.exec(REPOSITORY)?.[1]?.replace(/\.git$/, '') || ''

/** The latest release: its version, the Windows zip and its fingerprint, and the page with its notes. */
export function parseRelease(r) {
  const asset = (r.assets || []).find(a => /win-x64\.zip$/i.test(a.name))
  if (!asset) return null
  return {
    version: String(r.tag_name || '').replace(/^v/i, ''),
    page: r.html_url || '',
    zip: asset.browser_download_url,
    size: asset.size || 0,
    sha256: /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '')?.[1] || '',
  }
}

/** What Settings shows. */
export function status(cfg) {
  const s = readState()
  const latest = s.latest || null
  return {
    installed: isInstalled(),
    enabled: cfg.updates !== false,
    current: VERSION,
    latest,
    available: !!latest && compareVersions(latest.version, VERSION) > 0,
    checkedAt: s.checkedAt || 0,
    busy,
    error: lastError,
  }
}

/** Asks GitHub for the latest release (at most once in CHECK_EVERY, unless forced). */
export async function check(cfg, { force = false, get = fetch } = {}) {
  if (!repoPath() || (!force && (!isInstalled() || cfg.updates === false))) return status(cfg)
  const s = readState()
  if (!force && s.checkedAt && Date.now() - s.checkedAt < CHECK_EVERY) return status(cfg)
  try {
    const r = await get(`https://api.github.com/repos/${repoPath()}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cockpit' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
    const latest = parseRelease(await r.json())
    writeFileAtomic(stateFile(), JSON.stringify({ checkedAt: Date.now(), latest }))
    lastError = ''
  } catch (e) {
    lastError = `Couldn't check for updates (${e.message})`
  }
  return status(cfg)
}

const run = (file, args) =>
  new Promise((resolve, reject) => execFile(file, args, { windowsHide: true }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(out))))

/** Downloads, checks and unzips the latest release, then starts its installer (-Update) on its own. */
export async function apply(cfg, { log = () => {} } = {}) {
  const st = status(cfg)
  if (!st.installed) throw new Error('This copy runs from source: update it with git pull')
  if (!st.available) throw new Error('Cockpit is up to date')
  if (busy) throw new Error('An update is already running')
  const { latest } = st
  const dir = path.join(DATA_DIR, 'updates', latest.version)
  busy = 'downloading'
  lastError = ''
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const r = await fetch(latest.zip, { headers: { 'User-Agent': 'Cockpit' }, signal: AbortSignal.timeout(10 * 60_000) })
    if (!r.ok) throw new Error(`the download failed (${r.status})`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (latest.size && buf.length !== latest.size) throw new Error('the download was incomplete')
    const sum = crypto.createHash('sha256').update(buf).digest('hex')
    if (latest.sha256 && sum !== latest.sha256.toLowerCase()) throw new Error("the download doesn't match the release (checksum)")
    const zip = path.join(dir, 'cockpit.zip')
    fs.writeFileSync(zip, buf)
    busy = 'installing'
    // .NET's own unzip: Expand-Archive takes many minutes over node_modules' thousands of small files
    const ps = v => v.replace(/'/g, "''")
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${ps(zip)}', '${ps(dir)}')`])
    const installer = path.join(dir, 'Cockpit', 'install.ps1')
    if (!fs.existsSync(installer)) throw new Error("the release couldn't be unzipped (or has no installer)")
    log(`update: installing ${latest.version} (sha256 ${sum.slice(0, 12)}…)`)
    // Started by Task Scheduler, through a hidden script, not as a child of this server: the installer stops this
    // server, and a child can be taken down with it (when the server runs inside a job, as when a terminal or an
    // agent started it). The task is removed again by the installer.
    const runner = path.join(dir, 'run-update.vbs')
    const q = s => s.replace(/"/g, '""')
    fs.writeFileSync(
      runner,
      `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""${q(installer)}"" -InstallDir ""${q(installDir())}"" -Update", 0, False\r\n`,
    )
    await run('schtasks.exe', ['/Create', '/TN', UPDATE_TASK, '/TR', `wscript.exe "${runner}"`, '/SC', 'ONCE', '/ST', '00:00', '/F'])
    await run('schtasks.exe', ['/Run', '/TN', UPDATE_TASK])
    return { ok: true, version: latest.version }
  } catch (e) {
    busy = ''
    lastError = `Update failed: ${e.message}`
    throw new Error(lastError)
  }
}
