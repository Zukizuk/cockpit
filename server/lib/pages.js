// Working pages: small HTML pages on the board (a checklist, a calculator, a budget splitter, a drawing from a chat)
// that keep what's typed in them. A page runs sealed off from Cockpit (a sandbox with no origin of its own), so it
// can't save anything itself: a short script put into it as it's served tells the board what's in its fields, and the
// board keeps that with the card's entry (pageState) and hands it back when the page opens again.
//
// What's kept, for any page: every input, text box, choice and checkbox (by its id, else its name, else its place),
// and anything with contenteditable. A page written for Cockpit can keep more with window.cockpit:
//   cockpit.get(key) / cockpit.set(key, value)   (a value that goes into JSON)
//   addEventListener('cockpit-ready', …)          (fired once what was kept is back in place)
import fs from 'node:fs'
import path from 'node:path'
import { UserError, writeFileAtomic } from './config.js'
import { ensureNotes, notesRoot, slug } from './notes.js'

/** The most a page may keep (its JSON). */
export const MAX_STATE = 256 * 1024
/** The most a page Claude writes may be. */
const MAX_PAGE = 2 * 1024 * 1024

/** What a page keeps, checked: a JSON object no bigger than MAX_STATE. */
export function cleanState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new UserError('A page keeps an object')
  const text = JSON.stringify(state)
  if (Buffer.byteLength(text) > MAX_STATE) throw new UserError('That page is keeping too much (over 256 KB)')
  return JSON.parse(text)
}

// Runs inside the page (no Cockpit code in reach, only messages to the board around it).
const KEEPER = `(function () {
  if (window.parent === window || window.__cockpitKeeper) return
  window.__cockpitKeeper = true
  var state = {}, ready = false, timer = 0, readyFns = []
  var SKIP = ['button', 'submit', 'reset', 'file', 'password', 'hidden', 'image']
  function fields() {
    return Array.prototype.slice.call(document.querySelectorAll('input, textarea, select, [contenteditable]')).filter(function (e) {
      if (e.hasAttribute('data-cockpit-skip')) return false
      if (e.tagName === 'INPUT' && SKIP.indexOf((e.type || '').toLowerCase()) >= 0) return false
      if (e.hasAttribute('contenteditable') && e.getAttribute('contenteditable') === 'false') return false
      return true
    })
  }
  function key(e, i) {
    if (e.id) return '#' + e.id
    if (e.name) return (e.type || '').toLowerCase() === 'radio' ? 'n:' + e.name + '=' + e.value : 'n:' + e.name
    return e.tagName.toLowerCase() + ':' + i
  }
  var editable = function (e) { return !('value' in e) || e.tagName === 'LI' }
  function read() {
    var out = {}
    for (var p in pending) out[p] = pending[p]
    fields().forEach(function (e, i) {
      var t = (e.type || '').toLowerCase()
      out[key(e, i)] = t === 'checkbox' || t === 'radio' ? e.checked : e.isContentEditable && editable(e) ? e.innerHTML : e.value
    })
    return out
  }
  function fire(e, name) { e.dispatchEvent(new Event(name, { bubbles: true })) }
  // what was kept for fields not there yet (a page that draws some later): put in as they appear, once each
  var pending = {}
  function apply(f) {
    fields().forEach(function (e, i) {
      var k = key(e, i)
      if (!(k in f)) return
      var v = f[k]
      delete pending[k]
      var t = (e.type || '').toLowerCase()
      if (t === 'checkbox' || t === 'radio') {
        if (e.checked !== !!v) { e.checked = !!v; fire(e, 'input'); fire(e, 'change') }
      } else if (e.isContentEditable && editable(e)) {
        if (e.innerHTML !== v) { e.innerHTML = v; fire(e, 'input') }
      } else if (e.value !== v) {
        e.value = v; fire(e, 'input'); fire(e, 'change')
      }
    })
  }
  function flush() {
    clearTimeout(timer)
    timer = 0
    if (!ready) return
    state.fields = read()
    parent.postMessage({ cockpitPage: 'save', state: state }, '*')
  }
  function save() {
    clearTimeout(timer)
    timer = setTimeout(flush, 300)
  }
  // going away (the board reloads, the card is closed): what's waiting is sent now
  addEventListener('pagehide', function () { if (timer) flush() })
  window.cockpit = {
    get: function (k) { return (state.data || {})[k] },
    set: function (k, v) { state.data = state.data || {}; state.data[k] = v; save() },
    onReady: function (fn) { ready ? fn() : readyFns.push(fn) },
  }
  addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.cockpitPage !== 'state' || ready) return
    state = e.data.state && typeof e.data.state === 'object' ? e.data.state : {}
    if (state.fields) {
      for (var k in state.fields) pending[k] = state.fields[k]
      apply(state.fields)
      if (window.MutationObserver) {
        var seen = new MutationObserver(function () {
          if (!Object.keys(pending).length) return seen.disconnect()
          apply(pending)
        })
        seen.observe(document.documentElement, { childList: true, subtree: true })
      }
    }
    ready = true
    readyFns.splice(0).forEach(function (fn) { try { fn() } catch (err) {} })
    dispatchEvent(new Event('cockpit-ready'))
  })
  document.addEventListener('input', save, true)
  document.addEventListener('change', save, true)
  function hello() { parent.postMessage({ cockpitPage: 'hello' }, '*') }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello)
  else hello()
})()`

/** The page as served on the board: the keeper put in at the top of its head (or of the page). */
export function withKeeper(html) {
  const tag = `<script>${KEEPER}</script>`
  const head = /<head[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
  return tag + html
}

/** A page Claude writes: kept in the notes folder (pages/), a new file each time; returns its path. */
export function savePage(cfg, title, html) {
  const t = String(title || '').trim().slice(0, 120) || 'Page'
  const body = String(html || '')
  if (!body.trim()) throw new UserError('A page needs some HTML')
  if (Buffer.byteLength(body) > MAX_PAGE) throw new UserError('That page is over 2 MB')
  ensureNotes(cfg)
  const dir = path.join(notesRoot(cfg), 'pages')
  fs.mkdirSync(dir, { recursive: true })
  const base = slug(t) || 'page'
  let file = path.join(dir, `${base}.html`)
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.html`)
  // a bare fragment gets a page round it, with the title
  const page = /<html[\s>]/i.test(body) ? body : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${t.replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c])}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
  writeFileAtomic(file, page)
  return file
}
