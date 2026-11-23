// The Dictionary extra: English words, offline. data/dictionary.bin is built by scripts/build-dictionary.mjs from
// Open English WordNet and the CMU Pronouncing Dictionary; a lookup reads and unpacks one small shard (kept for reuse).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dictionary.bin')
const KEEP = 40

let header = null
const cache = new Map()

function open() {
  if (header) return header
  const fd = fs.openSync(FILE, 'r')
  try {
    const len = Buffer.alloc(4)
    fs.readSync(fd, len, 0, 4, 0)
    const n = len.readUInt32LE()
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, 4)
    header = { ...JSON.parse(buf.toString('utf8')), start: 4 + n }
    return header
  } finally {
    fs.closeSync(fd)
  }
}

const keyOf = w => String(w || '').replace(/_/g, ' ').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()
const shardOf = k => (/^[a-z]{2}/.test(k) ? k.slice(0, 2) : /^[a-z]/.test(k) ? `${k[0]}_` : '__')

function shard(name) {
  if (cache.has(name)) {
    const s = cache.get(name)
    cache.delete(name)
    cache.set(name, s)
    return s
  }
  const h = open()
  const at = h.shards[name]
  if (!at) return null
  const fd = fs.openSync(FILE, 'r')
  let s
  try {
    const buf = Buffer.alloc(at[1])
    fs.readSync(fd, buf, 0, at[1], h.start + at[0])
    s = JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
  } finally {
    fs.closeSync(fd)
  }
  cache.set(name, s)
  if (cache.size > KEEP) cache.delete(cache.keys().next().value)
  return s
}

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : null)
const entriesOf = k => own(shard(shardOf(k))?.w, k)
const formsOf = k => own(shard(shardOf(k))?.f, k) || []

// endings English adds (WordNet's own rules), tried when a word isn't listed as it's written: "running" → "run"
const ENDINGS = [
  ['ies', 'y'], ['es', 'e'], ['es', ''], ['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'],
  ['men', 'man'], ['ied', 'y'], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''], ['ier', 'y'], ['iest', 'y'], ['er', ''], ['est', ''],
  ['er', 'e'], ['est', 'e'], ['ly', ''], ['ily', 'y'],
]
function stems(k) {
  const out = []
  for (const [end, add] of ENDINGS) {
    if (!k.endsWith(end) || k.length - end.length < 2) continue
    const base = k.slice(0, -end.length)
    out.push(base + add)
    // stopped, running, bigger: the doubled letter goes too
    if (!add && /([b-df-hj-np-tv-z])\1$/.test(base)) out.push(base.slice(0, -1))
  }
  return [...new Set(out)]
}

/** A word's entries; for a form ("ran", "children", "running"), the word it comes from, with `from` saying so. */
export function lookup(word) {
  const k = keyOf(word).slice(0, 80)
  if (!k) return { word: '', entries: [] }
  // the word as it was written first ("Polish" or "polish"), then lower case before a name
  const typed = String(word || '').trim()
  const rank = e => (e.w === typed ? 0 : e.w === e.w.toLowerCase() ? 1 : 2)
  const direct = [...(entriesOf(k) || [])].sort((a, b) => rank(a) - rank(b))
  const bases = [...new Set(formsOf(k))]
  // written another way: "e-mail" is "email", "ice-cream" is "ice cream"
  if (!direct.length && !bases.length && /[- ]/.test(k)) for (const s of [k.replace(/[- ]/g, ''), k.replace(/-/g, ' '), k.replace(/ /g, '-')]) if (s !== k && entriesOf(s)) bases.push(s)
  if (!direct.length && !bases.length) for (const s of stems(k)) if (entriesOf(s)) bases.push(s)
  const entries = [...direct]
  const from = []
  for (const b of bases.slice(0, 2)) {
    const more = entriesOf(keyOf(b)) || []
    if (more.length) from.push(more[0].w)
    entries.push(...more.filter(e => !entries.some(x => x.w === e.w)))
  }
  return { word: k, entries, ...(from.length ? { from } : {}) }
}

/** Words that start with what's typed (two letters or more): the ones with the most meanings (the common ones) first. */
export function suggest(prefix, max = 8) {
  const k = keyOf(prefix)
  if (k.length < 2) return []
  const s = shard(shardOf(k))
  if (!s) return []
  return Object.keys(s.w)
    .filter(w => w.startsWith(k))
    .map(w => [w, s.w[w].reduce((n, e) => n + e.m.reduce((m, [, senses]) => m + senses.length, 0), 0)])
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .map(([w]) => w)
    .slice(0, max)
    .map(w => s.w[w][0].w)
}

export function dictionaryInfo() {
  try {
    const h = open()
    return { available: true, words: h.words, source: h.source }
  } catch {
    return { available: false }
  }
}
