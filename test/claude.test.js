// The Claude Code side of Cockpit: the Outputs hook (what a turn made) and adding or removing it in settings.json.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lastTurn, run, turnItems } from '../server/claude/outputs-hook.js'
import { hasHook, withHook, withoutHook } from '../scripts/claude-setup.mjs'

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-claude-'))
const line = o => JSON.stringify(o)
const at = s => new Date(Date.now() - s * 1000).toISOString()

function transcript(file, report) {
  const lines = [
    line({ type: 'user', message: { content: 'an earlier prompt' }, timestamp: at(600) }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'C:/old/before.md' } }] }, timestamp: at(590) }),
    line({ type: 'user', message: { content: [{ type: 'text', text: 'write the report and draft the email' }] }, timestamp: at(60) }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', name: 'Write', input: { file_path: report } }] }, timestamp: at(50) }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] }, timestamp: at(49) }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] }, timestamp: at(40) }),
    line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'C:/agent/scratch.md' } }] }, timestamp: at(39) }),
    line({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Done. Here is the email:\n\n> Hi team, the report is ready. Thanks!\n\nRun it again with:\n\n```powershell\nnpm test\n```\n\nSee https://github.com/Zukizuk/cockpit for more.',
          },
        ],
      },
      timestamp: at(30),
    }),
  ]
  fs.writeFileSync(file, lines.join('\n') + '\n{"type":"assist') // a half-written last line, as while Claude is still writing
}

test('the Outputs hook reads the last turn: files written, the draft, the command and the link', async () => {
  // a real project folder: files in temp folders are scratch work, never listed
  const report = 'C:/work/acme/report.md'
  const file = path.join(T, 'chat.jsonl')
  transcript(file, report)

  const turn = lastTurn(fs.readFileSync(file, 'utf8').split('\n'))
  assert.deepEqual(turn.touched, [report], 'only this turn, only the main chat (not the earlier turn, not a subagent)')
  assert.match(turn.reply, /^Done\./, 'the reply is the text after the last tool call')

  const items = turnItems(turn, { cwd: T })
  assert.deepEqual(items.map(i => i.kind), ['draft', 'command', 'file', 'link'])
  assert.equal(items.find(i => i.kind === 'command').text, 'npm test')
  assert.match(items.find(i => i.kind === 'draft').text, /report is ready/)

  const data = path.join(T, '.cockpit')
  fs.mkdirSync(data)
  const name = await run({ transcript_path: file, session_id: 's1', cwd: 'C:/work/acme' }, { data })
  const req = JSON.parse(fs.readFileSync(path.join(data, 'inbox', name), 'utf8'))
  assert.equal(req.outputs.from, 'Claude · acme')
  assert.equal(req.outputs.session, 's1')
  assert.equal(req.outputs.items.length, 4)
  assert.deepEqual(fs.readdirSync(path.join(data, 'inbox')).filter(n => n.endsWith('.tmp')), [], 'no half-written file left')

  assert.equal(await run({ transcript_path: file }, { data: '' }), null, 'Cockpit not set up on this PC: nothing written')
})

test('Claude Code settings: Cockpit adds its own hook once and removes only that, keeping everything else', () => {
  const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [] }] } }
  const once = withHook(theirs, 'C:\\Program Files\\Cockpit\\runtime\\node.exe')
  const twice = withHook(once, 'D:\\Cockpit\\runtime\\node.exe')
  assert.ok(hasHook(twice))
  assert.equal(twice.hooks.Stop.length, 2, 'their hook and one of ours: adding again replaces, never doubles')
  assert.match(twice.hooks.Stop[1].hooks[0].command, /^"D:\/Cockpit\/runtime\/node\.exe" ".*cockpit.*outputs-hook\.js"$/i)
  const back = withoutHook(twice)
  assert.deepEqual(back, theirs, 'taking it out leaves their settings exactly as they were')
  assert.deepEqual(withoutHook({ hooks: { Stop: once.hooks.Stop.slice(1) } }), {}, 'an empty hooks block is tidied away')
  assert.equal(hasHook({}), false)
})
