#!/usr/bin/env node
// Cockpit's MCP server (stdio, no dependencies): `show` puts a file or written content on Cockpit; `snippet` leaves
// something to copy (a command, a key) in its Snippets.
// It writes straight into ~/.cockpit/shown, so it works while the app is closed, and starts the app's server
// when it is not running. Only JSON-RPC goes to stdout; anything else goes to stderr.
import readline from 'node:readline'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { HOST, PORT, VERSION } from './lib/config.js'
import { FORMATS, addCompare, addLink, addShown } from './lib/shown.js'
import { addSnippetSync } from './lib/snippets.js'

const here = path.dirname(fileURLToPath(import.meta.url))

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

export async function callTool(name, args = {}) {
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
