// Server tests: everything runs against a temporary home folder, never the real notes, hub or transcripts.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-unit-'))
process.env.COCKPIT_HOME = T
process.env.COCKPIT_DATA = path.join(T, 'data')

const { loadConfig } = await import('../server/lib/config.js')
const { checkApiRequest } = await import('../server/lib/security.js')
const { detect, macOpenArgs } = await import('../server/lib/files.js')
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

test('extras: off until turned on, one at a time, nothing else accepted', async () => {
  const { saveConfig, loadConfig: load } = await import('../server/lib/config.js')
  assert.deepEqual(load().extras, { dictionary: false, tables: false, journal: false })
  assert.deepEqual(saveConfig({ extras: { dictionary: true } }).extras, { dictionary: true, tables: false, journal: false })
  assert.deepEqual(saveConfig({ extras: { tables: true } }).extras, { dictionary: true, tables: true, journal: false }, 'turning one on leaves the other')
  assert.throws(() => saveConfig({ extras: { calculator: true } }), /extras/)
  assert.throws(() => saveConfig({ extras: { tables: 'yes' } }), /extras/)
  saveConfig({ extras: { dictionary: false, tables: false } })
})

test('journal extra: off for a new install, kept on for someone who already writes one, decided once', async () => {
  const { settleJournalExtra, saveConfig, loadConfig: load, readRawConfig, CONFIG_FILE } = await import('../server/lib/config.js')
  const strip = () => {
    const raw = readRawConfig()
    delete raw.extras?.journal
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw))
  }
  const dir = path.join(load().notesDir, 'journal')
  fs.rmSync(dir, { recursive: true, force: true })
  strip()
  assert.equal(settleJournalExtra(), false, 'nothing written yet: off')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-11-20.md'), '# Friday\n')
  assert.equal(settleJournalExtra(), false, 'already decided: a page written later does not turn it on by itself')
  strip()
  assert.equal(settleJournalExtra(), true, 'pages there before the update: kept on')
  assert.equal(load().extras.journal, true)
  saveConfig({ extras: { journal: false } })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('claude link: finds an executable on PATH before trying install folders', { skip: process.platform === 'win32' }, async t => {
  const { findClaude } = await import('../server/lib/claude-link.js')
  const home = path.join(T, "claude user's home")
  const first = path.join(home, 'first')
  const second = path.join(home, 'second')
  const env = { HOME: home, PATH: [first, second].join(path.delimiter) }
  const make = (dir, mode = 0o755) => {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'claude')
    fs.writeFileSync(file, '#!/bin/sh\n', { mode })
    return file
  }
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const native = make(path.join(home, '.local', 'bin'))
  const legacy = make(path.join(home, '.claude', 'local'))
  const blocked = make(first, 0o644)
  const onPath = make(second)

  assert.equal(await findClaude(env), onPath)
  fs.chmodSync(blocked, 0o755)
  assert.equal(await findClaude(env), blocked)
  fs.unlinkSync(blocked)
  fs.mkdirSync(blocked)
  fs.unlinkSync(onPath)
  assert.equal(await findClaude(env), native)
  fs.unlinkSync(native)
  assert.equal(await findClaude(env), legacy)
})

test('claude link: Settings connects using the Claude command outside PATH', { skip: process.platform === 'win32' }, t => {
  const home = fs.mkdtempSync(path.join(T, "claude user's home-"))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const bin = path.join(home, '.local', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'claude'), '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.HOME + "/calls", process.argv.slice(2).join("\\n") + "\\n")\n', { mode: 0o755 })
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { connectClaude } from './server/lib/claude-link.js'
    console.log(JSON.stringify(await connectClaude()))
  `], {
    cwd: path.join(here, '..'), encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: home, COCKPIT_HOME: home, COCKPIT_DATA: path.join(home, 'data') },
  })
  assert.equal(child.status, 0, child.stderr)
  const link = JSON.parse(child.stdout)
  assert.equal(link.claude, true)
  assert.deepEqual(link.problems, [])
  assert.ok(link.command.startsWith("'" + bin.replace(/'/g, "'\\''") + "/claude' mcp add "))
  assert.deepEqual(fs.readFileSync(path.join(home, 'calls'), 'utf8').trimEnd().split('\n'), [
    'mcp', 'remove', '--scope', 'user', 'cockpit',
    'mcp', 'add', '--scope', 'user', 'cockpit', '--', process.execPath, path.join(here, '..', 'server', 'mcp.js'),
  ])
})

test('claude link: says whether the Outputs hook and the board tools point at this copy', async () => {
  const { claudeLink } = await import('../server/lib/claude-link.js')
  const none = await claudeLink()
  assert.equal(none.hook, 'no')
  assert.equal(none.tools, 'no')
  fs.mkdirSync(path.join(T, '.claude'), { recursive: true })
  const hook = path.join(here, '..', 'server', 'claude', 'outputs-hook.js').replace(/\\/g, '/')
  fs.writeFileSync(path.join(T, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `"node" "${hook}"` }] }] } }))
  fs.writeFileSync(path.join(T, '.claude.json'), JSON.stringify({ mcpServers: { cockpit: { command: 'node', args: ['C:/Old/Cockpit/app/server/mcp.js'] } } }))
  const now = await claudeLink()
  assert.equal(now.hook, 'yes')
  assert.equal(now.tools, 'other', 'registered for another copy: needs connecting again')
  fs.rmSync(path.join(T, '.claude'), { recursive: true, force: true })
  fs.rmSync(path.join(T, '.claude.json'), { force: true })
})

test('dictionary: meanings offline, forms lead to their word, suggestions start with what is typed', async () => {
  const dict = await import('../server/lib/dictionary.js')
  assert.ok(dict.dictionaryInfo().words > 100000)
  const s = dict.lookup('Serendipity')
  assert.equal(s.entries[0].w, 'serendipity')
  assert.equal(s.entries[0].m[0][0], 'noun')
  assert.ok(s.entries[0].ipa, 'with a pronunciation')
  const ran = dict.lookup('ran')
  assert.deepEqual(ran.from, ['run'], 'an irregular form')
  assert.ok(dict.lookup('running').entries.some(e => e.w === 'run'), 'an ending taken off')
  assert.deepEqual(dict.lookup('children').from, ['child'])
  const good = dict.lookup('good').entries[0].m.find(([pos]) => pos === 'adjective')[1]
  assert.ok(good.some(([, , , opposite]) => opposite.includes('bad')), 'opposites')
  assert.deepEqual(dict.lookup('qwertyuiop').entries, [])
  assert.deepEqual(dict.lookup('constructor').entries[0].w, 'constructor', 'no object keys leak in')
  assert.deepEqual(dict.lookup('toString').entries, [])
  assert.ok(dict.suggest('ser').includes('service'))
  assert.deepEqual(dict.suggest('s'), [], 'two letters first')
})

test('tables: csv in the notes folder, quotes and commas kept, renamed by title, conflicts refused', async () => {
  const tables = await import('../server/lib/tables.js')
  const cfg = loadConfig()
  assert.deepEqual(tables.parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\r\n'), [['a', 'b, c', 'say "hi"'], ['1', 'two\nlines', '3']])
  const t = tables.newTable(cfg, 'Tools: compared?', [['Tool', 'Price'], ['Excel', '$'], ['Cockpit']])
  assert.equal(t.path, 'tables/Tools compared.csv', 'a name Windows allows')
  assert.deepEqual(t.rows[2], ['Cockpit', ''], 'rows made even')
  const file = path.join(cfg.notesDir, 'tables', 'Tools compared.csv')
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('﻿Tool,Price'), 'a BOM, so Excel reads UTF-8')
  assert.equal(tables.newTable(cfg, 'Tools: compared?').path, 'tables/Tools compared 2.csv', 'never over another')
  const w = tables.writeTable(cfg, t.path, [['Tool', 'Price'], ['Excel', '"$, a lot"']], t.mtime)
  assert.deepEqual(tables.readTable(cfg, t.path).rows[1], ['Excel', '"$, a lot"'])
  assert.throws(() => tables.writeTable(cfg, t.path, [['x']], w.mtime - 5000), /Changed elsewhere/)
  const r = tables.renameTable(cfg, t.path, 'Shortlist')
  assert.equal(r.path, 'tables/Shortlist.csv')
  assert.ok(!fs.existsSync(file))
  assert.throws(() => tables.readTable(cfg, '../escape.csv'), /note path|Outside/)
  assert.throws(() => tables.readTable(cfg, 'tables/x.md'), /\.csv/)
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

test('files: on a Mac, Show in Finder selects the file, Notepad is TextEdit, VS Code is found by its app id', () => {
  const f = '/Users/me/My notes/a b.md'
  assert.deepEqual(macOpenArgs(f, 'reveal'), ['-R', f])
  assert.deepEqual(macOpenArgs(f, 'notepad'), ['-e', f])
  assert.deepEqual(macOpenArgs(f, 'vscode'), ['-b', 'com.microsoft.VSCode', f])
  assert.deepEqual(macOpenArgs(f, 'default'), [f])
  assert.deepEqual(macOpenArgs(f, undefined), [f])
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
  assert.equal(stickies.length, 6)
  assert.ok(stickies.every(c => c.ref.startsWith('stickies/') && notes.readNote(cfg, c.ref).text.trim()), 'each one has words, in a real file')
  assert.ok(b.cards.some(c => c.type === 'later'))
  // they name this computer's things: Finder and ⌘K on a Mac, Explorer and Ctrl+K elsewhere
  const words = stickies.map(c => notes.readNote(cfg, c.ref).text).join('\n')
  const mac = process.platform === 'darwin'
  for (const w of mac ? ['this Mac', 'Finder', '⌘K'] : ['this PC', 'Explorer', 'Ctrl+K']) assert.ok(words.includes(w), `the notes say ${w}`)
  for (const w of mac ? ['this PC', 'Explorer', 'Ctrl+K'] : ['this Mac', 'Finder', '⌘K']) assert.ok(!words.includes(w), `and not ${w}`)
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
  const work = path.join(path.parse(T).root, 'work') // C:\work on Windows, /work elsewhere
  const lines = [
    { type: 'user', origin: { kind: 'task-notification', subkind: 'scheduled-trigger' }, cwd: work, message: { role: 'user', content: '<scheduled-task name="daily">do it</scheduled-task>' } },
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
    assert.deepEqual(list.result.tools.map(t => t.name), ['show', 'snippet', 'board_snapshot', 'board_act', 'board_query'])
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
  assert.equal(pinned.addPin({ path: xlsx.toUpperCase() }).already, true, 'file names ignore case, as on Windows and macOS')
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

test('often opened: on 3 different days lately shows it; a burst is one day; pinned, hidden, stale and What is new do not', async () => {
  const usage = await import('../server/lib/usage.js')
  const { CHANGELOG } = await import('../server/lib/config.js')
  const dir = path.join(T, 'often')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'Report.xlsx')
  fs.writeFileSync(file, 'x')
  const now = Date.UTC(2026, 10, 17, 12)
  const day = 86_400_000
  for (const t of [now - 2 * day, now - day]) usage.recordOpen({ kind: 'file', target: file, title: 'Report', where: 'outside' }, t)
  assert.equal(usage.oftenOpened(new Set(), now).length, 0, 'two days: not yet')
  usage.recordOpen({ kind: 'file', target: file.toUpperCase(), where: 'outside' }, now)
  let o = usage.oftenOpened(new Set(), now)
  assert.equal(o.length, process.platform === 'win32' ? 1 : 0, 'the same file however its path is written (Windows)')
  if (process.platform !== 'win32') return
  assert.deepEqual([o[0].title, o[0].days, o[0].inCockpit], ['Report', 3, false])

  // ten opens in one sitting are one day
  for (let i = 0; i < 10; i++) usage.recordOpen({ kind: 'note', target: 'plans' + String.fromCharCode(92) + 'q1.md', title: 'Q1', where: 'cockpit' }, now - i * 1000)
  assert.deepEqual(usage.oftenOpened(new Set(), now).map(x => x.title), ['Report'], 'a burst on one day is not "often"')
  for (const d of [3, 5]) usage.recordOpen({ kind: 'note', target: 'plans/q1.md', title: 'Q1', where: 'cockpit' }, now - d * day)
  o = usage.oftenOpened(new Set(), now)
  assert.deepEqual(o.map(x => x.title).sort(), ['Q1', 'Report'])
  assert.equal(o.find(x => x.title === 'Q1').inCockpit, true)

  // What's new and journal pages are never counted
  for (const d of [0, 1, 2]) {
    usage.recordOpen({ kind: 'file', target: CHANGELOG, where: 'cockpit' }, now - d * day)
    usage.recordOpen({ kind: 'note', target: 'journal/2026-11-17.md', where: 'cockpit' }, now - d * day)
  }
  assert.equal(usage.oftenOpened(new Set(), now).length, 2)

  assert.equal(usage.oftenOpened(new Set([usage.keyOf('note', 'plans/q1.md')]), now).length, 1, 'pinned ones are not repeated')
  usage.hide(usage.keyOf('file', file))
  assert.equal(usage.oftenOpened(new Set(), now).length, 1, 'hidden stays hidden')
  assert.equal(usage.oftenOpened(new Set(), now + 8 * day).length, 0, 'not opened for a week: it leaves')
})

/** A stand-in for the macOS Keychain, so the tests never write to the real one. */
const fakeKeychain = () => {
  const items = new Map()
  const write = (account, b64, replace) => {
    if (!replace && items.has(account)) throw new Error('The specified item already exists in the keychain.')
    items.set(account, b64)
  }
  return { items, read: account => items.get(account) ?? null, write }
}

test('snippets: copy text back, secrets encrypted and hidden, expiry, instant delete', { timeout: 60_000 }, async () => {
  const sn = await import('../server/lib/snippets.js')
  if (process.platform === 'darwin') sn.useKeychain(fakeKeychain())
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
  // the choice that set the time comes with it, so a menu can tick it
  assert.deepEqual([code.keep, secret.keep], ['forever', 'week'])
  const onDisk = fs.readFileSync(path.join(sn.snippetsDir(), `${secret.id}.json`), 'utf8')
  assert.ok(!onDisk.includes(value), 'encrypted on disk')
  assert.equal(await sn.snippetText(secret.id), value, 'and back again')
  assert.ok(!JSON.stringify(sn.listSnippets(now)).includes(value))

  assert.equal(sn.looksSecret('the quick brown fox jumps'), false)
  assert.equal(sn.looksSecret('ghp_abcdefghijklmnop1234'), true)
  assert.equal(sn.looksSecret('password: hunter2'), true)
  assert.equal(sn.looksSecret('nkC6Hsyvm8UnRe'), true, 'a short generated password')
  assert.equal(sn.looksSecret('HelloWorld2024'), false, 'words with a number on the end')
  assert.equal(sn.looksSecret('getUserById2'), false)
  assert.equal(sn.looksSecret('2026-11-24T10:00'), false, 'a date')

  const day = await sn.addSnippet({ text: 'short-lived', secret: false, keep: 'day' }, now)
  assert.equal(sn.listSnippets(now + 2 * 86_400_000).some(s => s.id === day.id), false, 'gone when its time is up')
  await sn.updateSnippet(code.id, { keep: 'day', title: 'Stop node' }, now)
  assert.equal(sn.listSnippets(now).find(s => s.id === code.id).title, 'Stop node')
  assert.equal(sn.listSnippets(now).find(s => s.id === code.id).keep, 'day', 'changed to a day')
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

test('snippets on macOS: the key is in the Keychain, not the file; a key left in the file moves there', { skip: process.platform !== 'darwin' }, async () => {
  const sn = await import('../server/lib/snippets.js')
  const keyFile = path.join(process.env.COCKPIT_DATA, 'snippets.key')
  fs.rmSync(keyFile, { force: true })
  const kc = fakeKeychain()
  sn.useKeychain(kc)
  const s = await sn.addSnippet({ text: 'first secret', secret: true })
  assert.equal(kc.items.size, 1, 'a new key goes in the Keychain')
  const kept = [...kc.items.values()][0]
  assert.equal(Buffer.from(kept, 'base64').length, 32)
  const onDisk = fs.readFileSync(keyFile, 'utf8')
  assert.ok(!onDisk.includes(kept), 'and never in the file')
  assert.equal((fs.statSync(keyFile).mode & 0o777).toString(8), '600')
  // a fresh start reads it back from the Keychain
  sn.useKeychain(kc)
  assert.equal(await sn.snippetText(s.id), 'first secret')

  // a key from before, kept in the file: moved to the Keychain, the file keeps only the note that it's there
  const old = crypto.randomBytes(32).toString('base64')
  fs.writeFileSync(keyFile, old + '\n')
  const kc2 = fakeKeychain()
  sn.useKeychain(kc2)
  const t = await sn.addSnippet({ text: 'second secret', secret: true })
  assert.deepEqual([...kc2.items.values()], [old])
  assert.ok(!fs.readFileSync(keyFile, 'utf8').includes(old), 'gone from the file')
  sn.useKeychain(kc2)
  assert.equal(await sn.snippetText(t.id), 'second secret')

  // taken out of the Keychain while secrets need it: said so, and nothing new is lost
  kc2.items.clear()
  sn.useKeychain(kc2)
  await assert.rejects(sn.addSnippet({ text: 'lost', secret: true }), /gone from the macOS Keychain/)
  // once they're deleted, a new key
  for (const x of sn.listSnippets()) if (x.secret) sn.removeSnippet(x.id)
  const u = await sn.addSnippet({ text: 'fresh start', secret: true })
  assert.equal(kc2.items.size, 1)
  assert.equal(await sn.snippetText(u.id), 'fresh start')

  // first use in two processes at once (the app and the MCP server): the one that's there already is used
  fs.rmSync(keyFile, { force: true })
  const kc3 = fakeKeychain()
  const theirs = crypto.randomBytes(32).toString('base64')
  kc3.items.set([...kc2.items.keys()][0], theirs)
  sn.useKeychain(kc3)
  await sn.addSnippet({ text: 'raced', secret: true })
  assert.deepEqual([...kc3.items.values()], [theirs], 'not replaced')

  // a damaged key file isn't sent to the Keychain
  fs.writeFileSync(keyFile, 'not a key\n')
  sn.useKeychain(fakeKeychain())
  await assert.rejects(sn.addSnippet({ text: 'x', secret: true }), /damaged/)

  // no Keychain to keep it in: the secret isn't kept rather than kept with its key in the open
  fs.rmSync(keyFile, { force: true })
  sn.useKeychain({ read: () => null, write: () => { throw new Error('The user name or passphrase you entered is not correct.') } })
  await assert.rejects(sn.addSnippet({ text: 'third secret', secret: true }), /Keychain/)
  assert.ok(!fs.existsSync(keyFile))
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
  assert.deepEqual(readBoard(), { cards: [], viewport: null, spaces: [{ id: 'main', name: 'Main' }], space: 'main', links: [], drawings: [] })
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
  // PowerShell where it's installed (always on Windows)
  const ps = runs.shells().pwsh ? 'pwsh' : 'bash'
  assert.equal(runs.guessShell('Get-ChildItem | Select-Object Name'), ps)
  assert.equal(runs.guessShell('$env:X = 1'), ps)
  const g = outputs.addOutputs({ cwd: T, items: [{ kind: 'command', label: 'echo', text: 'echo cockpit-run-ok' }, { kind: 'file', label: 'x', target: T, text: T }] })
  const [cmd, file] = g.items.map(i => i.id)
  assert.equal(runs.commandFor(g.id, cmd).cwd, T)
  assert.throws(() => runs.commandFor(g.id, file), /not a command/)
  assert.throws(() => runs.commandFor(g.id, cmd, path.join(T, 'nope')), /No folder/)
  let v = runs.startRun({ groupId: g.id, index: cmd, shell: process.platform === 'win32' ? 'pwsh' : 'bash' })
  let out = v.out
  for (let i = 0; i < 200 && v.status === 'running'; i++) {
    await new Promise(r => setTimeout(r, 100))
    v = runs.getRun(v.id, out.length)
    out += v.out
  }
  assert.equal(v.status, 'done')
  assert.match(out, /cockpit-run-ok/)
})

test('runs off Windows: the login shell, Stop ends the whole tree, Terminal opens it in its folder', { skip: process.platform === 'win32' }, async () => {
  const outputs = await import('../server/lib/outputs.js')
  const runs = await import('../server/lib/runs.js')
  const until = async (check, ms = 3000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (await check()) return true
    return false
  }
  assert.equal(runs.shells().bash, true, 'a shell is always there')
  assert.equal(runs.guessShell('ls -la | head'), 'bash')
  // a command that starts a child of its own: Stop ends both
  const pidFile = path.join(T, 'child.pid')
  const g = outputs.addOutputs({ cwd: T, items: [{ kind: 'command', text: `sleep 30 & echo $! > '${pidFile}'; wait` }, { kind: 'command', text: `echo "it's" 'a "test"'; pwd` }] })
  const [long, quoted] = g.items.map(i => i.id)
  let v = runs.startRun({ groupId: g.id, index: long })
  assert.ok(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim()), 'the child started')
  const child = Number(fs.readFileSync(pidFile, 'utf8'))
  v = runs.stopRun(v.id)
  assert.equal(v.status, 'stopped')
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  assert.ok(await until(() => !alive(child), 5000), "the shell's child is gone too")

  // Terminal: a script that goes to the folder and runs it, then leaves a shell open; nothing to quote for AppleScript
  let launched = null
  const r = runs.openInTerminal({ groupId: g.id, index: quoted }, { launch: (exe, args) => (launched = { exe, args }) })
  assert.equal(r.ok, true)
  assert.equal(launched.exe, '/usr/bin/open')
  const script = launched.args.at(-1)
  assert.deepEqual(launched.args.slice(0, -1), ['-a', 'Terminal'])
  assert.match(script, /\.command$/)
  assert.equal((fs.statSync(script).mode & 0o777).toString(8), '700')
  // run as Terminal would, less the shell it leaves open at the end: the command whole, in its folder
  // run as Terminal would, with nothing to type: the shell it leaves open ends at once. No rc files of the person
  // running the tests.
  const ran = spawnSync('/bin/sh', [script], { encoding: 'utf8', cwd: os.tmpdir(), input: '', env: { ...process.env, HOME: T, ZDOTDIR: T } })
  const out = ran.stdout + ran.stderr
  assert.equal(fs.existsSync(script), false, 'the script removes itself')
  assert.ok(out.includes(`it's a "test"`), `the command whole: ${out}`)
  assert.ok(out.includes(T), 'in its folder')

  // Terminal not there: the script doesn't stay behind
  let failed
  runs.openInTerminal({ groupId: g.id, index: quoted }, { launch: (exe, args, onError) => ((failed = args.at(-1)), onError()) })
  assert.equal(fs.existsSync(failed), false)
  fs.rmSync(script, { force: true })
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
  assert.deepEqual(Object.keys(props).sort(), ['$geoip_disable', '$process_person_profile', 'app.open', 'day', 'sticky.new', 'version', 'windows'].sort(), 'only counts, the day, the version and the Windows build')
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
  const get = async () => ((asked = true), { ok: true, json: async () => ({}) })
  await u.check({ updates: true }, { get })
  assert.equal(asked, false, 'a clone never asks GitHub by itself')
  const s = await u.check({ updates: true }, { force: true, get })
  assert.equal(asked, true, 'but does when Check now is pressed')
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

test('tasks: the list on this PC adds, ticks off, changes and removes; yesterday\'s ticked-off ones go', async () => {
  const tasks = await import('../server/lib/tasks.js')
  const a = tasks.addTask('  send the   report ', 'abc123def')
  assert.equal(a.content, 'send the report')
  assert.equal(tasks.addTask('again', 'abc123def').content, 'send the report', 'the same id is the same task (the card retries)')
  const b = tasks.addTask('call Ama')
  tasks.updateTask(a.id, { done: true }, '2026-11-19')
  assert.deepEqual(tasks.listTasks('2026-11-19').map(t => t.content), ['call Ama', 'send the report'], 'open ones first')
  assert.deepEqual(tasks.listTasks('2026-11-20').map(t => t.content), ['call Ama'], 'ticked off yesterday: cleared')
  tasks.updateTask(b.id, { content: 'call Ama at 3' })
  assert.equal(tasks.listTasks()[0].content, 'call Ama at 3')
  assert.throws(() => tasks.addTask('   '), /some words/)
  tasks.removeTask(b.id)
  assert.equal(tasks.listTasks().length, 0)
})

test('folders: a folder lists folders first, by name, without Windows clutter; a file is not a folder', async () => {
  const folders = await import('../server/lib/folders.js')
  const d = path.join(T, 'tree')
  fs.mkdirSync(path.join(d, 'b sub'), { recursive: true })
  fs.writeFileSync(path.join(d, 'file10.md'), '#')
  fs.writeFileSync(path.join(d, 'file2.xlsx'), '')
  fs.writeFileSync(path.join(d, 'desktop.ini'), '')
  fs.writeFileSync(path.join(d, '~$file2.xlsx'), '')
  const l = folders.listFolder(d)
  assert.deepEqual(l.entries.map(e => e.name), ['b sub', 'file2.xlsx', 'file10.md'])
  assert.deepEqual(l.entries.map(e => e.format), ['', 'sheet', 'markdown'])
  assert.equal(folders.isFolder(d), true)
  assert.equal(folders.isFolder(path.join(d, 'file10.md')), false)
  assert.throws(() => folders.listFolder(path.join(d, 'file10.md')), /not a folder/)
  assert.throws(() => folders.listFolder('relative'), /full path/)
})

test('trackers: a chat\'s tracker is announced once; one taken off stays off', async () => {
  const hook = await import('../server/claude/outputs-hook.js')
  const { saveConfig, loadConfig: load, DATA_DIR } = await import('../server/lib/config.js')
  const proj = path.join(T, 'proj-with-tracker')
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true })
  const file = path.join(proj, '.claude', 'tracker.json')
  fs.writeFileSync(file, JSON.stringify({ name: 'Proj', items: [{ id: 't1', type: 'todo', status: 'open', title: 'x' }] }))
  saveConfig({ trackers: [], hiddenTrackers: [] })
  assert.equal(hook.newTracker(path.join(proj, 'src'), DATA_DIR), file, 'found from a folder below it')
  saveConfig({ trackers: [file] })
  assert.equal(hook.newTracker(proj, DATA_DIR), '', 'already listed: nothing to say')
  saveConfig({ trackers: [], hiddenTrackers: [file] })
  assert.equal(hook.newTracker(proj, DATA_DIR), '', 'taken off: not added back')
  assert.equal(tracker.trackerFiles({ ...load(), trackers: [file] }, null).some(t => t.file === file), false, 'hidden wins over listed')
  saveConfig({ trackers: [], hiddenTrackers: [] })
})

test('journal notes: a page refers to notes; Kokoro gets their text at the end; it comes back as just the links', async () => {
  const sync = await import('../server/lib/journal-sync.js')
  const refs = await import('../server/lib/note-refs.js')
  const cfg = { ...loadConfig(), notesDir: path.join(T, 'jrefs') }
  fs.mkdirSync(path.join(cfg.notesDir, 'journal'), { recursive: true })
  fs.mkdirSync(path.join(cfg.notesDir, 'stickies'), { recursive: true })
  fs.writeFileSync(path.join(cfg.notesDir, 'stickies', 'a b.md'), 'pricing ideas\n- tiered')
  const page = '# Saturday, 21 November 2026\n\nThinking about [Pricing](note:stickies/a%20b.md) and [Pricing again](note:stickies/a%20b.md), [gone](note:stickies/none.md).\n'
  fs.writeFileSync(path.join(cfg.notesDir, 'journal', '2026-11-21.md'), page)
  assert.deepEqual(refs.refsIn(page).map(r => r.path), ['stickies/a b.md', 'stickies/none.md'], 'each note once, the path decoded')

  const full = refs.withNotes(cfg, page)
  assert.match(full, /---\n\nNotes referred to \(from Cockpit\)\n\n### Pricing\n\npricing ideas\n- tiered\n$/)
  assert.ok(!full.includes('### gone'), 'a note that is gone adds nothing')
  assert.equal(refs.withoutNotes(full), page, 'taken off again, the page is as written')
  assert.equal(refs.withNotes(cfg, full), full, 'never added twice')

  const kokoro = new Map()
  const call = async req => {
    if (req.op === 'list') return { entries: [...kokoro.values()] }
    return { results: req.entries.map(e => { const x = { created: '2026-11-21T09:00:00Z', ...e, id: e.id || 'k1', rev: `r${kokoro.size + 1}${Date.now()}` }; kokoro.set(x.id, x); return { status: 200, entry: x } }) }
  }
  await sync.sync(cfg, { call })
  assert.match(kokoro.get('k1').text, /### Pricing\n\npricing ideas/, 'Kokoro has the note in the entry')
  assert.equal(sync.localChanges(cfg), 0)

  // the sticky note changes: the page counts as changed and goes again
  fs.writeFileSync(path.join(cfg.notesDir, 'stickies', 'a b.md'), 'pricing ideas\n- tiered\n- per seat')
  assert.equal(sync.localChanges(cfg), 1)
  await sync.sync(cfg, { call })
  assert.match(kokoro.get('k1').text, /- per seat/)

  // edited on the phone: the page here follows, still with just the links
  kokoro.set('k1', { ...kokoro.get('k1'), text: kokoro.get('k1').text.replace('Thinking about', 'Still thinking about'), rev: 'phone' })
  await sync.sync(cfg, { call })
  const here = fs.readFileSync(path.join(cfg.notesDir, 'journal', '2026-11-21.md'), 'utf8')
  assert.match(here, /Still thinking about \[Pricing\]\(note:stickies\/a%20b\.md\)/)
  assert.ok(!here.includes('Notes referred to'), 'the copied notes stay on Kokoro')
  assert.equal(sync.localChanges(cfg), 0, 'and no echo back')
})

test('send to: a file and a folder sent with no window open come up when one connects', async () => {
  const port = 4990 + Math.floor(Math.random() * 9)
  const child = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], { env: { ...process.env, COCKPIT_PORT: String(port) }, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  const ac = new AbortController()
  try {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 100))
      if (await fetch(`${base}/api/health`).then(r => r.ok, () => false)) break
    }
    assert.equal((await fetch(`${base}/api/health`).then(r => r.json())).windows, 0)
    const dir = path.join(T, 'sent folder é')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'sent.md')
    fs.writeFileSync(file, '# Sent\n')
    const inbox = path.join(process.env.COCKPIT_DATA, 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    fs.writeFileSync(path.join(inbox, 's1.json'), JSON.stringify({ path: file, from: 'Send to' }))
    fs.writeFileSync(path.join(inbox, 's2.json'), JSON.stringify({ path: dir, from: 'Send to' }))
    let entry = null
    for (let i = 0; i < 100 && !entry; i++) {
      await new Promise(r => setTimeout(r, 100))
      entry = shown.listShown().find(e => e.path === file)
    }
    assert.ok(entry, 'the file became an item')
    await new Promise(r => setTimeout(r, 1500)) // the shown folder's watcher notices it
    // now a window connects: what was sent comes to it
    const res = await fetch(`${base}/api/events`, { signal: ac.signal })
    const reader = res.body.getReader()
    let text = ''
    const until = Date.now() + 5000
    let pending = null
    while (Date.now() < until && !(text.includes('"folder"') && text.includes(entry.id))) {
      pending ||= reader.read()
      const got = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 500))])
      if (!got) continue
      pending = null
      if (got.done) break
      text += Buffer.from(got.value).toString('utf8')
    }
    assert.match(text, /event: opened\ndata: \{"folder":/)
    assert.ok(text.includes(JSON.stringify({ id: entry.id })), 'the file comes up as its card')
    assert.ok(text.includes(JSON.stringify(dir).slice(1, -1)), 'the folder comes up as a folder card')
  } finally {
    ac.abort()
    child.kill()
  }
})

test('board tools: a call goes to the open window, its answer comes back; with no window it says so', async () => {
  const port = 4980 + Math.floor(Math.random() * 9)
  const child = spawn(process.execPath, [path.join(here, '..', 'server', 'index.js')], { env: { ...process.env, COCKPIT_PORT: String(port) }, stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  const call = body => fetch(`${base}/api/agent/call`, { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const ac = new AbortController()
  try {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 100))
      if (await fetch(`${base}/api/health`).then(r => r.ok, () => false)) break
    }
    const none = await call({ tool: 'snapshot' })
    assert.notEqual(none.status, 200)
    assert.match((await none.json()).error, /No Cockpit window is open/)

    // a window connects; it is told who it is, then gets the call and answers it
    const res = await fetch(`${base}/api/events`, { signal: ac.signal })
    const reader = res.body.getReader()
    let text = ''
    let pending = null
    const until = async (re, ms = 5000) => {
      const end = Date.now() + ms
      while (Date.now() < end && !re.test(text)) {
        pending ||= reader.read()
        const got = await Promise.race([pending, new Promise(r => setTimeout(() => r(null), 200))])
        if (!got) continue
        pending = null
        if (got.done) break
        text += Buffer.from(got.value).toString('utf8')
      }
      return text.match(re)
    }
    const hello = await until(/event: hello\ndata: (\{.*\})/)
    assert.ok(hello, 'the window is told who it is')
    const answer = call({ tool: 'act', input: { steps: [{ ref: 'Today', action: 'add', args: ['x'] }] } }).then(r => r.json())
    const asked = await until(/event: agent-call\ndata: (\{.*\})/)
    assert.ok(asked, 'the call reaches the window')
    const c = JSON.parse(asked[1])
    assert.equal(c.tool, 'act')
    assert.equal(c.client, JSON.parse(hello[1]).client)
    assert.deepEqual(c.input.steps[0].args, ['x'])
    await fetch(`${base}/api/agent/result`, { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, output: { ok: true } }) })
    assert.deepEqual(await answer, { output: { ok: true } })
    assert.equal(c.access, 'shared', "the window is told what this agent may see: only what's shared, by default")

    // each call is in the log: who, and the cards it could see (titles only)
    const seen = call({ tool: 'snapshot', agent: 'claude-code', label: 'Claude · cockpit' }).then(r => r.json())
    text = ''
    const asked2 = JSON.parse((await until(/event: agent-call\ndata: (\{.*\})/))[1])
    assert.equal(asked2.agent, 'Claude · cockpit')
    await fetch(`${base}/api/agent/result`, { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: asked2.id, output: [], saw: ['Post ideas'] }) })
    await seen
    const log = await fetch(`${base}/api/agent/log`, { headers: { 'X-Cockpit': '1' } }).then(r => r.json())
    assert.equal(log[0].agent, 'Claude · cockpit')
    assert.deepEqual(log[0].saw, ['Post ideas'])

    // turned off in Settings: refused before it reaches the window, and logged
    const { saveConfig } = await import('../server/lib/config.js')
    saveConfig({ agentAccess: { 'claude-code': 'off' } })
    const off = await call({ tool: 'snapshot', agent: 'claude-code' })
    assert.notEqual(off.status, 200)
    assert.match((await off.json()).error, /turned off agents' access/)
    const log2 = await fetch(`${base}/api/agent/log`, { headers: { 'X-Cockpit': '1' } }).then(r => r.json())
    assert.equal(log2[0].refused, 'access is off')
    saveConfig({ agentAccess: { 'claude-code': 'shared' } })

    const bad = await call({ tool: 'rm' })
    assert.notEqual(bad.status, 200)
  } finally {
    ac.abort()
    child.kill()
  }
})

test('outputs: a drawing from the chat is kept as a page and listed as that file', async () => {
  const { addOutputs } = await import('../server/lib/outputs.js')
  const code = '<div style="color:var(--text-primary)">Card menu</div>'
  const g = addOutputs({ from: 'Claude · cockpit', session: 'draw-1', items: [{ kind: 'drawing', label: 'card_menu_order', text: code }] })
  const item = g.items[0]
  assert.equal(item.kind, 'file')
  assert.equal(item.label, 'Card menu order')
  assert.equal(path.dirname(item.target), path.join(process.env.COCKPIT_DATA, 'drawings'))
  const page = fs.readFileSync(item.target, 'utf8')
  assert.ok(page.includes(code))
  assert.match(page, /--text-primary:/, "the chat's colours")
  assert.match(page, /tabler-icons/, 'its icon font')
  // sent again (the same turn twice): the same file, so the chat's group lists it once
  const again = addOutputs({ from: 'Claude · cockpit', session: 'draw-1', items: [{ kind: 'drawing', label: 'card_menu_order', text: code }] })
  assert.equal(again.items.filter(i => i.label === 'Card menu order').length, 1)
})

test('board tools: act takes steps; one step written flat is that step; none at all is an error, not an empty ok', async () => {
  const { actSteps } = await import('../server/mcp.js')
  assert.deepEqual(actSteps({ ref: 'c14', action: 'append', text: 'a line' }), { steps: [{ ref: 'c14', action: 'append', args: ['a line'] }] })
  assert.deepEqual(actSteps({ ref: 'c1', action: 'read' }), { steps: [{ ref: 'c1', action: 'read', args: [] }] })
  const ok = { steps: [{ ref: 'c1', action: 'fold' }] }
  assert.equal(actSteps(ok), ok)
  assert.throws(() => actSteps({}), /Nothing was done/)
  assert.throws(() => actSteps({ steps: [] }), /Nothing was done/)
})

test('agents: cards and spaces shared or private are kept; access is checked; the fence goes in and out', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  saveBoard({
    cards: [{ id: 'a', type: 'note', ref: 'n.md', agents: 'shared' }, { id: 'b', type: 'note', ref: 'm.md', agents: 'private' }, { id: 'c', type: 'note', ref: 'o.md', agents: 'yes' }],
    viewport: null,
    spaces: [{ id: 'main', name: 'Main', agents: 'private' }, { id: 'work', name: 'Work', agents: 'shared' }, { id: 'home', name: 'Home', agents: 'all' }],
  })
  const b = readBoard()
  assert.deepEqual(b.cards.map(c => c.agents), ['shared', 'private', undefined], 'only shared or private')
  assert.deepEqual(b.spaces.map(s => s.agents), ['private', 'shared', undefined])

  const { saveConfig, loadConfig: load } = await import('../server/lib/config.js')
  assert.deepEqual(load().agentAccess, { 'claude-code': 'shared', other: 'shared' }, "only what's shared, by default")
  assert.equal(saveConfig({ agentAccess: { other: 'off' } }).agentAccess.other, 'off')
  assert.equal(load().agentAccess['claude-code'], 'shared', 'one agent at a time')
  assert.throws(() => saveConfig({ agentAccess: { other: 'some' } }), /agentAccess/)
  assert.throws(() => saveConfig({ agentAccess: { codex: 'all' } }), /agentAccess/)
  saveConfig({ agentAccess: { other: 'shared' } })

  const link = await import('../server/lib/claude-link.js')
  if (process.platform === 'win32') assert.equal(link.rulePath('C:\\Users\\me\\Documents\\Cockpit'), '//c/Users/me/Documents/Cockpit')
  else assert.equal(link.rulePath('/Users/me/Documents/Cockpit'), '//Users/me/Documents/Cockpit')
  // Claude Code's settings in the temporary home: the user's own rules stay, Cockpit's go in and out
  const settings = path.join(T, '.claude', 'settings.json')
  fs.mkdirSync(path.dirname(settings), { recursive: true })
  fs.writeFileSync(settings, JSON.stringify({ permissions: { deny: ['Bash(rm *)'] }, hooks: {} }))
  const cfg = load()
  link.applyFence(cfg, true)
  const deny = JSON.parse(fs.readFileSync(settings, 'utf8')).permissions.deny
  assert.equal(deny[0], 'Bash(rm *)')
  assert.deepEqual(deny.slice(1), link.fenceRules(cfg))
  assert.ok(deny.slice(1).every(r => /^Read\(\/\/.*\/\*\*\)$/.test(r)), 'Read(//c/…/**) rules')
  assert.equal(link.fenceState(cfg), 'yes')
  link.applyFence(cfg, true)
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).permissions.deny.length, 3, 'not added twice')
  link.applyFence(cfg, false)
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')).permissions, { deny: ['Bash(rm *)'] })
  assert.equal(link.fenceState(cfg), 'no')
  fs.rmSync(path.join(T, '.claude'), { recursive: true, force: true })
})

test('spaces: kept with the board, each card in one; a card whose space is gone goes back to Main', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  saveBoard({
    cards: [{ id: 'a', type: 'note', ref: 'n.md' }, { id: 'b', type: 'note', ref: 'm.md', space: 'launch' }, { id: 'c', type: 'note', ref: 'o.md', space: 'gone' }],
    viewport: null,
    spaces: [{ id: 'main', name: 'Home' }, { id: 'launch', name: 'Launch', viewport: { x: 5, y: 6, zoom: 2 } }, { id: 'BAD ID', name: 'x' }],
    space: 'launch',
  })
  const b = readBoard()
  assert.deepEqual(b.spaces.map(s => s.name), ['Home', 'Launch'])
  assert.deepEqual(b.spaces[1].viewport, { x: 5, y: 6, zoom: 2 })
  assert.equal(b.space, 'launch')
  assert.equal(b.cards.find(c => c.id === 'a').space, undefined)
  assert.equal(b.cards.find(c => c.id === 'b').space, 'launch')
  assert.equal(b.cards.find(c => c.id === 'c').space, undefined, 'a space that is gone: Main')
  saveBoard({ cards: [], viewport: null, space: 'nowhere' })
  assert.equal(readBoard().space, 'main')
})

test('arrows: kept with the board; one whose card is gone, to itself, or a second with the same id is dropped', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  const r = saveBoard({
    cards: [{ id: 'a', type: 'note', ref: 'n.md' }, { id: 'b', type: 'note', ref: 'm.md' }],
    viewport: null,
    links: [
      { id: 'l1', from: 'a', to: 'b', label: '  feeds  ', dash: true, heads: 'both', fromSide: 'right', toSide: 'nowhere', extra: 'x' },
      { id: 'l1', from: 'b', to: 'a' },
      { id: 'l2', from: 'a', to: 'gone' },
      { id: 'l3', from: 'a', to: 'a' },
      { id: 'l4', from: 'b', to: 'a', heads: 'sideways', dash: 'yes', label: '' },
      null,
    ],
  })
  assert.equal(r.links, 2)
  assert.deepEqual(readBoard().links, [
    { id: 'l1', from: 'a', to: 'b', fromSide: 'right', label: 'feeds', dash: true, heads: 'both' },
    { id: 'l4', from: 'b', to: 'a' },
  ])
  // a card taken off takes its arrows with it
  saveBoard({ cards: [{ id: 'a', type: 'note', ref: 'n.md' }], viewport: null, links: readBoard().links })
  assert.deepEqual(readBoard().links, [])
})

test('sections: kept with the board with their title; a title on anything else is dropped', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  saveBoard({
    cards: [
      { id: 's', type: 'section', ref: 's', x: -40, y: -40, w: 700, h: 400, title: '  Launch plan  ', color: 'green' },
      { id: 'u', type: 'section', ref: 'u', x: 0, y: 500, w: 300, h: 200, title: '   ' },
      { id: 'n', type: 'note', ref: 'n.md', title: 'not for notes' },
    ],
    viewport: null,
  })
  const [s, u, n] = readBoard().cards
  assert.deepEqual([s.type, s.title, s.color, s.w, s.h], ['section', 'Launch plan', 'green', 700, 400])
  assert.equal(u.title, undefined, 'an empty title is no title')
  assert.equal(n.title, undefined)
})

test('a folded or tucked section holds its cards; a card held by one gone or open is let go', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  saveBoard({
    cards: [
      { id: 'f', type: 'section', ref: 'f', x: 0, y: 0, w: 700, h: 400, folded: true },
      { id: 't', type: 'section', ref: 't', x: 0, y: 900, w: 700, h: 400, tucked: true },
      { id: 'o', type: 'section', ref: 'o', x: 0, y: 1800, w: 700, h: 400 },
      { id: 'a', type: 'note', ref: 'a.md', inside: 'f' },
      { id: 'b', type: 'note', ref: 'b.md', inside: 't' },
      { id: 'c', type: 'note', ref: 'c.md', inside: 'o' },
      { id: 'd', type: 'note', ref: 'd.md', inside: 'gone' },
      { id: 'e', type: 'note', ref: 'e.md', inside: 'a' },
      { id: 'g', type: 'note', ref: 'g.md', inside: 'g' },
    ],
    viewport: null,
  })
  const by = Object.fromEntries(readBoard().cards.map(c => [c.id, c.inside]))
  assert.deepEqual(by, { f: undefined, t: undefined, o: undefined, a: 'f', b: 't', c: undefined, d: undefined, e: undefined, g: undefined })
})

test('the shelf: kept on a tucked card with its days; dropped from one not tucked or not a time', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  saveBoard({
    cards: [
      { id: 'a', type: 'note', ref: 'a.md', tucked: true, shelf: { at: 1000.4, until: 5000 } },
      { id: 'b', type: 'note', ref: 'b.md', tucked: true, shelf: { at: 1000 } },
      { id: 'c', type: 'note', ref: 'c.md', shelf: { at: 1000 } },
      { id: 'd', type: 'note', ref: 'd.md', tucked: true, shelf: { at: 'soon', until: 5 } },
    ],
    viewport: null,
  })
  const by = Object.fromEntries(readBoard().cards.map(c => [c.id, c.shelf]))
  assert.deepEqual(by, { a: { at: 1000, until: 5000 }, b: { at: 1000 }, c: undefined, d: undefined })
})

test('questions: asked with a guess, answered, the answer taken back, asked again, taken away', async () => {
  const q = await import('../server/lib/questions.js')
  const a = q.askQuestion({ question: ' How many are coming? ', guess: 'About 25', about: 'Launch plan', by: 'Claude' })
  assert.deepEqual([a.question, a.guess, a.about, a.by, a.answer], ['How many are coming?', 'About 25', 'Launch plan', 'Claude', undefined])
  assert.throws(() => q.askQuestion({ question: '  ' }), /Write the question/)
  // the same open question again: the one there stands, with the new guess
  const again = q.askQuestion({ question: 'how many are coming?', guess: 'About 30' })
  assert.equal(again.id, a.id)
  assert.equal(q.listQuestions().length, 1)
  assert.equal(q.listQuestions()[0].guess, 'About 30')
  const answered = q.answerQuestion(a.id, ' 40 ')
  assert.equal(answered.answer, '40')
  assert.ok(answered.answeredAt)
  const back = q.answerQuestion(a.id, '')
  assert.equal(back.answer, undefined, 'an empty answer opens it again')
  assert.equal(back.answeredAt, undefined)
  assert.equal(q.askQuestion({ question: 'Who?', by: 'someone' }).by, 'An agent')
  // choices: 2 to 8, no two the same; one alone is no choice
  assert.deepEqual(q.askQuestion({ question: 'Which day?', choices: ['Fri', ' fri ', 'Sat', ''] }).choices, ['Fri', 'Sat'])
  assert.equal(q.askQuestion({ question: 'Which room?', choices: ['Big'] }).choices, undefined)
  q.removeQuestion(q.listQuestions().find(x => x.question === 'Which day?').id)
  q.removeQuestion(q.listQuestions().find(x => x.question === 'Which room?').id)
  q.removeQuestion(a.id)
  assert.deepEqual(q.listQuestions().map(x => x.question), ['Who?'])
  assert.throws(() => q.removeQuestion(a.id), /gone/)
})

test('comments: a thread per card, yours and Claude\'s; one can be deleted', async () => {
  const c = await import('../server/lib/comments.js')
  const mine = c.addComment({ card: 'later-1', text: ' Read this first ' })
  const claude = c.addComment({ card: 'later-1', text: 'Done: it is short.', by: 'Claude' })
  c.addComment({ card: 'note-2', text: 'x', by: 'someone else' })
  const all = c.listComments().cards
  assert.deepEqual(all['later-1'].map(x => [x.by, x.text]), [['you', 'Read this first'], ['Claude', 'Done: it is short.']])
  assert.equal(all['note-2'][0].by, 'you', 'only you or Claude')
  assert.throws(() => c.addComment({ card: 'later-1', text: '  ' }), /Write something/)
  assert.throws(() => c.addComment({ card: '../x', text: 'a' }), /Which card/)
  c.removeComment(mine.id)
  assert.deepEqual(c.listComments().cards['later-1'].map(x => x.id), [claude.id])
  assert.throws(() => c.removeComment(mine.id), /gone/)
})

test('images drawn on: the edit shown, the first original kept, an edit of an edit replaced, back to the original, originals kept in Cockpit tidied after 30 days, yours never', () => {
  // a tiny PNG (1x1)
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const pasted = shown.pastedDir()
  fs.mkdirSync(pasted, { recursive: true })
  // one pasted into Cockpit, one from "your own folder"
  const mine = path.join(pasted, 'Pasted shot.png')
  fs.writeFileSync(mine, Buffer.from(PNG, 'base64'))
  const yoursDir = path.join(T, 'Pictures')
  fs.mkdirSync(yoursDir, { recursive: true })
  const yours = path.join(yoursDir, 'holiday.png')
  fs.writeFileSync(yours, Buffer.from(PNG, 'base64'))
  const a = shown.addShown({ path: mine })
  const b = shown.addShown({ path: yours })
  assert.equal(a.format, 'image')

  assert.throws(() => shown.saveImageEdit(a.id, { data: Buffer.from('not a png').toString('base64') }), /PNG/)
  const e1 = shown.saveImageEdit(a.id, { data: PNG }, new Date('2026-10-01T10:00:00Z'))
  assert.notEqual(e1.path, mine, 'the card shows the edit')
  assert.ok(e1.path.startsWith(pasted) && fs.existsSync(e1.path), 'kept in Cockpit')
  assert.equal(e1.original.path, mine)
  assert.equal(e1.original.cockpit, true, 'the original lives in Cockpit')
  assert.ok(fs.existsSync(mine), 'and is kept')

  const e2 = shown.saveImageEdit(a.id, { data: PNG }, new Date('2026-10-02T10:00:00Z'))
  assert.equal(e2.original.path, mine, 'still the first original')
  assert.ok(!fs.existsSync(e1.path), 'the edit before it is replaced')

  const back = shown.restoreOriginal(a.id)
  assert.equal(back.path, mine)
  assert.equal(back.original, undefined)
  assert.ok(!fs.existsSync(e2.path), 'the edit goes')
  assert.throws(() => shown.restoreOriginal(a.id), /not been edited/)

  // drawn on again, and one of yours: 31 days on, the Cockpit original goes, yours stays
  const e3 = shown.saveImageEdit(a.id, { data: PNG }, new Date('2026-10-01T10:00:00Z'))
  const y1 = shown.saveImageEdit(b.id, { data: PNG }, new Date('2026-10-01T10:00:00Z'))
  assert.equal(y1.original.cockpit, undefined, 'a picture from your own folder')
  assert.equal(shown.tidyOriginals(Date.parse('2026-10-20T10:00:00Z')), 0, 'not yet: under 30 days')
  assert.ok(shown.getShown(a.id).original)
  assert.equal(shown.tidyOriginals(Date.parse('2026-11-01T10:00:00Z')), 1)
  assert.ok(!fs.existsSync(mine), "Cockpit's original removed")
  assert.equal(shown.getShown(a.id).original, undefined, 'no going back offered')
  assert.ok(fs.existsSync(e3.path), 'the edit stays')
  assert.ok(fs.existsSync(yours), 'yours never removed')
  assert.ok(shown.getShown(b.id).original, 'and still offered')
})

test('file picker: macOS opens osascript, parses paths with spaces/quotes/non-ASCII, treats -128 as cancel, blocks overlapping dialogs', async () => {
  const { pickFiles, parseMacPaths, isMacCancel } = await import('../server/lib/pick.js')

  // pure parsing: spaces, quotes, non-ASCII, spaces around names and a line break inside one stay intact
  assert.deepEqual(
    parseMacPaths('/Users/me/My Notes.md\0/Users/me/it\'s "quoted".txt\0/Users/me/café 日本語.pdf\0/Users/me/ leading and trailing \0/Users/me/two\nlines.txt\n'),
    ['/Users/me/My Notes.md', '/Users/me/it\'s "quoted".txt', '/Users/me/café 日本語.pdf', '/Users/me/ leading and trailing ', '/Users/me/two\nlines.txt'],
  )
  assert.deepEqual(parseMacPaths(''), [])
  assert.equal(isMacCancel(new Error('Command failed'), '0:17: execution error: User cancelled. (-128)\n'), true)
  assert.equal(isMacCancel(new Error('User canceled. (-128)'), ''), true)
  assert.equal(isMacCancel(new Error('Command failed'), 'execution error: Not authorized. (-1743)\n'), false)

  // macOS happy path: invokes /usr/bin/osascript with activate + choose file + 30 min timeout
  let seen = null
  const res = await pickFiles({
    platform: 'darwin',
    run(cmd, args, opts, cb) {
      seen = { cmd, args, opts }
      cb(null, '/Users/me/café "notes".md\0/Users/me/it\'s here.txt\n', '')
    },
  })
  assert.equal(seen.cmd, '/usr/bin/osascript')
  assert.equal(seen.args[0], '-e')
  assert.match(seen.args[1], /activate/)
  assert.match(seen.args[1], /choose file with prompt "Put on the board" with multiple selections allowed/)
  assert.equal(seen.opts.timeout, 30 * 60_000)
  assert.deepEqual(res, { paths: ['/Users/me/café "notes".md', '/Users/me/it\'s here.txt'] })

  // macOS cancel (-128): resolves empty paths, not an error
  const cancelled = await pickFiles({
    platform: 'darwin',
    run(_cmd, _args, _opts, cb) {
      cb(new Error('Command failed'), '', '36:109: execution error: User canceled. (-128)\n')
    },
  })
  assert.deepEqual(cancelled, { paths: [] })

  // macOS other error: rejects with the standard message
  await assert.rejects(
    pickFiles({
      platform: 'darwin',
      run(_cmd, _args, _opts, cb) {
        cb(new Error('spawn ENOENT'), '', '')
      },
    }),
    /Couldn't open the file picker/,
  )

  // one dialog at a time: a second call while one is open returns busy without spawning again
  let calls = 0
  let finish
  const first = pickFiles({
    platform: 'darwin',
    run(_cmd, _args, _opts, cb) {
      calls++
      finish = () => cb(null, '/Users/me/one.txt\n', '')
    },
  })
  const second = await pickFiles({
    platform: 'darwin',
    run() { calls++ },
  })
  assert.deepEqual(second, { paths: [], busy: true })
  assert.equal(calls, 1)
  finish()
  assert.deepEqual(await first, { paths: ['/Users/me/one.txt'] })

  // Windows path stays unchanged
  let winCmd = null
  const winRes = await pickFiles({
    platform: 'win32',
    run(cmd, args, opts, cb) {
      winCmd = { cmd, args, opts }
      cb(null, JSON.stringify(['C:\\Users\\me\\file.txt']), '')
    },
  })
  assert.equal(winCmd.cmd, 'powershell.exe')
  assert.equal(winCmd.opts.timeout, 30 * 60_000)
  assert.deepEqual(winRes, { paths: ['C:\\Users\\me\\file.txt'] })

  // unsupported platform: clear error message
  await assert.rejects(
    pickFiles({ platform: 'linux', run() {} }),
    /not available here; paste a path instead/,
  )
})

test('drawings: kept with the board in their space; bad kinds, colours and numbers are cleaned; an old file has none', async () => {
  const { readBoard, saveBoard } = await import('../server/lib/board.js')
  const many = Array.from({ length: 2500 }, (_, i) => [i, i])
  const r = saveBoard({
    cards: [],
    viewport: null,
    spaces: [{ id: 'main', name: 'Main' }, { id: 'work', name: 'Work' }],
    drawings: [
      { id: 'd1', kind: 'pen', space: 'work', color: 'red', points: [[1.26, 2.34], [3, 'x'], [4.04, 5.55]], extra: 'x' },
      { id: 'd2', kind: 'box', space: 'main', color: 'blue', rect: { x: 10.04, y: 20.06, w: -30.25, h: 40 } },
      { id: 'd3', kind: 'circle', space: 'main', color: 'red', rect: { x: 1, y: 1, w: 2, h: 2 } },
      { id: 'd4', kind: 'pen', space: 'main', color: 'pink', points: many },
      { id: 'd1', kind: 'box', space: 'main', color: 'red', rect: { x: 1, y: 1, w: 2, h: 2 } },
      { id: 'd5', kind: 'box', space: 'main', color: 'red', rect: { x: 1, y: 'a', w: 2, h: 2 } },
      { id: 'd6', kind: 'pen', space: 'gone', color: 'red', points: [[1, 1]] },
      { id: 'd7', kind: 'pen', space: 'main', color: 'red', points: [] },
      null,
    ],
  })
  assert.equal(r.drawings, 3)
  const got = readBoard().drawings
  assert.deepEqual(got[0], { id: 'd1', kind: 'pen', space: 'work', color: 'red', points: [[1.3, 2.3], [4, 5.6]] })
  assert.deepEqual(got[1], { id: 'd2', kind: 'box', space: 'main', color: 'blue', rect: { x: 10, y: 20.1, w: 30.3, h: 40 } })
  assert.equal(got[2].points.length, 2000, 'a stroke is cut to 2,000 points')
  assert.equal(got[2].color, 'ink', 'an unknown colour becomes ink')

  const lots = Array.from({ length: 1200 }, (_, i) => ({ id: `p${i}`, kind: 'pen', color: 'ink', points: [[i, i]] }))
  assert.equal(saveBoard({ cards: [], viewport: null, drawings: lots }).drawings, 1000)

  // a board file written before drawings existed
  const file = path.join(process.env.COCKPIT_DATA, 'board.json')
  fs.writeFileSync(file, JSON.stringify({ cards: [], viewport: null }))
  assert.deepEqual(readBoard().drawings, [])
})
