// Questions an agent leaves on the board instead of stopping to ask: each with the agent's best guess, which stands
// until the person answers. ~/.cockpit/questions.json. The person types an answer (or takes the guess); the agent
// reads the answers when it next looks. A question taken away is gone (it was only ever a question).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, UserError, writeFileAtomic } from './config.js'

const file = () => path.join(DATA_DIR, 'questions.json')
const MAX = 200
const MAX_TEXT = 600
const BY = new Set(['Claude', 'An agent', 'you'])
const clean = (s, n = MAX_TEXT) => String(s ?? '').trim().slice(0, n)

function readAll() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return Array.isArray(j?.questions) ? j.questions : []
  } catch {
    return []
  }
}
const save = list => writeFileAtomic(file(), JSON.stringify({ questions: list }, null, 1) + '\n')

/** Every question, oldest first: { id, question, guess?, about?, by, at, answer?, answeredAt? }. */
export const listQuestions = () => readAll()

/** A question's choices, if it has some: 2 to 8 short ones, no two the same. */
function choicesOf(list) {
  const out = []
  for (const c of Array.isArray(list) ? list : []) {
    const t = clean(c, 120)
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length === 8) break
  }
  return out.length >= 2 ? out : []
}

export function askQuestion({ question, guess, about, choices, by = 'Claude' }, now = new Date()) {
  const q = clean(question)
  if (!q) throw new UserError('Write the question')
  const options = choicesOf(choices)
  const list = readAll()
  // the same question asked again while it's still open: the one there stands (its guess and choices brought up to date)
  const open = list.find(x => !x.answeredAt && x.question.toLowerCase() === q.toLowerCase())
  if (open) {
    if (clean(guess)) open.guess = clean(guess)
    if (options.length) open.choices = options
    save(list)
    return open
  }
  const item = {
    id: crypto.randomUUID().slice(0, 12),
    question: q,
    ...(clean(guess) ? { guess: clean(guess) } : {}),
    // a few to pick from (the person can still write something else)
    ...(options.length ? { choices: options } : {}),
    ...(clean(about, 200) ? { about: clean(about, 200) } : {}),
    by: BY.has(by) ? by : 'An agent',
    at: now.toISOString(),
  }
  list.push(item)
  if (list.length > MAX) list.splice(0, list.length - MAX)
  save(list)
  return item
}

/** The person's answer ("" takes it back: the question is open again, its guess standing). */
export function answerQuestion(id, answer, now = new Date()) {
  const list = readAll()
  const q = list.find(x => x.id === id)
  if (!q) throw new UserError('That question is gone', 404)
  const a = clean(answer, 4000)
  if (a) {
    q.answer = a
    q.answeredAt = now.toISOString()
  } else {
    delete q.answer
    delete q.answeredAt
  }
  save(list)
  return q
}

export function removeQuestion(id) {
  const list = readAll()
  const i = list.findIndex(x => x.id === id)
  if (i < 0) throw new UserError('That question is gone', 404)
  list.splice(i, 1)
  save(list)
  return { ok: true }
}
