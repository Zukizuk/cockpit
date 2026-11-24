// Cockpit's Outputs feed for Claude Code: a Stop hook. When a turn ends, Claude Code runs this with the chat's
// details on stdin; it reads the turn from the chat's transcript and drops what the turn made into
// ~/.cockpit/inbox, where Cockpit lists it under Outputs (one group per chat):
//   - files the turn's Write, Edit, MultiEdit and NotebookEdit calls wrote
//   - files the final reply names that changed while the turn ran (a report a script made, say)
//   - drafts (a quoted or plain block the reply introduces as an email or message), commands, and links
//   - drawings shown in the chat (the visualize tool's show_widget): each kept as a page in ~/.cockpit/drawings, so
//     it opens in Cockpit as an artifact (a file) does
// It never blocks or slows Claude: everything is best-effort, nothing is printed, and it always exits 0.
// The installer adds it to ~/.claude/settings.json (scripts/claude-setup.mjs); Uninstall takes it out.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractReply, findPaths } from './extract.js'
import { baseName, isNoise, nativePath, pathKey, shortDir, slashes } from './paths.js'

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAX_ITEMS = 40

/** Whether a user line is a prompt the person typed (not a tool result, a command's echo or an engine note). */
function isPrompt(e) {
  if (e.type !== 'user' || e.isSidechain || e.isMeta) return false
  const c = e.message?.content
  if (typeof c === 'string') return !/^\s*<(local-command|command-name|command-message|system-reminder)/.test(c)
  if (!Array.isArray(c)) return false
  return c.some(b => b?.type === 'text') && !c.some(b => b?.type === 'tool_result')
}

/** The last turn of a transcript: when it started, the files its tools wrote (in order), and its final reply. */
export function lastTurn(lines) {
  const entries = []
  for (const l of lines) {
    try {
      if (l.trim()) entries.push(JSON.parse(l))
    } catch {
      // a half-written last line
    }
  }
  let start = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isPrompt(entries[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null
  const turn = entries.slice(start + 1).filter(e => e.type === 'assistant' && !e.isSidechain)
  const touched = []
  const drawings = []
  let replyParts = []
  for (const e of turn) {
    const blocks = Array.isArray(e.message?.content) ? e.message.content : []
    for (const b of blocks) {
      if (b?.type === 'tool_use') {
        replyParts = [] // the final reply is the text after the last tool call
        if (TOOLS.has(b.name)) {
          const p = b.input?.file_path || b.input?.notebook_path
          if (typeof p === 'string' && p) touched.push(p)
        }
        // a drawing shown in the chat (mcp__visualize__show_widget, or the same tool under another server's name)
        if (/(^|__)show_widget$/.test(String(b.name || '')) && typeof b.input?.widget_code === 'string' && b.input.widget_code.trim()) {
          drawings.push({ title: String(b.input.title || ''), code: b.input.widget_code })
        }
      } else if (b?.type === 'text' && b.text) {
        replyParts.push(b.text)
      }
    }
  }
  return { startedAt: Date.parse(entries[start].timestamp) || 0, touched, drawings, reply: replyParts.join('\n\n') }
}

/**
 * The last turn, reading only the end of the transcript (a long chat's file runs to many megabytes, and Claude Code
 * waits for this hook): 1 MB, then more until the turn's prompt is in it.
 */
export function readLastTurn(file) {
  const size = fs.statSync(file).size
  const fd = fs.openSync(file, 'r')
  try {
    for (let want = 1 << 20; ; want *= 4) {
      const len = Math.min(size, want)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      const lines = buf.toString('utf8').split('\n')
      if (len < size) lines.shift() // the first line is cut
      const turn = lastTurn(lines)
      if (turn || len === size) return turn
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** A path the reply names, made absolute ('' when it can't be placed). */
function resolveNamed(raw, home, cwd) {
  const s = slashes(raw)
  if (/^~\//.test(s)) return home ? slashes(home) + s.slice(1) : ''
  if (/^[A-Za-z]:\//.test(s) || s.startsWith('/')) return s
  return cwd ? slashes(cwd).replace(/\/+$/, '') + '/' + s : ''
}

const draftLabel = text => text.split('\n').find(l => l.trim())?.trim().slice(0, 90) || 'Draft'

/** What the turn made, as Outputs items: drafts, commands, files (newest first), links. */
export function turnItems(turn, { cwd = '', home = os.homedir(), changedSince = turn.startedAt } = {}) {
  const ex = extractReply(turn.reply)
  // files the tools wrote, then files the reply names that changed during the turn; one entry each, last touch wins
  const named = findPaths(turn.reply)
    .slice(0, 24)
    .map(p => resolveNamed(p, home, cwd))
    .filter(p => {
      try {
        return p && changedSince && fs.statSync(p).isFile() && fs.statSync(p).mtimeMs >= changedSince - 2000
      } catch {
        return false
      }
    })
  const files = new Map()
  for (const p of [...turn.touched, ...named]) {
    if (!p || isNoise(p)) continue
    files.delete(pathKey(p))
    files.set(pathKey(p), p)
  }
  const items = []
  // a "pick up" block for another agent is text to copy, like a draft
  for (const d of [...ex.drafts, ...ex.prompts.map(p => ({ text: p.text, label: draftLabel(p.text) }))]) items.push({ kind: 'draft', label: d.label, text: d.text })
  for (const c of ex.commands) items.push({ kind: 'command', label: c.label, text: c.text, detail: c.extra ? `+${c.extra} line${c.extra === 1 ? '' : 's'}` : '' })
  for (const p of [...files.values()].reverse()) items.push({ kind: 'file', label: baseName(p), text: nativePath(p), target: nativePath(p), detail: shortDir(p, home) })
  for (const l of ex.links) items.push({ kind: 'link', label: l.label, text: l.url, target: l.url })
  return items.slice(0, MAX_ITEMS)
}

/** Where Cockpit keeps its data (the same rule as the server's), or '' when Cockpit isn't set up on this PC. */
function cockpitData() {
  const dir = process.env.COCKPIT_DATA || path.join(process.env.COCKPIT_HOME || os.homedir(), '.cockpit')
  return fs.existsSync(dir) ? dir : ''
}

/** The hook: stdin is Claude Code's JSON ({ session_id, transcript_path, cwd, ... }). */
/**
 * The tracker this chat works in (tracker.json, or .claude/tracker.json, in its folder or up to two above it), when
 * Cockpit doesn't know it yet: Cockpit lists it from then on, as it lists the chat's outputs.
 */
export function newTracker(cwd, data) {
  if (!cwd) return ''
  let file = ''
  let dir = path.resolve(cwd)
  for (let i = 0; i < 3 && !file; i++) {
    for (const f of [path.join(dir, 'tracker.json'), path.join(dir, '.claude', 'tracker.json')]) {
      try {
        if (fs.statSync(f).isFile() && fs.readFileSync(f, 'utf8').slice(0, 4000).includes('"items"')) {
          file = f
          break
        }
      } catch {
        // not here
      }
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  if (!file) return ''
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
    const known = [...(cfg.trackers || []), ...(cfg.hiddenTrackers || [])].map(t => path.resolve(String(t)).toLowerCase())
    if (known.includes(file.toLowerCase()) || known.includes(path.dirname(file).toLowerCase())) return ''
  } catch {
    // no settings yet: tell Cockpit
  }
  return file
}

// ---- drawings: a show_widget drawing is HTML or SVG made for the chat, which gives it its colours (CSS variables),
// its icon font and two functions; this page gives them too, so it looks the same opened in Cockpit ----------------

const DRAWING_STYLE = `
:root{color-scheme:light dark;--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,Consolas,monospace;--font-voice:Georgia,serif;--radius:8px;
--text-primary:#1f1e1d;--text-secondary:#5e5d59;--text-muted:#8a8985;--text-accent:#185fa5;--text-danger:#a32d2d;--text-success:#3b6d11;--text-warning:#854f0b;
--surface-0:#f0eee6;--surface-1:#f7f6f2;--surface-2:#ffffff;--bg-neutral:rgba(0,0,0,.05);--bg-accent:#e6f1fb;--bg-danger:#fcebeb;--bg-success:#eaf3de;--bg-warning:#faeeda;
--border:rgba(0,0,0,.12);--border-strong:rgba(0,0,0,.2);--border-stronger:rgba(0,0,0,.4);--border-accent:#378add}
@media (prefers-color-scheme:dark){:root{--text-primary:#ecebe6;--text-secondary:#b4b2a9;--text-muted:#888780;--text-accent:#85b7eb;--text-danger:#f09595;--text-success:#97c459;--text-warning:#ef9f27;
--surface-0:#1a1a19;--surface-1:#222221;--surface-2:#2a2a29;--bg-neutral:rgba(255,255,255,.06);--bg-accent:#0c447c;--bg-danger:#791f1f;--bg-success:#27500a;--bg-warning:#633806;
--border:rgba(255,255,255,.12);--border-strong:rgba(255,255,255,.2);--border-stronger:rgba(255,255,255,.4)}}
*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.7 var(--font-sans);color:var(--text-primary);background:var(--surface-1)}
h1,h2,h3{font-weight:500;color:var(--text-primary)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
button{font:inherit;font-size:14px;padding:6px 14px;border-radius:var(--radius);border:.5px solid var(--border-strong);background:transparent;color:var(--text-primary);cursor:pointer}
button:hover{background:var(--surface-0)}button:active{transform:scale(.98)}
input,select,textarea{font:inherit;color:inherit;background:var(--surface-2);border:.5px solid var(--border-strong);border-radius:var(--radius);padding:6px 10px}
svg text.t,svg .t{font:14px var(--font-sans);fill:var(--text-primary)}svg .ts{font:12px var(--font-sans);fill:var(--text-secondary)}svg .th{font:500 14px var(--font-sans);fill:var(--text-primary)}
.c-purple{fill:#eeedfe;stroke:#534ab7}.c-teal{fill:#e1f5ee;stroke:#0f6e56}.c-coral{fill:#faece7;stroke:#993c1d}.c-pink{fill:#fbeaf0;stroke:#993556}.c-gray{fill:#f1efe8;stroke:#5f5e5a}
.c-blue{fill:#e6f1fb;stroke:#185fa5}.c-green{fill:#eaf3de;stroke:#3b6d11}.c-amber{fill:#faeeda;stroke:#854f0b}.c-red{fill:#fcebeb;stroke:#a32d2d}
`
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
/** A drawing's title ("sticky_note_fold_styles") as words ("Sticky note fold styles"). */
export const drawingTitle = t => {
  const w = String(t || '').replace(/[_-]+/g, ' ').trim()
  return w ? w[0].toUpperCase() + w.slice(1) : 'Drawing'
}
export function drawingPage(title, code) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(drawingTitle(title))}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">
<style>${DRAWING_STYLE}</style>
<script>window.sendPrompt = function () {}; window.openLink = function (u) { window.open(u, '_blank') }</script>
</head>
<body>
${code}
</body>
</html>
`
}

/** Each drawing kept as a page in <data>/drawings; returned as Outputs items (files, so they open in Cockpit). */
export function saveDrawings(data, drawings, now = new Date()) {
  if (!drawings?.length) return []
  const dir = path.join(data, 'drawings')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return drawings.slice(0, 10).map((d, i) => {
    const slug = String(d.title || 'drawing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'drawing'
    const file = path.join(dir, `${stamp}-${i + 1}-${slug}.html`)
    fs.writeFileSync(file, drawingPage(d.title, d.code))
    return { kind: 'file', label: drawingTitle(d.title), text: file, target: file, detail: 'Drawing from the chat' }
  })
}

function drop(data, payload) {
  const inbox = path.join(data, 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const name = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  // written beside, then renamed: Cockpit only ever sees a whole file
  fs.writeFileSync(path.join(inbox, name + '.tmp'), JSON.stringify(payload))
  fs.renameSync(path.join(inbox, name + '.tmp'), path.join(inbox, name))
  return name
}

export async function run(input, { data = cockpitData() } = {}) {
  if (!data || !input?.transcript_path) return null
  const cwd = input.cwd || ''
  const tracker = newTracker(cwd, data)
  if (tracker) drop(data, { tracker })
  const turn = readLastTurn(input.transcript_path)
  if (!turn) return null
  const items = [...saveDrawings(data, turn.drawings), ...turnItems(turn, { cwd })].slice(0, MAX_ITEMS)
  if (!items.length) return null
  const outputs = { from: `Claude · ${baseName(cwd) || 'chat'}`, session: String(input.session_id || ''), cwd, project: baseName(cwd), items }
  return drop(data, { outputs })
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', c => (raw += c))
  process.stdin.on('end', async () => {
    try {
      await run(JSON.parse(raw || '{}'))
    } catch {
      // never get in Claude's way
    }
    process.exit(0)
  })
}
