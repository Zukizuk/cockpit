import type { Theme } from './theme'
import { mac } from './platform'
// Talking to Cockpit's local server. Every change carries X-Cockpit: 1, which the server requires.

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === 'GET' ? {} : { 'X-Cockpit': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError(`The server answered ${res.status} with something that isn't JSON`, res.status)
  }
  if (!res.ok) throw new ApiError(data?.error || `HTTP ${res.status}`, res.status)
  return data as T
}

export const get = <T,>(url: string) => request<T>('GET', url)
export const post = <T,>(url: string, body: unknown = {}) => request<T>('POST', url, body)
export const put = <T,>(url: string, body: unknown = {}) => request<T>('PUT', url, body)

export type Format = 'markdown' | 'html' | 'code' | 'text' | 'diff' | 'json' | 'csv' | 'mermaid' | 'image' | 'pdf' | 'video' | 'audio' | 'binary' | 'article' | 'link' | 'compare' | 'docx' | 'sheet' | 'slides'

/** Something kept to copy (see server/lib/snippets.js). A secret's text never comes with the list. */
export interface Snippet {
  id: string
  title: string
  secret: boolean
  language: string
  length: number
  lines: number
  preview: string
  createdAt: number
  expiresAt: number | null
  from: string
}
export type SnippetKeep = 'day' | 'week' | 'month' | 'forever'

/** Something pinned: opened often, kept one click away (see server/lib/pinned.js). */
export interface Pin {
  id: string
  kind: 'file' | 'folder' | 'link' | 'note'
  target: string
  title: string
  group: string
  opens: number
  lastOpened?: number
  addedAt: number
  missing?: boolean
  /** Cockpit can show it itself (a page, a note, a file it has a viewer for). */
  viewable?: boolean
}
/** Opened 3+ times in two weeks and not pinned: Quick access shows it by itself (see server/lib/usage.js). */
export interface Often {
  key: string
  kind: 'file' | 'folder' | 'link' | 'note'
  target: string
  title: string
  opens: number
  /** Different days it was opened on, in the last two weeks. */
  days: number
  lastOpened: number
  inCockpit: boolean
  viewable?: boolean
  /** The kept item it was read from, if any (so one already on the board isn't offered again). */
  shownId?: string
}
export interface PinnedList {
  items: Pin[]
  groups: string[]
  often: Often[]
}
export type PinInput = { path?: string; url?: string; note?: string; title?: string; group?: string }

export interface ShownEntry {
  /** What's typed in a page on the board (fields and what the page keeps itself), kept by the board for it. */
  pageState?: Record<string, unknown>
  /** An image drawn on: the image it started from (kept; one that lives in Cockpit is removed 30 days after the edit). */
  original?: { path: string; cockpit?: boolean; at: string; editedAt: string }
  id: string
  kind: 'file' | 'content' | 'link' | 'compare'
  path: string
  path2?: string
  url?: string
  siteName?: string
  byline?: string
  excerpt?: string
  image?: string
  words?: number
  readError?: string
  tags?: string[]
  format: Format
  language?: string
  title: string
  note?: string
  from?: string
  createdAt: string
  /** When it was last shown (a file shown again keeps its item). */
  shownAt?: string
  seen?: boolean
  pinned?: boolean
  hidden?: boolean
  /** On the Later list: to check, being read, or done. */
  later?: LaterState
  laterAt?: string
  doneAt?: string
  /** A saved link whose page is still being read in the background. */
  readingAt?: string
  /** Named after its address until the page gives it a name (or it is named by hand). */
  autoTitle?: boolean
}

export type LaterState = 'todo' | 'reading' | 'done'

export interface FileState {
  exists: boolean
  size: number
  mtime: number
}

export interface ShownRead extends FileState {
  entry: ShownEntry
  text?: string
  text2?: string
  /** Word, as HTML. */
  html?: string
  /** Spreadsheets: every sheet's name and size, with the first rows of one (`sheet`); the others load on demand. */
  sheets?: { name: string; rows?: string[][]; total: number; cols: number }[]
  /** Which sheet's rows came with it. */
  sheet?: number
  /** PowerPoint: each slide's text, line by line. */
  slides?: { n: number; lines: string[] }[]
  previewError?: string
  truncated?: boolean
}

export interface NoteInfo {
  path: string
  name: string
  folder: string
  title: string
  /** A title given by hand (empty when none). */
  given?: string
  mtime: number
  size: number
  excerpt?: string
}

export interface NotesList {
  root: string
  notes: NoteInfo[]
  today: string
}

export interface NoteRead {
  path: string
  text: string
  mtime: number
}

export interface NoteSaved {
  path: string
  mtime: number
  conflict?: boolean
  text?: string
}

export interface Project {
  id: string
  title: string
  inShort: string
  updated: string
  mtime: number
  status: string
}

export interface ProjectRead {
  id: string
  path: string
  text: string
  mtime: number
}

export type SessionState = 'your-turn' | 'question' | 'working' | 'quiet'

export interface Session {
  key: string
  id: string
  title: string
  cwd: string
  project: string
  entrypoint: string
  /** Started by a scheduled task rather than by me. */
  automatic: boolean
  lastActivity: number
  size: number
  state: SessionState
  lastPrompt: string
  lastReply: string
  asking: string
}

export interface Message {
  role: 'user' | 'assistant' | 'tool-result'
  text?: string
  tools?: { name: string; summary: string }[]
  at?: string
  count?: number
  isError?: boolean
}

export interface SessionRead extends Session {
  messages: Message[]
}

export interface TrackerItem {
  id: string
  type: 'todo' | 'waiting' | 'check' | 'decided'
  title: string
  date?: string
  you: boolean
  blocker: string
  who: string
  note: string
  tags: string[]
  about: string
  where: string
}

export interface Tracker {
  name: string
  file: string
  ok: boolean
  error?: string
  open: TrackerItem[]
  counts: { yours: number; todo: number; waiting: number; check: number; suggested: number }
}

export interface Task {
  id: string
  content: string
  description: string
  projectId: string
  projectName: string
  priority: number
  labels: string[]
  due: { day: string; when: string; hasTime: boolean; string: string; recurring: boolean } | null
  overdue: boolean
  url: string
}

export interface TodoState {
  configured: boolean
  tasks: Task[]
  fetchedAt?: number
  error?: string
}

export interface Config {
  notesDir: string
  hubDir: string
  claudeProjectsDir: string
  trackerConfig: string
  trackers: string[]
  hiddenTrackers: string[]
  scanTrackers: boolean
  /** Extras turned on in Settings > Extras (each off until then). */
  extras?: Extras
  /** What each agent may see on the board (Settings > Agents). */
  agentAccess?: Record<AgentName, AgentAccess>
  /** Connect also asks Claude Code not to read Cockpit's files or call its API directly. */
  agentFence?: boolean
  sessionsDays: number
  hasTodoistToken: boolean
  dataDir: string
  port: number
  version: string
  mcpScript: string
  /** A new sticky note's paper. */
  stickyColor: StickyColor
  /** Single-letter shortcuts on the board. */
  singleKeys: boolean
  /** Space Tidy leaves between cards. */
  tidyGap: number
  /** Where CHANGELOG.md is (What's new). */
  changelog: string
  /** The program "Open in editor" uses. */
  editor: Editor
  /** Where Cockpit's code lives (Send feedback opens an issue there). */
  repository: string
  /** The Windows build, for feedback (on a Mac, the Darwin version). */
  windows: string
  /** Light, dark, or as Windows is set. */
  theme: Theme
  /** An installed copy looks for a newer release about once a day. */
  updates: boolean
}

/** Updates (an installed copy only): what's running, the latest release, and whether an update is under way. */
/** Whether Cockpit is connected to Claude Code (Settings > Claude Code). yes: to this copy; other: to another copy. */
export interface ClaudeLink {
  hook: 'yes' | 'other' | 'no'
  tools: 'yes' | 'other' | 'no'
  /** Claude Code's deny rules for Cockpit's notes and data folders are in its settings */
  fence?: 'yes' | 'no'
  /** when a chat's outputs last came in (by any way), 0 if never */
  lastOutput: number
  /** Claude Code's command was found */
  claude: boolean
  /** the command that registers the board tools by hand */
  command: string
  problems?: string[]
}

export interface UpdateStatus {
  installed: boolean
  enabled: boolean
  current: string
  latest: { version: string; page: string; zip: string; size: number; sha256: string } | null
  available: boolean
  checkedAt: number
  busy: '' | 'downloading' | 'installing'
  error: string
}

/** Where a note or text file opens outside Cockpit (Settings). */
export type Editor = 'notepad' | 'vscode' | 'default'
export const EDITORS: { value: Editor; label: string }[] = [
  // 'notepad' is TextEdit on a Mac
  { value: 'notepad', label: mac ? 'TextEdit' : 'Notepad' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'default', label: 'Default app' },
]
/** The menu line for opening in the chosen editor. */
export const editorLabel = (e: Editor) => (e === 'notepad' ? (mac ? 'Open in TextEdit' : 'Open in Notepad') : e === 'vscode' ? 'Open in VS Code' : 'Open in its own program')

export const openOutside = (body: { kind: 'shown' | 'note' | 'table' | 'project' | 'notes-folder' | 'output' | 'path'; id?: string; path?: string; index?: number | string; side?: 'left' | 'right'; how?: 'default' | 'reveal' | 'vscode' | 'notepad' | 'editor' }) =>
  post<{ ok: true }>('/api/open', body)

export type OutputKind = 'file' | 'link' | 'draft' | 'command' | 'prompt'

export interface OutputItem {
  kind: OutputKind
  label: string
  target: string
  text: string
  detail: string
  /** Stable row id (rows move down as newer turns arrive). */
  id: string
  /** When the turn that made it ended. */
  at: string
}

export interface Changes {
  repo: boolean
  source: 'working' | 'untracked' | 'commit' | 'none'
  label: string
  diff: string
  added: number
  removed: number
}

/** What one Claude turn made, as its deliverables tray listed it. */
export interface OutputGroup {
  id: string
  createdAt: string
  updatedAt: string
  /** When the group was last looked at: turns after it are new. */
  seenAt?: string | null
  from: string
  project: string
  /** The chat's folder: where its commands run unless another is given. */
  cwd?: string
  seen: boolean
  items: OutputItem[]
}

export type Extras = { dictionary: boolean; tables: boolean; journal: boolean }

/** A table (the Table extra): a .csv in the notes folder's tables/; the first row is the header. */
export interface TableData {
  path: string
  title: string
  rows: string[][]
  mtime: number
}

/** One word's meanings (the Dictionary extra): by part of speech, each [definition, examples, same, opposite]. */
export interface DictEntry {
  w: string
  ipa?: string
  m: [string, [string, string[], string[], string[]][]][]
}
export interface DictResult {
  word: string
  entries: DictEntry[]
  /** a form ("ran") looked up as the word it comes from ("run") */
  from?: string[]
}

export type CardType = 'item' | 'note' | 'outputs' | 'tasks' | 'tracker' | 'command' | 'later' | 'snippets' | 'folder' | 'table' | 'section' | 'questions'

/** A task on the Today card's own list (when Todoist isn't connected). */
export interface LocalTask {
  id: string
  content: string
  createdAt: string
  /** The day it was ticked off ('' while open). */
  doneOn: string
}

/** One thing in a folder, for the folder card. */
export interface FolderEntry {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
  format: string
}

export interface FolderList {
  path: string
  name: string
  entries: FolderEntry[]
  more: number
}

/** On the shelf since `at`; back in the tray on `until` (ms), if set. */
export type Shelf = { at: number; until?: number }

export interface BoardCard {
  id: string
  type: CardType
  /** The item id, note path, output group id or tracker name the card shows. */
  ref: string
  x: number
  y: number
  w: number
  /** The open height, also while folded. */
  h: number
  folded?: boolean
  /** Locked in place: not moved by hand or by Tidy, not resized, not deleted by the Delete key. */
  locked?: boolean
  /** A sticky note's paper. */
  color?: StickyColor
  /** A card that fits its content (Snippets) was given a height by hand: it keeps that height. */
  sized?: boolean
  /** The space it's in (Main when left out). */
  space?: string
  /** Tucked away: a tab at the top edge of the screen until brought back to where it was. */
  tucked?: boolean
  /** Put away on the shelf (tucked, listed on the shelf, not at the top): when, and the day it comes back if set. */
  shelf?: Shelf
  /** Held by a section that's folded or tucked away (its id): hidden where it was until the section opens again. */
  inside?: string
  /** Its contents hidden (blurred), as when sharing the screen. */
  veiled?: boolean
  /** Shared with agents, or private (agents never see it); left out: as its space and Settings say. */
  agents?: AgentMark
  /** Made by an agent: its name ("Claude"), so a later chat knows which cards are its own. */
  madeBy?: string
  /** A section's title (a section is an area on the board; the cards whose middle is in it are in it). */
  title?: string
}

/** A card or space shared with agents, or kept from them. */
export type AgentMark = 'shared' | 'private'
/** What an agent may see on the board: nothing, what's shared with agents, or everything that isn't private. */
export type AgentAccess = 'off' | 'shared' | 'all'
export type AgentName = 'claude-code' | 'other'

/** One call an agent made with the board tools (Settings > Agents). */
export interface AgentLogEntry {
  at: number
  agent: string
  tool: string
  what?: string
  saw?: string[]
  refused?: string
}

/** A board of its own: cards in other spaces stay saved, out of view. Each keeps where its view was. */
export interface Space {
  id: string
  name: string
  viewport?: { x: number; y: number; zoom: number } | null
  /** Its cards shared with agents, or all of them private. */
  agents?: AgentMark
}

/** A comment on a card: the user's or Claude's. */
export interface CardComment {
  id: string
  by: 'you' | 'Claude'
  text: string
  at: string
}

export type StickyColor = 'yellow' | 'green' | 'pink' | 'orange' | 'ink'

/** A question an agent left on the board, with its best guess, which stands until the person answers. */
export interface Question {
  id: string
  question: string
  guess?: string
  /** the card it's about, by title */
  about?: string
  /** a few answers to pick from (something else can still be written) */
  choices?: string[]
  by: string
  at: string
  answer?: string
  answeredAt?: string
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** An arrow from one card to another. It shows only while both are on the board (same space, not tucked away). */
export interface BoardLink {
  id: string
  from: string
  to: string
  /** The side of each card it leaves and reaches (left out: whichever faces the other card). */
  fromSide?: Side
  toSide?: Side
  label?: string
  dash?: boolean
  /** Arrowheads: at the `to` end (left out), at both ends, or none (a plain line). */
  heads?: 'both' | 'none'
}

export interface Board {
  cards: BoardCard[]
  viewport: { x: number; y: number; zoom: number } | null
  spaces?: Space[]
  /** The space shown now. */
  space?: string
  links?: BoardLink[]
}

export type Shell = 'pwsh' | 'bash'

export interface RunInfo {
  command: string
  cwd: string
  shell: Shell
  shells: Record<Shell, boolean>
}

export interface RunView {
  id: string
  shell: Shell
  cwd: string
  command: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  code: number | null
  startedAt: number
  endedAt: number
  truncated: boolean
  /** Output since the offset asked for. */
  out: string
  offset: number
}

/** Counts one use of a feature for the anonymous usage counts (the server ignores it unless you said yes). */
export const track = (event: string) => {
  post('/api/telemetry/count', { event }).catch(() => {})
}

export interface TelemetryStatus {
  available: boolean
  choice: 'yes' | 'no' | null
  ask: boolean
  /** Exactly what would be sent next. */
  preview: unknown[]
  /** The last batch sent: when, and which days. */
  lastSent: { at: number; days: string[] } | null
}
