// The words and shortcut names the page uses (web/src/platform.ts), on Windows and on a Mac. The browser's
// navigator.platform is set for each before the module is loaded.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const load = async platform => {
  Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true })
  return import(`../web/src/platform.ts?${platform}`)
}
const win = await load('Win32')
const mac = await load('MacIntel')

test('platform: Windows keeps its words and shortcuts as they are', () => {
  assert.equal(win.mac, false)
  assert.equal(win.fileManager, 'Explorer')
  assert.equal(win.terminalApp, 'Windows Terminal')
  assert.equal(win.computer, 'PC')
  for (const s of ['Ctrl Alt T', 'Ctrl+Shift+L', 'Ctrl +', 'Ctrl −', 'Ctrl Y', 'Del', 'F']) assert.equal(win.shortcut(s), s)
  assert.deepEqual(win.keyList(['Ctrl', 'Shift', 'V']), ['Ctrl', 'Shift', 'V'])
})

test('platform: a Mac says Finder and Terminal, and writes shortcuts with ⌘ ⌥ ⇧ in its own order', () => {
  assert.equal(mac.mac, true)
  assert.equal(mac.fileManager, 'Finder')
  assert.equal(mac.terminalApp, 'Terminal')
  assert.equal(mac.computer, 'Mac')
  assert.equal(mac.system, 'macOS')
  assert.equal(mac.shortcut('Ctrl K'), '⌘K')
  assert.equal(mac.shortcut('Ctrl Alt T'), '⌥⌘T')
  assert.equal(mac.shortcut('Ctrl+Alt+G'), '⌥⌘G')
  assert.equal(mac.shortcut('Ctrl+Shift+L'), '⇧⌘L')
  assert.equal(mac.shortcut('Ctrl +'), '⌘+', 'the plus key, not a joining +')
  assert.equal(mac.shortcut('Ctrl −'), '⌘−')
  assert.equal(mac.shortcut('Ctrl Y'), '⇧⌘Z', 'redo is ⇧⌘Z on a Mac')
  assert.equal(mac.shortcut('F'), 'F')
  assert.deepEqual(mac.keyList(['Ctrl', 'Shift', 'V']), ['⇧', '⌘', 'V'])
  assert.deepEqual(mac.keyList(['Alt', '1']), ['⌥', '1'])
  assert.deepEqual(mac.keyList(['Shift', 'Click']), ['⇧', 'Click'])
})

test('platform: with ⌘ and ⌥ held, the letter is the key pressed, not what Option types', () => {
  const key = (k, code, mods = {}) => ({ key: k, code, metaKey: false, altKey: false, ...mods })
  assert.equal(mac.letterOf(key('†', 'KeyT', { metaKey: true, altKey: true })), 't')
  assert.equal(mac.letterOf(key('©', 'KeyG', { metaKey: true, altKey: true })), 'g')
  assert.equal(mac.letterOf(key('K', 'KeyK', { metaKey: true })), 'k')
  // a plain letter is kept as typed: Dvorak's T is where QWERTY has K
  assert.equal(mac.letterOf(key('t', 'KeyK', { metaKey: true, altKey: true })), 't')
  assert.equal(mac.letterOf(key('¡', 'Digit1', { metaKey: true, altKey: true })), '¡', 'only letter keys are read by place')
  // Ctrl+Alt on Windows (and AltGr) is read as typed, as before
  assert.equal(win.letterOf(key('t', 'KeyT', { altKey: true })), 't')
  assert.equal(win.letterOf(key('@', 'KeyQ', { altKey: true })), '@')
})
