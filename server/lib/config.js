// Where everything lives, and the settings file (~/.cockpit/config.json). Environment variables override the
// locations so tests can point the whole app at a temporary folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HOST = '127.0.0.1'
export const PORT = Number(process.env.COCKPIT_PORT) || 4790
export const HOME = process.env.COCKPIT_HOME || os.homedir()
export const DATA_DIR = process.env.COCKPIT_DATA || path.join(HOME, '.cockpit')
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
/** What changed in Cockpit, newest first (read in the app from Settings or the + box). */
export const CHANGELOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'CHANGELOG.md')
const PKG = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'))
  } catch {
    return {}
  }
})()
/** Cockpit's version (package.json). */
export const VERSION = PKG.version || '0.0.0'
/** Where Cockpit's code lives (feedback opens an issue there); a fork sets its own in package.json. */
export const REPOSITORY = String(PKG.repository?.url || PKG.repository || '').replace(/^git[+]/, '').replace(/[.]git$/, '')

/** How the board behaves, set in Settings. */
export const STICKY_COLORS = ['ink', 'yellow', 'orange', 'pink', 'green']
export const TIDY_GAPS = [12, 24, 40]
/** Where "Open in editor" opens a note or text file: Notepad, VS Code, or the file's default program. */
export const EDITORS = ['notepad', 'vscode', 'default']
/** Light, dark, or whatever Windows is set to. */
export const THEMES = ['system', 'dark', 'light']

export function defaults() {
  return {
    // its own folder, so Cockpit never mixes with notes kept elsewhere (set another one in Settings)
    notesDir: path.join(HOME, 'Documents', 'Cockpit'),
    hubDir: path.join(HOME, 'hub'),
    claudeProjectsDir: path.join(HOME, '.claude', 'projects'),
    trackerConfig: path.join(HOME, '.claude', 'mods-data', 'tracker', 'config.json'),
    /** Extra tracker.json files (or folders holding one) beyond the hub's and the tracker mod's config (both optional Claude Code integrations). */
    trackers: [],
    /** Trackers taken off the list by hand: not read, and not added back by a chat or the scan. */
    hiddenTrackers: [],
    todoistToken: '',
    /** Sessions active within this many days are listed. */
    sessionsDays: 3,
    /** user@host of Kokoro (an optional self-hosted journal service) for the journal sync; empty turns the sync off. */
    kokoroHost: '',
    /** A new sticky note's paper (each note can still be given its own). */
    stickyColor: 'ink',
    /** Single-letter shortcuts on the board (N, L, T…); off leaves only Ctrl combinations. */
    singleKeys: true,
    /** Space Tidy leaves between cards. */
    tidyGap: 24,
    /** The program "Open in editor" uses (Notepad is on every Windows machine). */
    editor: 'notepad',
    /** Light, dark, or as Windows is set (the default). */
    theme: 'system',
    /** An installed copy looks for a newer release about once a day. */
    updates: true,
    /** Look through Projects, Desktop and synced folders for tracker.json files (off: only the ones listed). */
    scanTrackers: false,
  }
}

const PATH_KEYS = ['notesDir', 'hubDir', 'claudeProjectsDir', 'trackerConfig']

export function readRawConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function loadConfig() {
  const raw = readRawConfig()
  const cfg = defaults()
  for (const k of PATH_KEYS) if (typeof raw[k] === 'string' && raw[k].trim()) cfg[k] = raw[k].trim()
  if (typeof raw.todoistToken === 'string') cfg.todoistToken = raw.todoistToken.trim()
  if (Array.isArray(raw.trackers)) cfg.trackers = raw.trackers.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
  if (Array.isArray(raw.hiddenTrackers)) cfg.hiddenTrackers = raw.hiddenTrackers.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
  if (typeof raw.kokoroHost === 'string') cfg.kokoroHost = raw.kokoroHost.trim()
  const days = Number(raw.sessionsDays)
  if (Number.isFinite(days) && days >= 1 && days <= 30) cfg.sessionsDays = days
  if (STICKY_COLORS.includes(raw.stickyColor)) cfg.stickyColor = raw.stickyColor
  if (typeof raw.singleKeys === 'boolean') cfg.singleKeys = raw.singleKeys
  if (TIDY_GAPS.includes(raw.tidyGap)) cfg.tidyGap = raw.tidyGap
  if (EDITORS.includes(raw.editor)) cfg.editor = raw.editor
  if (THEMES.includes(raw.theme)) cfg.theme = raw.theme
  if (typeof raw.updates === 'boolean') cfg.updates = raw.updates
  if (typeof raw.scanTrackers === 'boolean') cfg.scanTrackers = raw.scanTrackers
  return cfg
}

/** Applies only the settings the app may change, checked; returns the new config. */
export function saveConfig(patch) {
  const raw = readRawConfig()
  for (const k of PATH_KEYS) {
    if (typeof patch[k] === 'string' && patch[k].trim()) {
      if (!path.isAbsolute(patch[k].trim())) throw new UserError(`${k} must be an absolute path`)
      raw[k] = patch[k].trim()
    }
  }
  if (typeof patch.todoistToken === 'string') raw.todoistToken = patch.todoistToken.trim()
  if (Array.isArray(patch.trackers)) raw.trackers = patch.trackers.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
  if (Array.isArray(patch.hiddenTrackers)) raw.hiddenTrackers = patch.hiddenTrackers.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()).slice(-200)
  if (patch.sessionsDays !== undefined) {
    const d = Number(patch.sessionsDays)
    if (!Number.isFinite(d) || d < 1 || d > 30) throw new UserError('sessionsDays must be between 1 and 30')
    raw.sessionsDays = d
  }
  if (patch.stickyColor !== undefined) {
    if (!STICKY_COLORS.includes(patch.stickyColor)) throw new UserError(`stickyColor is one of ${STICKY_COLORS.join(', ')}`)
    raw.stickyColor = patch.stickyColor
  }
  if (patch.singleKeys !== undefined) {
    if (typeof patch.singleKeys !== 'boolean') throw new UserError('singleKeys is true or false')
    raw.singleKeys = patch.singleKeys
  }
  if (patch.tidyGap !== undefined) {
    if (!TIDY_GAPS.includes(patch.tidyGap)) throw new UserError(`tidyGap is one of ${TIDY_GAPS.join(', ')}`)
    raw.tidyGap = patch.tidyGap
  }
  if (patch.scanTrackers !== undefined) {
    if (typeof patch.scanTrackers !== 'boolean') throw new UserError('scanTrackers is true or false')
    raw.scanTrackers = patch.scanTrackers
  }
  if (patch.updates !== undefined) {
    if (typeof patch.updates !== 'boolean') throw new UserError('updates is true or false')
    raw.updates = patch.updates
  }
  if (patch.theme !== undefined) {
    if (!THEMES.includes(patch.theme)) throw new UserError(`theme is one of ${THEMES.join(', ')}`)
    raw.theme = patch.theme
  }
  if (patch.editor !== undefined) {
    if (!EDITORS.includes(patch.editor)) throw new UserError(`editor is one of ${EDITORS.join(', ')}`)
    raw.editor = patch.editor
  }
  writeFileAtomic(CONFIG_FILE, JSON.stringify(raw, null, 2) + '\n')
  return loadConfig()
}

/** The config as the browser may see it: never the token itself. */
export function publicConfig(cfg) {
  const { todoistToken, ...rest } = cfg
  return { ...rest, hasTodoistToken: Boolean(todoistToken), dataDir: DATA_DIR, port: PORT, version: VERSION, changelog: CHANGELOG, repository: REPOSITORY, windows: os.release() }
}

export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

/** True when target is root or inside it (case-insensitive on Windows, as path.relative is there). */
export function within(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** An error whose message is safe and useful to show the person (sent as 400). */
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
