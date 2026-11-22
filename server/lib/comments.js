// Comments on cards: a short thread per card, written by the user or by Claude (through Cockpit's board tools).
// ~/.cockpit/comments.json, keyed by the card's id on the board. A card taken off keeps its thread (Undo brings it back).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'

const file = () => path.join(DATA_DIR, 'comments.json')
const MAX_TEXT = 4000
const MAX_PER_CARD = 200
const BY = new Set(['you', 'Claude'])

function readAll() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return j && typeof j.cards === 'object' && j.cards ? j : { cards: {} }
  } catch {
    return { cards: {} }
  }
}

const save = all => writeFileAtomic(file(), JSON.stringify(all, null, 1) + '\n')
const cardId = c => (typeof c === 'string' && /^[\w.:-]{1,80}$/.test(c) ? c : '')

/** Every card's thread: { cards: { [cardId]: [{ id, by, text, at }] } }. */
export const listComments = () => readAll()

export function addComment({ card, text, by = 'you' }, now = new Date()) {
  const id = cardId(card)
  if (!id) throw new UserError('Which card?')
  const words = String(text ?? '').trim()
  if (!words) throw new UserError('Write something first')
  const all = readAll()
  const thread = (all.cards[id] ||= [])
  const c = { id: crypto.randomUUID().slice(0, 12), by: BY.has(by) ? by : 'you', text: words.slice(0, MAX_TEXT), at: now.toISOString() }
  thread.push(c)
  if (thread.length > MAX_PER_CARD) thread.splice(0, thread.length - MAX_PER_CARD)
  save(all)
  return c
}

export function removeComment(commentId) {
  const all = readAll()
  for (const [card, thread] of Object.entries(all.cards)) {
    const i = thread.findIndex(c => c.id === commentId)
    if (i < 0) continue
    thread.splice(i, 1)
    if (!thread.length) delete all.cards[card]
    save(all)
    return { ok: true }
  }
  throw new UserError('That comment is gone')
}
