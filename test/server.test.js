// Server tests: everything runs against a temporary home folder, never the real notes, hub or transcripts.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-unit-'))
process.env.COCKPIT_HOME = T
process.env.COCKPIT_DATA = path.join(T, 'data')

const { loadConfig } = await import('../server/lib/config.js')
const { checkApiRequest } = await import('../server/lib/security.js')
const { detect } = await import('../server/lib/files.js')
const shown = await import('../server/lib/shown.js')
const notes = await import('../server/lib/notes.js')
const sessions = await import('../server/lib/sessions.js')
const tracker = await import('../server/lib/tracker.js')
const todoist = await import('../server/lib/todoist.js')
const { summarizeProject } = await import('../server/lib/projects.js')

const here = path.dirname(fileURLToPath(import.meta.url))
after(() => fs.rmSync(T, { recursive: true, force: true }))
const req =(headers, method = 'GET') => ({ method, headers: { host: '127.0.0.1:4790', ...headers } })

test('config: board settings are checked, kept, and have defaults', async () => {
  const { saveConfig, loadConfig: load, publicConfig } = await import('../server/lib/config.js')
  const before = load()
  assert.deepEqual([before.stickyColor, before.singleKeys, before.tidyGap], ['ink', true, 24], 'sticky notes start black')
  const after = saveConfig({ stickyColor: 'green', singleKeys: false, tidyGap: 40 })
  assert.deepEqual([after.stickyColor, after.singleKeys, after.tidyGap], ['green', false, 40])
  assert.throws(() => saveConfig({ stickyColor: 'purple' }), /stickyColor/)
  assert.throws(() => saveConfig({ tidyGap: 7 }), /tidyGap/)
  assert.throws(() => saveConfig({ singleKeys: 'no' }), /singleKeys/)
  assert.equal(before.editor, 'notepad', 'notes open in Notepad unless changed')
  assert.equal(saveConfig({ editor: 'vscode' }).editor, 'vscode')
  assert.throws(() => saveConfig({ editor: 'vim' }), /editor/)
  assert.equal(before.theme, 'system', 'follows Windows unless chosen')
  assert.equal(saveConfig({ theme: 'light' }).theme, 'light')
  assert.throws(() => saveConfig({ theme: 'blue' }), /theme/)
  assert.ok(fs.existsSync(publicConfig(after).changelog), 'the changelog is where the app looks for it')
  saveConfig({ stickyColor: 'ink', singleKeys: true, tidyGap: 24, editor: 'notepad', theme: 'system' })
})

test('security: only Cockpit itself may read or change anything', () => {
  assert.equal(checkApiRequest(req({}), 4790), null, 'a local client without browser headers')
  assert.equal(checkApiRequest(req({ host: 'evil.example:4790' }), 4790), 'host', 'DNS rebinding')
  assert.equal(checkApiRequest(req({ origin: 'https://evil.example' }), 4790), 'origin')
  assert.equal(checkApiRequest(req({ 'sec-fetch-site': 'cross-site' }), 4790), 'site')
  const own = { origin: 'http://127.0.0.1:4790', 'sec-fetch-site': 'same-origin' }
  assert.equal(checkApiRequest(req(own, 'POST'), 4790), 'header', 'a change without X-Cockpit')
  assert.equal(checkApiRequest(req({ ...own, 'x-cockpit': '1' }, 'POST'), 4790), null)
  // a shown HTML page (opaque origin) may load its own files, never change anything, and never from another host
  assert.equal(checkApiRequest(req({ origin: 'null', 'sec-fetch-site': 'cross-site' }), 4790, { looseRead: true }), null)
  assert.equal(checkApiRequest(req({ origin: 'null', 'sec-fetch-site': 'cross-site', 'x-cockpit': '1' }, 'POST'), 4790, { looseRead: true }), 'origin')
  assert.equal(checkApiRequest(req({ host: 'evil.example:4790' }), 4790, { looseRead: true }), 'host')
})

test('files: kinds by extension, and by content when there is none', () => {
  const f = (name, body = 'x') => {
    const p = path.join(T, name)
    fs.writeFileSync(p, body)
    return p
  }
  assert.deepEqual(detect(f('q.sql')), { format: 'code', language: 'sql' })
  assert.equal(detect(f('a.csv')).format, 'csv')
  assert.equal(detect(f('r.md')).format, 'markdown')
  assert.equal(detect(f('b.xlsx')).format, 'sheet')
  assert.equal(detect(f('c.pbix')).format, 'binary')
  assert.equal(detect(f('plain', 'hello')).format, 'text')
  assert.equal(detect(f('blob', Buffer.from([1, 0, 2]))).format, 'binary')
})

test('shown: files and content; a file can only reach files beside it', () => {
  const dir = path.join(T, 'docs')
  fs.mkdirSync(path.join(dir, 'img'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.md'), '# Hello\n')
  fs.writeFileSync(path.join(dir, 'img', 'x.png'), 'png')
  fs.writeFileSync(path.join(T, 'secret.txt'), 's')

  const e = shown.addShown({ path: path.join(dir, 'a.md') })
  assert.equal(e.format, 'markdown')
  assert.equal(e.title, 'a.md')
  assert.equal(shown.resolveShownFile(e, 'img/x.png'), path.join(dir, 'img', 'x.png'))
  assert.equal(shown.resolveShownFile(e, ''), e.path)
  assert.throws(() => shown.resolveShownFile(e, '../secret.txt'))
  assert.throws(() => shown.resolveShownFile(e, '..%2Fsecret.txt'))

  const c = shown.addShown({ content: '# Report\n\nbody', from: 'test' })
  assert.equal(c.title, 'Report')
  assert.equal(shown.readShown(c.id).text, '# Report\n\nbody')

  assert.throws(() => shown.addShown({}), /either a path or content/)
  assert.throws(() => shown.addShown({ path: dir }), /folder/)
  assert.throws(() => shown.addShown({ path: path.join(T, 'missing.md') }), /No file/)
  assert.throws(() => shown.getShown('../../config'))

  shown.updateShown(e.id, { hidden: true })
  assert.ok(!shown.listShown().some(x => x.id === e.id))
  assert.ok(shown.listShown({ includeHidden: true }).some(x => x.id === e.id))
})

test('notes: paths stay inside the notes folder', () => {
  const cfg = loadConfig()
  for (const bad of ['../x.md', '..\\x.md', 'C:/x.md', '/x.md', '.archive/a.md', 'journal/../../x.md', 'run.exe', ''])
    assert.throws(() => notes.resolveNote(cfg, bad), undefined, bad)
  assert.ok(notes.resolveNote(cfg, 'journal/2026-11-15.md').endsWith(path.join('journal', '2026-11-15.md')))
})

test('notes: journal, jotting, conflicts, drafts, archive', () => {
  const cfg = loadConfig()
  const at = new Date(2026, 10, 15, 9, 5)
  const rel = notes.newNote(cfg, 'journal', '', at)
  assert.equal(rel, 'journal/2026-11-15.md')
  assert.match(notes.readNote(cfg, rel).text, /^# Sunday, 15 November 2026/)
  notes.appendJournal(cfg, 'first thought', at)
  assert.match(notes.readNote(cfg, rel).text, /- 09:05 first thought\n$/)

  const loaded = notes.readNote(cfg, rel)
  const abs = notes.resolveNote(cfg, rel)
  fs.writeFileSync(abs, 'theirs')
  fs.utimesSync(abs, new Date(), new Date(Date.now() + 5000))
  const clash = notes.writeNote(cfg, rel, 'mine', loaded.mtime)
  assert.equal(clash.conflict, true, 'a file changed underneath is not overwritten')
  assert.equal(clash.text, 'theirs')
  assert.ok(!notes.writeNote(cfg, rel, 'mine', null).conflict, 'Keep mine overwrites')
  assert.equal(notes.readNote(cfg, rel).text, 'mine')

  const draft = notes.newNote(cfg, 'draft', 'Big idea', at)
  assert.equal(draft, 'drafts/2026-11-15-0905-big-idea.md')
  assert.equal(notes.newNote(cfg, 'draft', 'Big idea', at), 'drafts/2026-11-15-0905-big-idea-2.md')
  notes.archiveNote(cfg, draft)
  assert.ok(!notes.listNotes(cfg).some(n => n.path === draft))
  assert.ok(fs.existsSync(path.join(cfg.notesDir, '.archive', 'drafts', '2026-11-15-0905-big-idea.md')), 'archived, not deleted')
})

test('notes: sticky notes are called by their first line; only an empty one is ever deleted', () => {
  const cfg = loadConfig()
  const at = new Date(2026, 10, 18, 19, 4, 7)
  const blank = notes.newNote(cfg, 'sticky', '', at)
  assert.equal(blank, 'stickies/2026-11-18-190407.md')
  assert.equal(notes.readNote(cfg, blank).text, '', 'a new sticky note has no heading')
  assert.equal(notes.newNote(cfg, 'sticky', '', at), 'stickies/2026-11-18-190407-2.md', 'two in the same second get their own file')

  const filled = notes.newNote(cfg, 'sticky', '', new Date(2026, 10, 18, 19, 5), '- [ ] Call Ama about the form\nbefore Friday')
  assert.equal(notes.listNotes(cfg).find(n => n.path === filled)?.title, 'Call Ama about the form', 'named by its first line, list marks aside')
  assert.equal(notes.firstLine('---\n\n> quoted line'), 'quoted line')
  assert.equal(notes.firstLine(''), '')

  // a title given by hand is kept beside the note, never written into it
  const before = notes.readNote(cfg, filled).text
  assert.deepEqual(notes.setTitle(cfg, filled, '  Ama   form '), { path: filled, title: 'Ama form' })
  assert.equal(notes.readNote(cfg, filled).text, before, 'the file is untouched')
  const listed = notes.listNotes(cfg).find(n => n.path === filled)
  assert.deepEqual([listed?.title, listed?.given], ['Ama form', 'Ama form'])
  notes.setTitle(cfg, filled, '')
  assert.equal(notes.listNotes(cfg).find(n => n.path === filled)?.given, '', 'an empty title takes it away')
  assert.throws(() => notes.setTitle(cfg, '../x.md', 'no'), /Not a note path/)

  assert.throws(() => notes.discardEmpty(cfg, filled), /has writing in it/, 'writing is never thrown away')
  assert.ok(fs.existsSync(notes.resolveNote(cfg, filled)))
  assert.deepEqual(notes.discardEmpty(cfg, blank), { discarded: true })
  assert.ok(!fs.existsSync(notes.resolveNote(cfg, blank)), 'an empty one is just removed')
  assert.deepEqual(notes.discardEmpty(cfg, blank), { discarded: false }, 'gone already: nothing to do')
  const journal = notes.newNote(cfg, 'journal', '', at)
  assert.throws(() => notes.discardEmpty(cfg, journal), /Only sticky notes/)
})

test('board: the first launch gets welcome sticky notes, once', async () => {
  const board = await import('../server/lib/board.js')
  const { DATA_DIR } = await import('../server/lib/config.js')
  const cfg = loadConfig()
  fs.rmSync(path.join(DATA_DIR, 'board.json'), { force: true })
  assert.equal(board.hasBoard(), false)
  const b = board.welcomeBoard(cfg)
  const stickies = b.cards.filter(c => c.type === 'note')
  assert.equal(stickies.length, 4)
  assert.ok(stickies.every(c => c.ref.startsWith('stickies/') && notes.readNote(cfg, c.ref).text.trim()), 'each one has words, in a real file')
  assert.ok(b.cards.some(c => c.type === 'later'))
  assert.equal(board.hasBoard(), true, 'saved, so it only happens once')
  fs.rmSync(path.join(DATA_DIR, 'board.json'), { force: true })
})

test('sessions: whose turn it is', () => {
  const said = (tools = [], text = '') => ({ role: 'assistant', text, tools: tools.map(name => ({ name, summary: '' })) })
  assert.equal(sessions.stateOf(said([], 'done'), 60_000), 'your-turn')
  assert.equal(sessions.stateOf(said([], 'done'), 5_000), 'working', 'may still be mid-reply')
  assert.equal(sessions.stateOf(said(['AskUserQuestion']), 3_600_000), 'question')
  assert.equal(sessions.stateOf(said(['Bash']), 60_000), 'working')
  assert.equal(sessions.stateOf(said(['Bash']), 3_600_000), 'quiet')
  assert.equal(sessions.stateOf({ role: 'user', text: '[Request interrupted by user]' }, 3_600_000), 'your-turn')
})

test('sessions: reading a transcript', () => {
  const dir = path.join(T, '.claude', 'projects', 'C--work')
  fs.mkdirSync(dir, { recursive: true })
  const lines = [
    { type: 'user', origin: { kind: 'task-notification', subkind: 'scheduled-trigger' }, cwd: 'C:\\work', message: { role: 'user', content: '<scheduled-task name="daily">do it</scheduled-task>' } },
    { type: 'custom-title', customTitle: 'My chat' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Looking.' }] } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', message: { role: 'user', content: 'real question <system-reminder>noise</system-reminder>' } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Answer.' }] } },
    { type: 'assistant', isSidechain: true, message: { id: 's', content: [{ type: 'text', text: 'a sub-agent' }] } },
  ]
  fs.writeFileSync(path.join(dir, 'abc-123.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'agent-xyz.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  const cfg = loadConfig()

  const s = sessions.summarizeSession(cfg, 'C--work', 'abc-123', Date.now() + 3_600_000)
  assert.equal(s.title, 'My chat')
  assert.equal(s.automatic, true)
  assert.equal(s.state, 'your-turn')
  assert.equal(s.project, 'work')
  assert.equal(s.lastPrompt, 'real question')
  assert.deepEqual(sessions.listSessions(cfg).map(x => x.id), ['abc-123'], 'sub-agent transcripts are left out')

  const t = sessions.readTranscript(cfg, 'C--work~abc-123')
  assert.deepEqual(t.messages.map(m => m.role), ['user', 'assistant', 'tool-result', 'user', 'assistant'])
  assert.equal(t.messages[0].text, '⏰ Scheduled task: daily')
  assert.equal(t.messages[1].text, 'Looking.')
  assert.equal(t.messages[1].tools[0].summary, 'ls -la')
  assert.throws(() => sessions.readTranscript(cfg, '..~x'))
  assert.throws(() => sessions.readTranscript(cfg, 'C--work~../../x'))
})

test('trackers: open items, mine first, archived hidden, a missing file reported', () => {
  const hub = path.join(T, 'hub')
  fs.mkdirSync(hub, { recursive: true })
  fs.writeFileSync(
    path.join(hub, 'tracker.json'),
    JSON.stringify({
      name: 'Setup',
      items: [
        { id: 'C1', type: 'check', title: 'check', status: 'open' },
        { id: 'W1', type: 'waiting', title: 'wait', status: 'open', who: 'IT' },
        { id: 'T1', type: 'todo', title: 'mine', status: 'open', you: true },
        { id: 'T2', type: 'todo', title: 'old', status: 'done' },
        { id: 'T3', type: 'todo', title: 'noise', status: 'open', archived: 'not worth tracking' },
        { id: 'S1', type: 'todo', title: 'suggested', status: 'suggested' },
      ],
    }),
  )
  const all = tracker.readTrackers({ ...loadConfig(), trackers: [path.join(T, 'nowhere', 'tracker.json')] })
  const setup = all.find(t => t.name === 'Setup')
  assert.deepEqual(setup.open.map(i => i.id), ['T1', 'W1', 'C1'])
  assert.deepEqual(setup.counts, { yours: 1, todo: 1, waiting: 1, check: 1, suggested: 1 })
  assert.equal(all.find(t => !t.ok)?.error, 'not found')
})

test('todoist: tasks shaped, overdue first, calls made the documented way', async () => {
  const day = '2026-11-15'
  const t = todoist.normalizeTask({ id: 'a', content: 'Call', priority: 4, due: { date: '2026-11-15T16:00:00', string: 'today 4pm', is_recurring: true }, project_id: 'p' }, { p: 'Work' }, day)
  assert.deepEqual(
    { overdue: t.overdue, hasTime: t.due.hasTime, recurring: t.due.recurring, project: t.projectName, url: t.url },
    { overdue: false, hasTime: true, recurring: true, project: 'Work', url: 'https://app.todoist.com/app/task/a' },
  )
  assert.equal(todoist.normalizeTask({ id: 'b', content: 'Late', due: { date: '2026-11-10' } }, {}, day).overdue, true)

  const calls = []
  const ok = obj => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) })
  const fake = async (url, opts) => {
    calls.push({ url, method: opts.method, auth: opts.headers.Authorization, body: opts.body })
    if (url.includes('/tasks/filter')) {
      return ok({
        results: [
          { id: 'x', content: 'Later', priority: 1, due: { date: '2999-01-01' } },
          { id: 'y', content: 'Late', priority: 1, due: { date: '2000-01-01' } },
          { id: 'z', content: 'Done', checked: true, due: { date: '2000-01-01' } },
        ],
        next_cursor: null,
      })
    }
    if (url.includes('/projects')) return ok({ results: [], next_cursor: null })
    if (url.endsWith('/close')) return { ok: true, status: 204, text: async () => '' }
    if (url.endsWith('/tasks/quick')) return ok({ id: 'new', due: /tomorrow/.test(JSON.parse(opts.body).text) ? { date: '2999-01-01' } : null })
    if (url.endsWith('/tasks/new')) return ok({ id: 'new', due: { date: 'today' } })
    return { ok: false, status: 404, text: async () => '' }
  }
  todoist.forgetCache()
  const r = await todoist.todayTasks('tok', { force: true, fetchImpl: fake })
  assert.deepEqual(r.tasks.map(x => x.id), ['y', 'x'], 'overdue first, completed left out')
  assert.ok(calls.every(c => c.auth === 'Bearer tok'))
  assert.match(calls.find(c => c.url.includes('/tasks/filter')).url, /^https:\/\/api\.todoist\.com\/api\/v1\/tasks\/filter\?query=overdue%20%7C%20today/)
  await todoist.closeTask('tok', 'y', fake)
  assert.equal(calls.at(-1).url, 'https://api.todoist.com/api/v1/tasks/y/close')
  assert.equal(calls.at(-1).method, 'POST')
  await todoist.quickAdd('tok', 'call Andrew tomorrow 3pm p1', fake)
  assert.deepEqual(JSON.parse(calls.at(-1).body), { text: 'call Andrew tomorrow 3pm p1' }, 'its own date is kept')
  await todoist.quickAdd('tok', 'read the AI document', fake)
  assert.deepEqual([calls.at(-1).url, JSON.parse(calls.at(-1).body)], ['https://api.todoist.com/api/v1/tasks/new', { due_string: 'today' }], 'no date: today')
  await assert.rejects(todoist.closeTask('tok', 'bad id!', fake), /Not a task id/)
  assert.deepEqual(await todoist.todayTasks(''), { configured: false, tasks: [] })
})

test('projects: title, in-short line and last update read from a page', () => {
  const s = summarizeProject('<!-- picture -->\n# Acme\n## In short\nThe line.\nMore.\n\nUpdated 2026-11-05 16:46 UTC by x.\nUpdated 2026-11-06 10:00 UTC by y.\n')
  assert.deepEqual(s, { title: 'Acme', inShort: 'The line.', updated: '2026-11-06 10:00' })
})

function rpc(child) {
  let buf = ''
  const waiting = new Map()
  child.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      waiting.get(msg.id)?.(msg)
    }
  })
  return (id, method, params) =>
    new Promise(resolve => {
      waiting.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
}

test('mcp: initialize, list and show over stdio', async () => {
  const child = spawn(process.execPath, [path.join(here, '..', 'server', 'mcp.js')], {
    env: { ...process.env, COCKPIT_NO_AUTOSTART: '1', COCKPIT_PORT: '9' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const send = rpc(child)
  try {
    const init = await send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.equal(init.result.serverInfo.name, 'cockpit')
    assert.equal(init.result.protocolVersion, '2025-06-18')
    const list = await send(2, 'tools/list', {})
    assert.deepEqual(list.result.tools.map(t => t.name), ['show', 'snippet'])
    const snip = await send(6, 'tools/call', { name: 'snippet', arguments: { text: 'npm run build', title: 'Build', secret: false } })
    assert.match(snip.result.content[0].text, /Left in Cockpit's Snippets as "Build", kept until deleted/)
    const ok = await send(3, 'tools/call', { name: 'show', arguments: { content: '# Hi', title: 'Hi' } })
    assert.match(ok.result.content[0].text, /Saved for Cockpit: "Hi"/)
    const bad = await send(4, 'tools/call', { name: 'show', arguments: { path: path.join(T, 'missing.md') } })
    assert.equal(bad.result.isError, true)
    const unknown = await send(5, 'no/such', {})
    assert.equal(unknown.error.code, -32601)
  } finally {
    child.stdin.end()
    child.kill()
  }
})

test('http: health, refusals, a note made through the API, and no way out of a shown folder', async () => {
  const port = 4800 + Math.floor(Math.random() * 150)
  const child = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], {
    env: { ...process.env, COCKPIT_PORT: String(port) },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    let up = false
    for (let i = 0; i < 300 && !up; i++) { // up to 30 s: slow when the whole suite runs at once
      await new Promise(r => setTimeout(r, 100))
      up = await fetch(`${base}/api/health`).then(r => r.ok, () => false)
    }
    assert.ok(up, 'server came up')
    const noHeader = await fetch(`${base}/api/notes/new`, { method: 'POST', body: '{}' })
    assert.equal(noHeader.status, 403)
    const made = await fetch(`${base}/api/notes/new`, { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'note', title: 'From the API' }) })
    assert.deepEqual(await made.json(), { path: 'from-the-api.md' })
    const entry = shown.addShown({ content: 'x', format: 'text' })
    const escape = await fetch(`${base}/api/shown/${entry.id}/files/..%2F..%2Fconfig.json`)
    assert.equal(escape.status, 403)
    const raw = await fetch(`${base}/api/shown/${entry.id}/files/${entry.id}.txt`)
    assert.equal(raw.status, 200)
    assert.match(raw.headers.get('content-security-policy') || '', /^sandbox/)
  } finally {
    child.kill()
  }
})

const page = body => async () => ({ ok: true, status: 200, url: 'https://blog.example/post', headers: new Map([['content-type', 'text/html; charset=utf-8']]), arrayBuffer: async () => Buffer.from(body) })

test('links: a page becomes a kept article; an unreadable one keeps the link and the reason', async () => {
  const para = 'Readable sentences about a topic that go on for a while. '.repeat(12)
  const html = `<html><head><title>A post</title><meta property="og:site_name" content="Example Blog"></head><body><nav>menu</nav>
    <article><h1>A post</h1><p>${para}</p><p>${para}</p><img src="/img/a.png" srcset="//cdn.example/a2.png 2x"><a href="/next">next</a></article></body></html>`
  const e = await shown.addLink({ url: 'https://blog.example/post', from: 'test' }, page(html))
  assert.equal(e.format, 'article')
  assert.equal(e.siteName, 'Example Blog')
  assert.ok(e.words > 100)
  const text = shown.readShown(e.id).text
  assert.match(text, /src="https:\/\/blog\.example\/img\/a\.png"/, 'relative images made absolute')
  assert.match(text, /https:\/\/cdn\.example\/a2\.png 2x/, 'srcset made absolute')
  assert.doesNotMatch(text, /menu/, 'page furniture removed')

  const thin = await shown.addLink({ url: 'https://blog.example/empty' }, page('<html><body><p>hi</p></body></html>'))
  assert.equal(thin.format, 'link')
  assert.match(thin.readError, /no readable article/)
  await assert.rejects(shown.addLink({ url: 'file:///C:/x' }), /http and https/)
})

test('later: a link is kept at once and read in the background; saved again it is the same item; notes and states', async () => {
  const para = 'Readable sentences about a topic that go on for a while. '.repeat(12)
  const html = `<html><head><title>The real title</title></head><body><article><h1>The real title</h1><p>${para}</p><p>${para}</p></article></body></html>`
  const e = shown.saveForLater({ url: 'https://blog.example/saved' }, page(html))
  assert.equal(e.later, 'todo')
  assert.equal(e.format, 'link', 'saved before the page is read')
  assert.equal(e.title, 'blog.example', 'the address stands in as the title meanwhile')
  assert.ok(e.readingAt)
  let read
  for (let i = 0; i < 50 && (read = shown.getShown(e.id)).format !== 'article'; i++) await new Promise(r => setTimeout(r, 20))
  assert.equal(read.format, 'article', 'read in the background')
  assert.equal(read.title, 'The real title', "the page's title replaces the address")
  assert.equal(read.later, 'todo', 'still on the list')
  assert.equal(read.readingAt, undefined)

  shown.updateShown(e.id, { later: 'done' })
  assert.ok(shown.getShown(e.id).doneAt)
  const again = shown.saveForLater({ text: 'look at https://blog.example/saved/ later' })
  assert.equal(again.id, e.id, 'the same link (found in text, trailing slash aside) is the same item')
  assert.equal(again.later, 'todo', 'and back to To check')
  assert.equal(again.doneAt, undefined)

  const note = shown.saveForLater({ text: 'Check the form Ama sent\nbefore Friday' })
  assert.equal(note.kind, 'content')
  assert.equal(note.title, 'Check the form Ama sent')
  assert.equal(note.later, 'todo')
  assert.equal(note.seen, true)

  const named = shown.saveForLater({ url: 'https://blog.example/other', title: 'Shared title' }, async () => { throw new Error('offline') })
  assert.equal(named.title, 'Shared title', 'a title shared with the page is kept')
  for (let i = 0; i < 50 && !shown.getShown(named.id).readError; i++) await new Promise(r => setTimeout(r, 20))
  assert.match(shown.getShown(named.id).readError, /Could not reach/, 'a page that cannot be read keeps the link and the reason')

  const made = path.join(T, 'report-for-later.md')
  fs.writeFileSync(made, '# Report\n')
  const file = shown.saveForLater({ path: made })
  assert.deepEqual([file.kind, file.later, file.seen], ['file', 'todo', true], 'a file Claude made can go on the list')
  assert.equal(shown.saveForLater({ path: made }).id, file.id, 'and saving it again is the same item')

  const edited = shown.updateShown(note.id, { text: '  Check the form Ama sent today\nbefore Friday, then reply  ' })
  assert.equal(edited.title, 'Check the form Ama sent today', 'a note edited in place is named by its new first line')
  assert.equal(shown.readShown(note.id).text, 'Check the form Ama sent today\nbefore Friday, then reply')
  assert.throws(() => shown.updateShown(note.id, { text: '   ' }), /needs some words/)
  assert.throws(() => shown.updateShown(e.id, { text: 'not a note' }), /Only notes kept on Later/)

  shown.updateShown(note.id, { later: null })
  assert.equal(shown.getShown(note.id).later, undefined, 'taken off the list, still kept')
  assert.throws(() => shown.updateShown(note.id, { text: 'off the list now' }), /Only notes kept on Later/)
  assert.throws(() => shown.saveForLater({ url: 'file:///C:/x' }), /web links/)
  assert.throws(() => shown.saveForLater({}), /link or some text/)
})

test('compare: two text files side by side; refuses a missing or binary file', () => {
  const a = path.join(T, 'before.txt')
  const b = path.join(T, 'after.txt')
  fs.writeFileSync(a, 'one\ntwo\n')
  fs.writeFileSync(b, 'one\nthree\n')
  const e = shown.addCompare({ left: a, right: b })
  const r = shown.readShown(e.id)
  assert.equal(e.title, 'before.txt → after.txt')
  assert.deepEqual([r.text, r.text2], ['one\ntwo\n', 'one\nthree\n'])
  assert.throws(() => shown.addCompare({ left: a, right: path.join(T, 'nope.txt') }), /No file/)
  fs.writeFileSync(path.join(T, 'bin.dat'), Buffer.from([0, 1, 2]))
  assert.throws(() => shown.addCompare({ left: a, right: path.join(T, 'bin.dat') }), /isn't text/)
})

test('thoughts go into the journal of the day', () => {
  const cfg = loadConfig()
  const at = new Date(2026, 10, 16, 8, 30)
  const r = notes.appendJournal(cfg, 'Save links into the library', at)
  assert.equal(r.path, 'journal/2026-11-16.md')
  assert.match(notes.readNote(cfg, r.path).text, /- 08:30 Save links into the library\n$/)
  assert.throws(() => notes.appendJournal(cfg, '   '))
})

test('journal sync: pushes pages, pulls phone entries, keeps both on a clash, never deletes', async () => {
  const sync = await import('../server/lib/journal-sync.js')
  const cfg = { ...loadConfig(), notesDir: path.join(T, 'jnotes') }
  const jdir = path.join(cfg.notesDir, 'journal')
  fs.mkdirSync(jdir, { recursive: true })
  // a fake Kokoro: entries by id; a save with an old rev over a changed entry is refused, as the desk does
  const kokoro = new Map([['e1', { id: 'e1', created: '2026-11-03T21:33:49+00:00', title: '', text: 'from the phone', rev: 'r1', media: 0 }]])
  let n = 0
  const call = async req => {
    if (req.op === 'list') return { entries: [...kokoro.values()].map(e => ({ ...e })) }
    return {
      results: req.entries.map(e => {
        const cur = e.id && kokoro.get(e.id)
        if (cur && cur.rev !== e.rev && cur.text !== e.text) return { status: 409, entry: { ...cur } }
        const id = e.id || `new${++n}`
        const next = { created: '2026-11-17T09:00:00+00:00', media: 0, ...cur, id, title: e.title, text: e.text, rev: `rev-${id}-${++n}` }
        kokoro.set(id, next)
        return { status: 200, entry: { ...next } }
      }),
    }
  }
  fs.writeFileSync(path.join(jdir, '2026-11-17.md'), '# Tuesday, 17 November 2026\n\nBeen a while\n')
  fs.writeFileSync(path.join(jdir, '2026-11-18.md'), '# Wednesday, 18 November 2026\n\n') // an empty page isn't sent

  assert.equal(sync.localChanges(cfg), 1)
  let r = await sync.sync(cfg, { call })
  assert.deepEqual([r.pushed, r.pulled, r.conflicts], [1, 1, 0])
  const pulled = path.join(jdir, '2026-11-03-kokoro-e1.md')
  assert.match(fs.readFileSync(pulled, 'utf8'), /^# \w+, 3 November 2026\n\nfrom the phone\n$/)
  const mine = [...kokoro.values()].find(e => e.text === 'Been a while')
  assert.equal(mine.title, 'Tuesday, 17 November 2026')
  assert.equal(sync.localChanges(cfg), 0)

  // nothing changed: nothing sent
  r = await sync.sync(cfg, { call })
  assert.deepEqual([r.pushed, r.pulled, r.updated], [0, 0, 0])

  // edited there only: the file here follows
  kokoro.set('e1', { ...kokoro.get('e1'), text: 'from the phone, more', rev: 'r2' })
  r = await sync.sync(cfg, { call })
  assert.equal(r.updated, 1)
  assert.match(fs.readFileSync(pulled, 'utf8'), /more\n$/)

  // edited in both places: both kept
  kokoro.set('e1', { ...kokoro.get('e1'), text: 'phone edit', rev: 'r3' })
  fs.writeFileSync(pulled, '# Tuesday\n\nlaptop edit\n')
  r = await sync.sync(cfg, { call })
  assert.equal(r.conflicts, 1)
  assert.equal(kokoro.get('e1').text, 'phone edit', 'the phone edit is not overwritten')
  assert.ok([...kokoro.values()].some(e => e.text === 'laptop edit' && e.id !== 'e1'), 'ours went up as a new entry')
  assert.ok(fs.readdirSync(jdir).some(f => f !== '2026-11-03-kokoro-e1.md' && fs.readFileSync(path.join(jdir, f), 'utf8').includes('phone edit')))
  assert.equal(sync.localChanges(cfg), 0)

  // archived here: not pulled back, not deleted there
  fs.rmSync(path.join(jdir, '2026-11-17.md'))
  r = await sync.sync(cfg, { call })
  assert.equal(r.pulled, 0)
  assert.ok(!fs.existsSync(path.join(jdir, '2026-11-17.md')))
  assert.ok(kokoro.has(mine.id))
})

test('pinned: files, folders, links and notes; opened and counted; groups; never twice', async () => {
  const pinned = await import('../server/lib/pinned.js')
  const dir = path.join(T, 'pins')
  fs.mkdirSync(dir, { recursive: true })
  const xlsx = path.join(dir, 'Daily report.xlsx')
  fs.writeFileSync(xlsx, 'x')
  const f = pinned.addPin({ path: `"${xlsx}"` })
  assert.deepEqual([f.kind, f.title, f.missing], ['file', 'Daily report.xlsx', false])
  assert.equal(pinned.addPin({ path: xlsx.toUpperCase() }).already, process.platform === 'win32' ? true : undefined)
  const d = pinned.addPin({ path: dir, group: 'Work' })
  assert.equal(d.kind, 'folder')
  const l = pinned.addPin({ url: 'https://example.com/forms/daily-check' })
  assert.equal(l.title, 'example.com · daily-check')
  assert.ok(pinned.addPin({ url: 'https://example.com/forms/daily-check' }).already)
  const n = pinned.addPin({ note: 'plans/q1.md' })
  assert.deepEqual([n.kind, n.title], ['note', 'q1'])
  assert.throws(() => pinned.addPin({ url: 'javascript:alert(1)' }), /web links/)
  assert.throws(() => pinned.addPin({ path: path.join(dir, 'nope.xlsx') }), /not there/)

  const opened = []
  const fake = { openFile: (t, how) => opened.push(['file', t, how]), openLink: u => opened.push(['link', u]) }
  pinned.openPin(l.id, 'default', fake)
  pinned.openPin(l.id, 'default', fake)
  pinned.openPin(f.id, 'reveal', fake)
  assert.equal(pinned.openPin(n.id, 'default', fake).note, 'plans/q1.md', 'a note comes back for Cockpit to open')
  assert.deepEqual(opened, [['link', l.target], ['link', l.target], ['file', f.target, 'reveal']])

  const list = pinned.listPinned()
  assert.equal(list.items[0].id, l.id, 'most opened first')
  assert.deepEqual(list.groups, ['Work'])
  pinned.updatePin(f.id, { title: '  Daily  ', group: 'Work' })
  assert.deepEqual(pinned.listPinned().items.find(p => p.id === f.id).title, 'Daily')
  fs.rmSync(xlsx)
  assert.equal(pinned.listPinned().items.find(p => p.id === f.id).missing, true)
  assert.throws(() => pinned.openPin(f.id, 'default', { openFile: () => { throw Object.assign(new Error('gone'), { status: 404 }) } }), /no longer at/)
  pinned.removePin(f.id)
  assert.equal(pinned.listPinned().items.length, 3)
})

test('often opened: 3 opens in two weeks shows it, pinned or hidden does not, old opens fade', async () => {
  const usage = await import('../server/lib/usage.js')
  const dir = path.join(T, 'often')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'Report.xlsx')
  fs.writeFileSync(file, 'x')
  const now = Date.UTC(2026, 10, 17, 12)
  const day = 86_400_000
  for (const t of [now - 2 * day, now - day]) usage.recordOpen({ kind: 'file', target: file, title: 'Report', where: 'outside' }, t)
  assert.equal(usage.oftenOpened(new Set(), now).length, 0, 'two opens: not yet')
  usage.recordOpen({ kind: 'file', target: file.toUpperCase(), where: 'outside' }, now)
  let o = usage.oftenOpened(new Set(), now)
  assert.equal(o.length, process.platform === 'win32' ? 1 : 0, 'the same file however its path is written (Windows)')
  if (process.platform !== 'win32') return
  assert.deepEqual([o[0].title, o[0].opens, o[0].inCockpit], ['Report', 3, false])

  // read in Cockpit more than outside: it opens in Cockpit
  for (let i = 0; i < 4; i++) usage.recordOpen({ kind: 'note', target: 'plans\\q1.md', title: 'Q1', where: 'cockpit' }, now - i * 1000)
  o = usage.oftenOpened(new Set(), now)
  assert.deepEqual(o.map(x => x.title), ['Q1', 'Report'], 'most opened first')
  assert.equal(o[0].inCockpit, true)
  assert.equal(o[0].target, 'plans/q1.md')

  assert.equal(usage.oftenOpened(new Set([usage.keyOf('note', 'plans/q1.md')]), now).length, 1, 'pinned ones are not repeated')
  usage.hide(usage.keyOf('file', file))
  assert.equal(usage.oftenOpened(new Set(), now).length, 1, 'hidden stays hidden')
  assert.equal(usage.oftenOpened(new Set(), now + 15 * day).length, 0, 'opens older than two weeks no longer count')
})

test('snippets: copy text back, secrets encrypted and hidden, expiry, instant delete', { timeout: 60_000 }, async () => {
  const sn = await import('../server/lib/snippets.js')
  // the real clock: reading a snippet back checks its time against now, so a fixed date would expire it
  const now = Date.now()
  const code = await sn.addSnippet({ text: 'Get-Process node | Stop-Process', language: 'powershell' }, now)
  assert.deepEqual([code.secret, code.title, code.expiresAt, code.preview], [false, 'Get-Process node | Stop-Process', null, 'Get-Process node | Stop-Process'])
  assert.equal(await sn.snippetText(code.id), 'Get-Process node | Stop-Process')

  const value = 'Xq9!vT2#mLp7@Rz4$Kd8'
  const secret = await sn.addSnippet({ text: value, title: 'Dev SP secret' }, now)
  assert.equal(secret.secret, true, 'guessed from the text')
  assert.equal(secret.preview, '', 'never in the list')
  assert.equal(secret.expiresAt, now + 7 * 86_400_000, 'a week by default')
  const onDisk = fs.readFileSync(path.join(sn.snippetsDir(), `${secret.id}.json`), 'utf8')
  assert.ok(!onDisk.includes(value), 'encrypted on disk')
  assert.equal(await sn.snippetText(secret.id), value, 'and back again')
  assert.ok(!JSON.stringify(sn.listSnippets(now)).includes(value))

  assert.equal(sn.looksSecret('the quick brown fox jumps'), false)
  assert.equal(sn.looksSecret('ghp_abcdefghijklmnop1234'), true)
  assert.equal(sn.looksSecret('password: hunter2'), true)

  const day = await sn.addSnippet({ text: 'short-lived', secret: false, keep: 'day' }, now)
  assert.equal(sn.listSnippets(now + 2 * 86_400_000).some(s => s.id === day.id), false, 'gone when its time is up')
  await sn.updateSnippet(code.id, { keep: 'day', title: 'Stop node' }, now)
  assert.equal(sn.listSnippets(now).find(s => s.id === code.id).title, 'Stop node')
  // made secret afterwards: encrypted and hidden; made plain again: as it was
  await sn.updateSnippet(code.id, { secret: true }, now)
  assert.ok(!fs.readFileSync(path.join(sn.snippetsDir(), `${code.id}.json`), 'utf8').includes('Stop-Process'))
  assert.equal(sn.listSnippets(now).find(s => s.id === code.id).preview, '')
  assert.equal(await sn.snippetText(code.id), 'Get-Process node | Stop-Process')
  await sn.updateSnippet(code.id, { secret: false }, now)
  assert.equal(sn.listSnippets(now).find(s => s.id === code.id).preview, 'Get-Process node | Stop-Process')

  sn.removeSnippet(secret.id)
  assert.ok(!fs.existsSync(path.join(sn.snippetsDir(), `${secret.id}.json`)))
  await assert.rejects(sn.snippetText(secret.id), /gone/)
})

test('journal sync: when it is due', async () => {
  const sync = await import('../server/lib/journal-sync.js')
  const cfg = { ...loadConfig(), notesDir: path.join(T, 'jdue'), kokoroHost: '' }
  fs.mkdirSync(path.join(cfg.notesDir, 'journal'), { recursive: true })
  assert.equal(sync.due(cfg), '', 'off without a host')
  fs.mkdirSync(sync.KOKORO_DIR, { recursive: true })
  fs.writeFileSync(path.join(sync.KOKORO_DIR, 'key'), 'x')
  cfg.kokoroHost = 'me@host'
  const day = (h, m = 0) => new Date(2026, 10, 17, h, m)
  const st = last => ({ files: {}, gone: [], lastSync: last.getTime(), lastTry: last.getTime() })
  assert.equal(sync.due(cfg, day(14), st(day(9))), '', 'nothing changed, pulled today')
  assert.equal(sync.due(cfg, day(14), st(new Date(2026, 10, 16, 9))), 'pull', 'a day since the last pull')
  fs.writeFileSync(path.join(cfg.notesDir, 'journal', '2026-11-17.md'), '# Today\n\nsomething\n')
  assert.equal(sync.due(cfg, day(10), st(day(9))), '', 'changed, but synced an hour ago')
  assert.equal(sync.due(cfg, day(12, 5), st(day(9))), 'push', 'changed, 3 hours since')
  assert.equal(sync.due(cfg, day(23, 5), st(day(21))), 'push', 'from 23:00, before the nightly sort')
  assert.equal(sync.due(cfg, day(23, 40), st(day(23, 5))), '', 'already sent this evening')
})

test('inbox: a request file (the Claude app button) becomes an item and is removed', async () => {
  const port = 4960 + Math.floor(Math.random() * 30)
  const child = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], { env: { ...process.env, COCKPIT_PORT: String(port) }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 100))
      if (await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.ok, () => false)) break
    }
    const target = path.join(T, 'from-button.md')
    fs.writeFileSync(target, '# From the button\n')
    const req = path.join(process.env.COCKPIT_DATA, 'inbox', 'r1.json')
    fs.mkdirSync(path.dirname(req), { recursive: true })
    fs.writeFileSync(req, JSON.stringify({ path: target, from: 'Claude app' }))
    let found = null
    for (let i = 0; i < 100 && !found; i++) {
      await new Promise(r => setTimeout(r, 100))
      found = shown.listShown().find(e => e.path === target)
    }
    assert.ok(found, 'the item appeared')
    assert.equal(found.from, 'Claude app')
    assert.ok(!fs.existsSync(req), 'the request was taken')
  } finally {
    child.kill()
  }
})

test('office: Word, Excel and PowerPoint previews', async () => {
  const JSZip = (await import('jszip')).default
  const XLSX = await import('xlsx')
  const { readOffice } = await import('../server/lib/office.js')
  const dir = path.join(T, 'office')
  fs.mkdirSync(dir, { recursive: true })

  const docx = new JSZip()
  docx.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  docx.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  docx.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Word</w:t></w:r></w:p></w:body></w:document>')
  fs.writeFileSync(path.join(dir, 'a.docx'), await docx.generateAsync({ type: 'nodebuffer' }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Supplier', 'Spend'], ['Acme', 1200], ['Globex', 300]]), 'Spend')
  fs.writeFileSync(path.join(dir, 'b.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  const pptx = new JSZip()
  pptx.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>')
  pptx.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Plan &amp; </a:t></a:r><a:r><a:t>scope</a:t></a:r></a:p><a:p><a:r><a:t>Point one</a:t></a:r></a:p></p:sld>')
  fs.writeFileSync(path.join(dir, 'c.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }))

  const d = shown.addShown({ path: path.join(dir, 'a.docx') })
  const x = shown.addShown({ path: path.join(dir, 'b.xlsx') })
  const p = shown.addShown({ path: path.join(dir, 'c.pptx') })
  assert.deepEqual([d.format, x.format, p.format], ['docx', 'sheet', 'slides'])
  assert.match((await readOffice(d)).html, /<p>Hello Word<\/p>/)
  const sheets = (await readOffice(x)).sheets
  assert.equal(sheets[0].name, 'Spend')
  assert.deepEqual(sheets[0].rows, [['Supplier', 'Spend'], ['Acme', '1200'], ['Globex', '300']])
  assert.deepEqual((await readOffice(p)).slides, [{ n: 1, lines: ['Plan & scope', 'Point one'] }, { n: 2, lines: ['Second'] }])
  fs.writeFileSync(path.join(dir, 'broken.docx'), 'not a zip')
  assert.match((await readOffice(shown.addShown({ path: path.join(dir, 'broken.docx') }))).previewError, /Couldn't preview/)
})

test('shown: the same file shown again is the same item, brought back if removed', () => {
  const f = path.join(T, 'again.md')
  fs.writeFileSync(f, '# Again\n')
  const first = shown.addShown({ path: f })
  shown.updateShown(first.id, { hidden: true, seen: true })
  const second = shown.addShown({ path: f.toUpperCase(), from: 'Claude · hub' })
  assert.equal(second.id, first.id)
  assert.equal(second.hidden, false)
  assert.equal(second.seen, false)
  assert.equal(second.from, 'Claude · hub')
  assert.ok(second.shownAt >= first.shownAt)
})

test('outputs: a turn kept as one group; only listed targets can be opened', async () => {
  const outputs = await import('../server/lib/outputs.js')
  const g = outputs.addOutputs({ from: 'Claude · hub', items: [{ kind: 'file', label: 'a.md', target: 'C:/x/a.md', text: 'C:/x/a.md' }, { kind: 'bogus' }, { kind: 'link', target: 'https://example.com', text: 'https://example.com' }] })
  assert.equal(g.items.length, 2, 'unknown kinds dropped')
  assert.equal(outputs.listOutputs()[0].id, g.id)
  assert.equal(outputs.outputTarget(g.id, g.items[0].id).target, 'C:/x/a.md')
  assert.throws(() => outputs.outputTarget(g.id, 9), /Nothing to open/)
  assert.throws(() => outputs.addOutputs({ items: [] }), /Nothing/)
  outputs.updateOutputs(g.id, { hidden: true })
  assert.ok(!outputs.listOutputs().some(x => x.id === g.id))
})

test('board: cards saved and read back, bad ones dropped, sizes kept sane', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  assert.deepEqual(readBoard(), { cards: [], viewport: null })
  saveBoard({ cards: [{ id: 'a', type: 'item', ref: 'x', x: 10, y: 20, w: 50, h: 9000 }, { id: 'b', type: 'nope', ref: 'y' }], viewport: { x: 1, y: 2, zoom: 9 } })
  const b = readBoard()
  assert.deepEqual(b.cards, [{ id: 'a', type: 'item', ref: 'x', x: 10, y: 20, w: 200, h: 4000 }])
  assert.deepEqual(b.viewport, { x: 1, y: 2, zoom: 4 })
  assert.throws(() => saveBoard({}), /No cards/)

  saveBoard({
    cards: [
      { id: 's', type: 'note', ref: 'stickies/a.md', x: 0, y: 0, w: 300, h: 280, locked: true, color: 'pink' },
      { id: 't', type: 'note', ref: 'stickies/b.md', x: 0, y: 0, w: 300, h: 280, locked: 'yes', color: 'purple' },
    ],
    viewport: null,
  })
  const [locked, odd] = readBoard().cards
  assert.deepEqual([locked.locked, locked.color], [true, 'pink'], 'a card locked in place, and a sticky note\'s colour, are kept')
  assert.deepEqual([odd.locked, odd.color], [undefined, undefined], 'anything else is dropped')
})

test('runs: only an output command runs, in its folder, with its output kept', async () => {
  const outputs = await import('../server/lib/outputs.js')
  const runs = await import('../server/lib/runs.js')
  assert.equal(runs.guessShell('Get-ChildItem | Select-Object Name'), 'pwsh')
  assert.equal(runs.guessShell('$env:X = 1'), 'pwsh')
  const g = outputs.addOutputs({ cwd: T, items: [{ kind: 'command', label: 'echo', text: 'echo cockpit-run-ok' }, { kind: 'file', label: 'x', target: T, text: T }] })
  const [cmd, file] = g.items.map(i => i.id)
  assert.equal(runs.commandFor(g.id, cmd).cwd, T)
  assert.throws(() => runs.commandFor(g.id, file), /not a command/)
  assert.throws(() => runs.commandFor(g.id, cmd, path.join(T, 'nope')), /No folder/)
  let v = runs.startRun({ groupId: g.id, index: cmd, shell: 'pwsh' })
  let out = v.out
  for (let i = 0; i < 200 && v.status === 'running'; i++) {
    await new Promise(r => setTimeout(r, 100))
    v = runs.getRun(v.id, out.length)
    out += v.out
  }
  assert.equal(v.status, 'done')
  assert.match(out, /cockpit-run-ok/)
})

test('outputs: one group per chat, newest turn on top, repeats move up, rows keep their ids', async () => {
  const outputs = await import('../server/lib/outputs.js')
  const t1 = new Date('2026-11-16T10:00:00Z')
  const t2 = new Date('2026-11-16T10:05:00Z')
  const a = outputs.addOutputs({ session: 's-1', from: 'Claude · hub', items: [{ kind: 'file', target: 'C:/x/a.md', text: 'C:/x/a.md' }, { kind: 'command', text: 'echo 1' }] }, t1)
  const cmdId = a.items[1].id
  const b = outputs.addOutputs({ session: 's-1', from: 'Claude · hub', items: [{ kind: 'file', target: 'C:/x/b.md', text: 'C:/x/b.md' }, { kind: 'file', target: 'C:/X/A.md', text: 'C:/X/A.md' }] }, t2)
  assert.equal(b.id, a.id, 'the same chat keeps its group')
  assert.deepEqual(b.items.map(i => i.target || i.text), ['C:/x/b.md', 'C:/X/A.md', 'echo 1'], 'newest first, the repeat moved up, not doubled')
  assert.equal(outputs.outputItem(a.id, cmdId).text, 'echo 1', 'a row is found by its id after moving')
  assert.equal(b.seen, false)
  const other = outputs.addOutputs({ session: 's-2', items: [{ kind: 'link', target: 'https://example.com', text: 'https://example.com' }] }, t2)
  assert.notEqual(other.id, a.id, 'another chat gets its own group')
  const { cleared } = outputs.clearOutputs()
  assert.ok(cleared >= 2)
  assert.equal(outputs.listOutputs().length, 0, 'Clear all hides every group')
})

test('changes: uncommitted edits, a new file, and the last commit, the way git sees them', async (t) => {
  const { execFileSync } = await import('node:child_process')
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
  } catch {
    return t.skip('git is not installed')
  }
  const { changesForFile, countDiff } = await import('../server/lib/changes.js')
  const repo = path.join(T, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  const g = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' })
  g('init', '-q')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n')
  g('add', '.')
  g('commit', '-qm', 'first')
  const committed = await changesForFile(path.join(repo, 'a.txt'))
  assert.equal(committed.source, 'commit')
  assert.equal(committed.added, 2)
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nthree\nfour\n')
  const working = await changesForFile(path.join(repo, 'a.txt'))
  assert.equal(working.source, 'working')
  assert.deepEqual([working.added, working.removed], [2, 1])
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x\ny\n')
  const fresh = await changesForFile(path.join(repo, 'new.txt'))
  assert.deepEqual([fresh.source, fresh.added], ['untracked', 2])
  fs.writeFileSync(path.join(T, 'loose.txt'), 'z')
  assert.equal((await changesForFile(path.join(T, 'loose.txt'))).repo, false)
  assert.deepEqual(countDiff('--- a\n+++ b\n+x\n-y\n context'), { added: 1, removed: 1 })
})

test('telemetry: nothing without a key or a yes; only counts are sent, and a no forgets them', async () => {
  const t = await import('../server/lib/telemetry.js')
  const { DATA_DIR } = await import('../server/lib/config.js')
  fs.rmSync(path.join(DATA_DIR, 'telemetry.json'), { force: true })
  const day1 = new Date('2026-11-18T10:00:00Z')

  process.env.COCKPIT_TELEMETRY_KEY = ''
  assert.equal(t.status().available, false, 'no key: off, and never asks')
  t.choose('yes')
  t.count('sticky.new', day1)
  assert.deepEqual(t.readState().days, {}, 'no key: nothing counted even with a yes')

  process.env.COCKPIT_TELEMETRY_KEY = 'phc_test'
  t.choose('no')
  t.count('sticky.new', day1)
  assert.deepEqual(t.readState().days, {}, 'a no: nothing counted')
  assert.equal(t.status(Date.now()).ask, false, 'asked already')

  t.choose('yes')
  t.count('sticky.new', day1)
  t.count('sticky.new', day1)
  t.count('app.open', day1)
  t.count('app.open', day1)
  t.count('C:\Users\someone\secret.md', day1)
  assert.deepEqual(t.readState().days['2026-11-18'], { 'sticky.new': 2, 'app.open': 1 }, 'known names only; app.open once a day')

  let sent = null
  const r = await t.sendDue({ post: async (url, body) => (sent = { url, body }), at: new Date('2026-11-19T09:00:00Z') })
  assert.equal(r.sent, 1)
  assert.match(sent.url, /\/batch\/$/)
  const props = sent.body.batch[0].properties
  assert.deepEqual(Object.keys(props).sort(), ['$process_person_profile', 'app.open', 'day', 'sticky.new', 'version', 'windows'].sort(), 'only counts, the day, the version and the Windows build')
  assert.deepEqual(t.readState().days, {}, 'sent days are forgotten')
  assert.equal((await t.sendDue({ post: async () => assert.fail('nothing to send') })).sent, 0)

  t.count('later.link', new Date())
  assert.equal((await t.sendDue({ post: async () => assert.fail('today is not finished') })).sent, 0)
  t.choose('no')
  assert.deepEqual(t.readState().days, {}, 'a no forgets what was counted')
  delete process.env.COCKPIT_TELEMETRY_KEY
})

test('updates: versions compare by number; a release is read for its zip and checksum; a clone never checks', async () => {
  const u = await import('../server/lib/updates.js')
  assert.equal(u.compareVersions('0.1.10', '0.1.9'), 1)
  assert.equal(u.compareVersions('v0.2.0', '0.2.0'), 0)
  assert.equal(u.compareVersions('0.1.2', '0.1.3'), -1)
  const r = u.parseRelease({
    tag_name: 'v0.1.4',
    html_url: 'https://github.com/x/y/releases/tag/v0.1.4',
    assets: [{ name: 'Cockpit-0.1.4-win-x64.zip', browser_download_url: 'https://github.com/x/y/releases/download/v0.1.4/Cockpit-0.1.4-win-x64.zip', size: 10, digest: 'sha256:' + 'a'.repeat(64) }],
  })
  assert.deepEqual([r.version, r.size, r.sha256.length], ['0.1.4', 10, 64])
  assert.equal(u.parseRelease({ tag_name: 'v1', assets: [] }), null, 'a release without the Windows zip is no update')
  assert.equal(u.isInstalled(), false, 'the tests run from a clone')
  let asked = false
  const s = await u.check({ updates: true }, { force: true, get: async () => ((asked = true), { ok: true, json: async () => ({}) }) })
  assert.equal(asked, false, 'a clone never asks GitHub')
  assert.equal(s.available, false)
  await assert.rejects(u.apply({ updates: true }), /git pull/)
})

test('board: a copy is kept once a day, the last 14', async () => {
  const board = await import('../server/lib/board.js')
  const { DATA_DIR } = await import('../server/lib/config.js')
  const dir = path.join(DATA_DIR, 'backups')
  fs.rmSync(dir, { recursive: true, force: true })
  board.saveBoard({ cards: [], viewport: null })
  for (let d = 1; d <= 20; d++) board.backup(new Date(Date.UTC(2026, 0, d, 12)))
  const kept = fs.readdirSync(dir).sort()
  assert.equal(kept.length, 14)
  assert.ok(kept.includes('board-2026-01-20.json') && !kept.includes('board-2026-01-07.json'), 'the newest kept, the oldest gone (today\'s save made one too)')
  fs.rmSync(path.join(DATA_DIR, 'board.json'), { force: true })
})
