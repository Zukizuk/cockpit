#!/usr/bin/env node
// Cockpit's MCP server (stdio): `show` puts a file or written content on Cockpit; `snippet` leaves something to copy
// (a command, a key) in its Snippets; `board_snapshot`, `board_act` and `board_query` (experimental) read and use the
// open board through UI SDK's agent bridge (only the Today list for now).
// It writes straight into ~/.cockpit/shown, so it works while the app is closed, and starts the app's server
// when it is not running. Only JSON-RPC goes to stdout; anything else goes to stderr.
import { appPath } from './lib/app-root.js'
import readline from 'node:readline'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { HOST, PORT, VERSION } from './lib/config.js'
import { FORMATS, addCompare, addLink, addShown } from './lib/shown.js'
import { addSnippetSync } from './lib/snippets.js'
import * as telemetry from './lib/telemetry.js'
import { agentTools } from '@ui-sdk/core/agent'

const here = appPath('server')

const BOARD_NOTE =
  "What you see: only what the user lets agents see (Cockpit: Settings > Agents). Usually that is the cards they " +
  "select or share with agents, the cards in shared spaces, and cards you made; private cards and spaces never show. " +
  "'Board' has a sharing line when that is so. If the user means a card you cannot see, ask them to select it or share " +
  "it (right-click the card: Share with agents). Never go around this: don't read Cockpit's notes folder, its data " +
  "folder (~/.cockpit) or its local web API (127.0.0.1:4790) to get at what isn't shared; use only these tools. " +
  "A space with no cards listed may still hold cards that aren't shared with you. " +
  'How to look: the snapshot is an overview, titles and kinds only, no contents. To know what a card says, call ' +
  'board_act with { steps: [{ ref: "<its ref or title>", action: "read" }] }: its contents come back in that step\'s ' +
  'result. Read only the cards the user is asking about. When the user names a card ("my sticky note Post ideas"), ' +
  'board_query with { text: "<some of its words>" } finds it by title. When they say "this card", "the selected one" ' +
  "or \"what I am looking at\", call board_snapshot: those cards have selected: true or inView: true, and 'Board' " +
  'lists their titles. Every board_act takes { steps: [{ ref, action, args: [...] }] }. ' +
  "Components: 'Board' (board: the spaces with their card counts, the space shown, the sections in it, selected and " +
  'in-view titles (a note with no title and nothing in it is "Untitled sticky note"; two cards of one name: the second ' +
  'is "… (2)"); ' +
  "actions switchSpace(space), newSpace(name), renameSpace(space, name), addSticky(text, space?), jot(text) into today's " +
  'journal (an extra the user turns on in Settings > Extras; if jot says it is off, use addSticky), show(pathOrUrl, space?) to put a file or link on the board; give space to put it in another space ' +
  'without moving the user there (make the space first with newSpace if it is new); tidy() lines the cards up, as the ' +
  "user's Ctrl+Alt+T does; focusOn(cards) puts one card or several (an array of titles, side by side in that order) " +
  "in focus, every other card folded into a column on the left, and bringBack() puts everything back where it was " +
  "(the board's focus lists the cards in focus); compare(cardA, cardB) opens two files, pages or notes full screen " +
  "side by side (cardA on the left) for the user to read and compare, notes still editable; addSection(title, cards) " +
  'puts a section (a titled area, which the cards in it move with) around the cards named, an array of titles in the ' +
  "space shown. Each card is a component (card) named by its title " +
  "(the cards of the lists are 'Today card', 'Later card' and 'Snippets card'): " +
  'its value has kind, space, the section it is in, selected, inView, folded, color (sticky notes), shared, rowCount ' +
  '(tables), how many comments it has and its arrows to and from the cards you can see; actions read() for its contents (a note: its whole text; a file or link: its path or address and ' +
  'the start of what it shows; a table: its rows; and its comments), comment(text), fold(), unfold(), focus() to bring it into view, moveToSpace(space), ' +
  'placeNextTo(otherCard, side?) to put it beside another card (side: right, left, below or above; right if not ' +
  'given; it goes to that card\'s space), connectTo(otherCard, label?) to draw an arrow from it to another card (or ' +
  "label the one already there; a card's arrows list them, \"→ Title\" it points to and \"← Title\" from), " +
  'disconnect(otherCard) to take that arrow away (it waits for Allow), moveToSection(section) to put it in one of ' +
  "the sections 'Board' lists (beside what is in it; the section grows to hold it), rename(title) " +
  "(notes), setColor(yellow | green | pink | orange | charcoal) (sticky notes), tuck() to tuck it away as a tab at " +
  'the top edge, bringBack(), hideContents() and showContents() (blurred on the board, for sharing the screen; ' +
  "a card's tucked and hidden say which), remove(). 'Today's tasks' (task-list: " +
  "add(text), complete(task), reopen(task), rename(task, newText), remove(task)); 'Later' (later-list: " +
  "read() for the items with their links, add(linkOrNote), setState(item, 'to check' | 'reading' | 'done'), " +
  "remove(item)); 'Snippets' (snippet-list: read(item) for one snippet's text, add(text, title?), remove(item); a " +
  "secret's text is never shown). A list that isn't shared with you says so in its name: you can add to it, not read it. " +
  "Notes (sticky notes, journal): read() gives a note's whole text; change it with the card's append(text), or " +
  "setText(text) to write it all anew (that waits for the user's Allow), not by editing its file. The user's comments on a card may be for you: answer with the card's comment(). " +
  "Every removal waits for the user to allow it in Cockpit. If 'Today's tasks' is missing, the Today card is not on " +
  'the board (the user can press T). ' +
  "Tables (an extra the user turns on in Settings > Extras): Board's addTable(title, rows, space?) puts a new table on the " +
  'board, rows being an array of arrays of text with the header first; use it when the user wants something compared ' +
  "or listed in a table they can edit. A table card's read() gives its rows (header first); its actions are " +
  'setCell(row, column, text) (row: its number from 1 under the header, or its first cell; column: its heading or ' +
  'number from 1), addRows(rows), setRows(rows) to replace it all, removeRow(row). setRows and removeRow wait for ' +
  "the user's Allow. If addTable says tables are off, tell the user where to turn them on."

export const TOOLS = [
  {
    name: 'show',
    title: 'Show in Cockpit',
    description:
      "Show something to the user in Cockpit, their own app for reading and looking at things, which renders far better than the chat. " +
      'Give one of: `path`, the absolute path of a file (markdown, code, image, PDF, HTML, CSV, JSON, diff or any text; Office files get ' +
      'an Open button); `url`, a web page, which Cockpit turns into a clean readable article and keeps; `content` you write now (markdown ' +
      'unless `format` says otherwise); or `path` plus `compare_with` to show two files side by side as before and after. Use it when the ' +
      'user asks to see, open, read, compare or review something, or for a long report, plan, table or diagram that reads better as a ' +
      'page. It opens in Cockpit at once. A file shown by path refreshes as it changes on disk. Never use it for secrets: use `snippet`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to show.' },
        url: { type: 'string', description: 'A web page (http or https) to read as an article.' },
        compare_with: { type: 'string', description: 'With `path` (the "before"): the absolute path of the "after" file, shown side by side.' },
        content: { type: 'string', description: 'Text to show instead of a file (up to 5 MB).' },
        format: { type: 'string', enum: FORMATS, description: 'How to render `content`: markdown (default), html, code, text, diff, json, csv or mermaid. Ignored with `path`, whose type comes from its extension.' },
        language: { type: 'string', description: 'Language for code highlighting, e.g. python, sql, typescript.' },
        title: { type: 'string', description: 'A short title. Defaults to the file name or the first heading.' },
        note: { type: 'string', description: 'One line on why you are showing it.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'snippet',
    title: 'Snippet to copy in Cockpit',
    description:
      'Leave a short text in Cockpit\'s Snippets for the user to copy with one click: a command to run, a code snippet, a ' +
      'connection string, a generated password, key or token. Use it whenever the user will need to copy something exactly, ' +
      'and always for secrets instead of writing them in the chat. With `secret: true` (or when it looks like a key or ' +
      'password) the text is encrypted on disk, hidden until the user reveals it, and deleted after `keep` (a week by default). ' +
      'Give it a `title` that says what it is for.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Exactly what the user will copy.' },
        title: { type: 'string', description: 'What it is, e.g. "Fabric SP client secret (dev)" or "Reset the gateway".' },
        secret: { type: 'boolean', description: 'Hide and encrypt it. Guessed from the text when left out.' },
        language: { type: 'string', description: 'For code: its language, e.g. bash, powershell, sql, python.' },
        keep: { type: 'string', enum: ['day', 'week', 'month', 'forever'], description: 'How long to keep it. Default: a week for a secret, until deleted otherwise.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  // Board tools (experimental, spike/ui-sdk-today): UI SDK's snapshot, act and query, run on the open board
  ...agentTools.map(t => ({
    name: `board_${t.name}`,
    description:
      `On the user's Cockpit board (it must be open in a window). ${BOARD_NOTE}\n\n${t.description}`,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.name !== 'act', destructiveHint: false, openWorldHint: false },
  })),
]

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

function health(timeout = 800) {
  return new Promise(resolve => {
    const req = http.get({ host: HOST, port: PORT, path: '/api/health', timeout, headers: { host: `${HOST}:${PORT}` } }, res => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** A POST to Cockpit's own API, as Cockpit itself would send it. */
function postJson(p, body) {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: p, method: 'POST', timeout: 60_000, headers: { host: `${HOST}:${PORT}`, 'content-type': 'application/json', 'x-cockpit': '1', 'content-length': Buffer.byteLength(data) } },
      res => {
        let s = ''
        res.setEncoding('utf8')
        res.on('data', c => (s += c))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(s)
          } catch {}
          resolve({ status: res.statusCode, body: parsed })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Cockpit did not answer in time')))
    req.end(data)
  })
}

/** Starts the app server in the background when it isn't answering. */
export async function ensureServer() {
  if (await health()) return true
  if (process.env.COCKPIT_NO_AUTOSTART) return false
  try {
    const child = spawn(process.execPath, [path.join(here, 'index.js')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env })
    child.on('error', () => {})
    child.unref()
  } catch {
    return false
  }
  for (let i = 0; i < 15; i++) {
    await sleep(200)
    if (await health(500)) return true
  }
  return false
}

function fromLabel() {
  const where = path.basename(process.cwd()) || process.cwd()
  return process.env.CLAUDECODE ? `Claude · ${where}` : where
}

/**
 * act takes { steps: [{ ref, action, args }] }. One step written flat ({ ref, action, args } or { ref, action, text })
 * is taken as that one step; no steps at all is an error, not an empty "ok" (an agent then thinks it did something).
 */
export function actSteps(input = {}) {
  if (Array.isArray(input.steps) && input.steps.length) return input
  if (input.ref && input.action) {
    const { ref, action, args, text, ...rest } = input
    const given = Array.isArray(args) ? args : args !== undefined ? [args] : text !== undefined ? [text] : Object.values(rest)
    return { steps: [{ ref, action, args: given }] }
  }
  throw new Error('board_act takes { steps: [{ ref, action, args: [...] }] }, for example { steps: [{ ref: "c14", action: "append", args: ["a new line"] }] }. Nothing was done.')
}

export async function callTool(name, args = {}) {
  try {
    if (name === 'show' || name === 'snippet') telemetry.count(`mcp.${name}`)
  } catch {}
  if (name === 'snippet') {
    try {
      const s = addSnippetSync({ text: args.text, title: args.title, secret: args.secret, language: args.language, keep: args.keep, from: fromLabel() })
      const running = await ensureServer()
      const kept = s.expiresAt ? `until ${new Date(s.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'until deleted'
      return {
        content: [{
          type: 'text',
          text: `Left in Cockpit's Snippets as "${s.title}"${s.secret ? ' (secret: hidden and encrypted)' : ''}, kept ${kept}.` +
            (running ? '' : " Cockpit isn't running; it will be there when it starts.") +
            (s.secret ? ' Do not repeat the secret in the chat.' : ''),
        }],
      }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] }
    }
  }
  if (name.startsWith('board_')) {
    try {
      if (!(await ensureServer())) throw new Error("Cockpit isn't running.")
      // a query written as a step ({ ref, action: "read" }) is what act does: it goes there
      if (name === 'board_query' && args?.action && args?.ref) name = 'board_act'
      if (name === 'board_act') args = actSteps(args)
      const r = await postJson('/api/agent/call', { tool: name.slice(6), input: args, agent: process.env.CLAUDECODE ? 'claude-code' : 'other', label: fromLabel() })
      if (r.status !== 200) throw new Error(r.body?.error || `Cockpit answered ${r.status}`)
      return { content: [{ type: 'text', text: JSON.stringify(r.body.output) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] }
    }
  }
  if (name !== 'show') return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] }
  try {
    const from = fromLabel()
    const entry = args.url
      ? await addLink({ url: args.url, title: args.title, note: args.note, from })
      : args.compare_with
        ? addCompare({ left: args.path, right: args.compare_with, title: args.title, note: args.note, from })
        : addShown({ ...args, from })
    const running = await ensureServer()
    const link = `http://${HOST}:${PORT}/#/shown/${entry.id}`
    const text = running
      ? `Shown in Cockpit: "${entry.title}" (${entry.format})${entry.readError ? `; the page could not be read (${entry.readError}), so only the link was kept` : ''}. Link: ${link}`
      : `Saved for Cockpit: "${entry.title}" (${entry.format}). Cockpit isn't running, so it will be there when it starts.`
    return { content: [{ type: 'text', text }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] }
  }
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.id === undefined || msg.id === null) return // notifications
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      return write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'cockpit', title: 'Cockpit', version: VERSION },
          instructions:
            "Cockpit is the user's local app for reading things. Use the show tool to put a file or a long piece of writing there instead of pasting it into the chat when it reads better as a page. " +
            'Use the snippet tool to leave something the user will copy (a command, a code snippet, a connection string), and always for a secret, key, token or password instead of writing it in the chat.',
        },
      })
    }
    if (method === 'ping') return write({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return write({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    if (method === 'tools/call') return write({ jsonrpc: '2.0', id, result: await callTool(params?.name, params?.arguments || {}) })
    if (method === 'resources/list') return write({ jsonrpc: '2.0', id, result: { resources: [] } })
    if (method === 'prompts/list') return write({ jsonrpc: '2.0', id, result: { prompts: [] } })
    write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  } catch (e) {
    write({ jsonrpc: '2.0', id, error: { code: -32603, message: e?.message || 'Internal error' } })
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', line => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const batch = Array.isArray(msg) ? msg : [msg]
    for (const m of batch) handle(m)
  })
  rl.on('close', () => process.exit(0))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
