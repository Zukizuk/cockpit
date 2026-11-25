// Browser tests: the board in Edge (the one on every Windows PC and CI runner, so nothing is downloaded), against a
// throwaway Cockpit with a board made up front. They cover what broke by hand before: pasting and Later, what an agent
// sees and changes, sticky notes rolling up, Fold all, the card menu's order and the board menu closing.
// Run with `npm run test:e2e` (after `npm run build`). Never touches the real notes, board or Claude settings.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-e2e-'))
const home = path.join(T, 'home')
const data = path.join(home, '.cockpit')
const notesDir = path.join(home, 'Documents', 'Cockpit')
const port = 4900 + Math.floor(Math.random() * 80)
const base = `http://127.0.0.1:${port}`
const H = { 'X-Cockpit': '1', 'Content-Type': 'application/json' }

let server
let browser
let page

const api = (p, init = {}) => fetch(base + p, { ...init, headers: { ...H, ...(init.headers || {}) } }).then(r => r.json())
/** One board-tool call, as Claude Code's makes it. */
const agent = (tool, input = {}) => api('/api/agent/call', { method: 'POST', body: JSON.stringify({ tool, input, agent: 'claude-code', label: 'Claude · e2e' }) })
const cardsSeen = out => (Array.isArray(out.output) ? out.output : []).filter(c => c.component === 'card').map(c => c.label).sort()
const note = title => page.locator('.react-flow__node-note', { hasText: title }).first()
const height = async loc => Math.round((await loc.boundingBox()).height)
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await check()
    if (v || Date.now() > end) return v
    await new Promise(r => setTimeout(r, 100))
  }
}

function seed() {
  const sticky = (name, text) => fs.writeFileSync(path.join(notesDir, 'stickies', name), text)
  fs.mkdirSync(path.join(notesDir, 'stickies'), { recursive: true })
  fs.mkdirSync(data, { recursive: true })
  sticky('shared.md', 'Shared plan\n\nthe first line of the plan\n')
  sticky('private.md', 'Private diary\n\nnot for agents\n')
  sticky('plain.md', 'Plain list\n\neggs\n')
  const n = (id, ref, x, y, extra = {}) => ({ id, type: 'note', ref, x, y, w: 300, h: 280, ...extra })
  const board = {
    cards: [
      n('shared', 'stickies/shared.md', 0, 0, { agents: 'shared' }),
      n('private', 'stickies/private.md', 340, 0, { agents: 'private' }),
      n('plain', 'stickies/plain.md', 680, 0),
      { id: 'later', type: 'later', ref: 'later', x: 0, y: 330, w: 440, h: 360 },
      { id: 'away', type: 'snippets', ref: 'snippets', x: 0, y: 0, w: 380, h: 300, space: 'work' },
    ],
    viewport: { x: 40, y: 60, zoom: 1 },
    spaces: [{ id: 'main', name: 'Main' }, { id: 'work', name: 'Work' }],
    space: 'main',
  }
  fs.writeFileSync(path.join(data, 'board.json'), JSON.stringify(board))
}

before(async () => {
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) throw new Error('Build the web app first: npm run build')
  seed()
  server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    env: { ...process.env, COCKPIT_HOME: home, COCKPIT_DATA: data, COCKPIT_PORT: String(port) },
    stdio: 'ignore',
  })
  const up = await until(() => fetch(`${base}/api/health`).then(r => r.ok, () => false), 15000)
  assert.ok(up, 'the server started')
  browser = await chromium.launch({ channel: 'msedge' })
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', e => console.log('page error:', e.message))
  await page.goto(base + '/')
  await until(async () => (await page.locator('.react-flow__node').count()) >= 4, 15000)
  await page.waitForTimeout(800)
})

after(async () => {
  await browser?.close()
  server?.kill()
  fs.rmSync(T, { recursive: true, force: true })
})

/** A spot of empty board: right of the cards, above the dock and the zoom buttons. */
const EMPTY = { x: 1200, y: 450 }
/** A click there: nothing selected. */
const clearSelection = async () => {
  await page.keyboard.press('Escape')
  await page.mouse.click(EMPTY.x, EMPTY.y)
  await page.waitForTimeout(250)
}

test('agents see only what is shared or selected; read gives one card; a private card never shows', async () => {
  await clearSelection()
  assert.deepEqual(cardsSeen(await agent('snapshot')), ['Shared plan'], 'only the shared card')
  const snap = await agent('snapshot')
  const board = snap.output.find(c => c.component === 'board')
  assert.match(board.value.sharing, /only what the user shares/)
  const shared = snap.output.find(c => c.label === 'Shared plan')
  assert.equal(shared.value.text, undefined, 'the overview has no contents')

  // on the paper, not the strip (its title button keeps the click, to rename)
  await note('Plain list').click({ position: { x: 150, y: 200 } })
  await page.waitForTimeout(300)
  assert.deepEqual(cardsSeen(await agent('snapshot')), ['Plain list', 'Shared plan'], 'a selected card shows')
  await clearSelection()

  const read = await agent('act', { steps: [{ ref: 'Shared plan', action: 'read' }] })
  assert.match(read.output.steps[0].result.text, /first line of the plan/)
  const priv = await agent('act', { steps: [{ ref: 'Private diary', action: 'read' }] })
  assert.equal(priv.output.ok, false)
  assert.deepEqual(cardsSeen(await agent('query', { text: 'Private' })), [])
})

test('an agent adds to a shared note and it shows at once; a rewrite waits for Allow', async () => {
  const line = `added ${Date.now()}`
  const added = await agent('act', { steps: [{ ref: 'Shared plan', action: 'append', args: [line] }] })
  assert.equal(added.output.steps[0].result, 'done')
  assert.ok(await until(async () => (await note(line).count()) > 0), 'the card shows it without a reload')

  const rewrite = agent('act', { steps: [{ ref: 'Shared plan', action: 'setText', args: ['Shared plan\n\nrewritten'] }] })
  const allow = page.getByRole('button', { name: 'Allow' })
  assert.ok(await until(async () => (await allow.count()) > 0), 'the Allow toast')
  await allow.click()
  assert.equal((await rewrite).output.ok, true)
  assert.match(fs.readFileSync(path.join(notesDir, 'stickies', 'shared.md'), 'utf8'), /rewritten/)
})

test('a sticky note rolls up into its strip and back; Fold all leaves sticky notes and other spaces be', async () => {
  await clearSelection()
  const n = note('Plain list')
  const open = await height(n)
  await n.hover()
  await n.getByRole('button', { name: 'Roll up into its strip (F)' }).click()
  assert.ok(await until(async () => (await height(n)) === 36), 'rolled to its strip')
  await n.hover()
  await n.getByRole('button', { name: 'Unroll' }).click()
  assert.ok(await until(async () => (await height(n)) === open), 'unrolled')

  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Fold all cards', exact: true }).click()
  await page.waitForTimeout(1500) // the board is saved a moment after a change
  const b = await api('/api/board')
  const folded = id => !!b.cards.find(c => c.id === id).folded
  assert.equal(folded('later'), true, 'Later folded')
  assert.equal(folded('plain'), false, 'a sticky note left as it is')
  assert.equal(folded('away'), false, "a card in another space left as it is")
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Unfold all cards', exact: true }).click()
})

test("a card's menu: what it does first, then view, lock, agents, spaces, and Remove from board last", async () => {
  await clearSelection()
  const box = await note('Shared plan').boundingBox()
  await page.mouse.click(box.x + 60, box.y + 12, { button: 'right' })
  const menu = page.locator('[role=menu]').last()
  await menu.waitFor()
  const labels = (await menu.locator('[role=menuitem]').allInnerTexts()).map(t => t.split('\n')[0]).filter(Boolean)
  await page.keyboard.press('Escape')
  const at = l => labels.findIndex(x => x.startsWith(l))
  const order = ['Open full screen', 'Comment', 'Roll up into its strip', 'Lock in place', 'Stop sharing with agents', 'Move to Work', 'Remove from board']
  for (const l of order) assert.ok(at(l) >= 0, `${l} is in the menu`)
  assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order, 'in this order')
  assert.equal(labels.at(-1), 'Remove from board')
})

test('the board menu closes where it was opened, not at the top-left corner', async () => {
  await clearSelection()
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' })
  await page.locator('[role=menu]').last().waitFor()
  await page.keyboard.press('Escape')
  const anchor = await page.locator('span.fixed.size-px').first().evaluate(el => ({ left: el.style.left, top: el.style.top }))
  assert.deepEqual(anchor, { left: `${EMPTY.x}px`, top: `${EMPTY.y}px` })
})

// last: a pasted card lands where the mouse is, on the empty spot the other tests use
test('pasting: a link becomes a card, Ctrl+Shift+V keeps one on Later, a short password goes to Snippets', async () => {
  await clearSelection()
  const paste = text =>
    page.evaluate(t => {
      const dt = new DataTransfer()
      dt.setData('text/plain', t)
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    }, text)
  const items = () => page.locator('.react-flow__node-item').count()

  const n0 = await items()
  await paste(`${base}/api/health?card`)
  assert.ok(await until(async () => (await items()) === n0 + 1, 15000), 'a card')

  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyV')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await paste(`${base}/api/health?later`)
  const kept = await until(async () => (await api('/api/shown')).find(e => /later$/.test(e.url || '') && e.later === 'todo'))
  assert.ok(kept, 'kept on Later')
  assert.equal(await items(), n0 + 1, 'no card for it')

  await paste('nkC6Hsyvm8UnRe')
  const secret = await until(async () => (await api('/api/snippets')).find(s => s.secret))
  assert.ok(secret, 'kept in Snippets as a secret')
})
