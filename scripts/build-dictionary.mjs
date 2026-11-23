// Builds the Dictionary extra's word list (server/data/dictionary.bin) from Open English WordNet (meanings,
// examples, synonyms, opposites; CC BY 4.0) and the CMU Pronouncing Dictionary (pronunciations WordNet lacks; BSD).
// Run by hand when updating them, with the unzipped WordNet JSON release and cmudict.dict:
//   node scripts/build-dictionary.mjs <english-wordnet-json folder> <cmudict.dict>
//
// The file: 4 bytes (the header's length), a JSON header { shards: { "ab": [offset, length] } }, then one gzipped
// JSON shard per first two letters, so a lookup reads and unpacks only a few kilobytes.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const [dir, cmuFile] = process.argv.slice(2)
if (!dir || !cmuFile) {
  console.error('usage: node scripts/build-dictionary.mjs <english-wordnet-json folder> <cmudict.dict>')
  process.exit(1)
}
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'dictionary.bin')
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

// every synset: definition, examples, members
const synsets = new Map()
for (const f of fs.readdirSync(dir).filter(f => /^(noun|verb|adj|adv)\..+\.json$/.test(f))) {
  for (const [id, s] of Object.entries(read(f))) synsets.set(id, s)
}
const entries = {}
for (const f of fs.readdirSync(dir).filter(f => /^entries-.+\.json$/.test(f))) Object.assign(entries, read(f))

// sense id → its word (for opposites)
const senseWord = new Map()
for (const [w, byPos] of Object.entries(entries)) for (const x of Object.values(byPos)) for (const s of x.sense) senseWord.set(s.id, w)

// ARPAbet → IPA, for words WordNet has no pronunciation for
const IPA = { AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u', B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ' }
const ONSETS = new Set(['s p', 's t', 's k', 'p l', 'p r', 'b l', 'b r', 't r', 'd r', 'k l', 'k r', 'g l', 'g r', 'f l', 'f r', 's l', 's m', 's n', 's w', 't w', 'k w', 'th r', 'sh r'])
function toIpa(phones) {
  const vowels = phones.filter(p => /[012]$/.test(p)).length
  const out = []
  let cons = [] // consonants since the last vowel, as [ipa, arpabet]
  let first = true
  for (const p of phones) {
    const m = /^([A-Z]+)([012])?$/.exec(p)
    if (!m || !IPA[m[1]]) return ''
    if (m[2] === undefined) {
      cons.push([IPA[m[1]], m[1].toLowerCase()])
      continue
    }
    let v = IPA[m[1]]
    if (m[1] === 'AH' && m[2] === '0') v = 'ə'
    if (m[1] === 'ER' && m[2] === '0') v = 'ɚ'
    // the stress mark goes before the syllable's onset: one consonant, or two that can start a word together
    let onset = first ? cons.length : Math.min(cons.length, 1)
    if (!first && cons.length >= 2 && ONSETS.has(cons.slice(-2).map(c => c[1]).join(' '))) onset = 2
    if (onset === 2 && cons.length >= 3 && cons.at(-3)[1] === 's' && /^[ptk] [rlw]$/.test(cons.slice(-2).map(c => c[1]).join(' '))) onset = 3
    const coda = cons.slice(0, cons.length - onset).map(c => c[0]).join('')
    const head = cons.slice(cons.length - onset).map(c => c[0]).join('')
    const mark = m[2] === '1' ? 'ˈ' : m[2] === '2' ? 'ˌ' : ''
    out.push(coda, mark && vowels > 1 ? mark : '', head, v)
    cons = []
    first = false
  }
  out.push(cons.map(c => c[0]).join(''))
  return out.join('')
}
const cmu = new Map()
for (const line of fs.readFileSync(cmuFile, 'utf8').split('\n')) {
  const m = /^([^\s(]+)(\(\d+\))?\s+([^#]+)/.exec(line)
  if (!m || m[2] || cmu.has(m[1])) continue
  const ipa = toIpa(m[3].trim().split(/\s+/))
  if (ipa) cmu.set(m[1], ipa)
}

const POS = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' }
const ORDER = ['noun', 'verb', 'adjective', 'adverb']
const clean = s => String(s).replace(/_/g, ' ')
const keyOf = w => clean(w).toLowerCase().trim()
const shardOf = k => (/^[a-z]{2}/.test(k) ? k.slice(0, 2) : /^[a-z]/.test(k) ? `${k[0]}_` : '__')

const shards = {}
const shard = k => (shards[shardOf(k)] ??= { w: Object.create(null), f: Object.create(null) })
let words = 0
let spoken = 0

for (const [lemma, byPos] of Object.entries(entries)) {
  const key = keyOf(lemma)
  const groups = new Map()
  let ipa = ''
  for (const [pos, x] of Object.entries(byPos)) {
    ipa ||= x.pronunciation?.find(p => !p.variety)?.value || x.pronunciation?.[0]?.value || ''
    const label = POS[pos] || 'other'
    const senses = groups.get(label) || []
    for (const s of x.sense) {
      const syn = synsets.get(s.synset)
      if (!syn) continue
      const def = syn.definition?.[0]
      if (!def) continue
      const examples = [...(syn.example || []), ...(s.sent || [])]
        .map(e => (typeof e === 'string' ? e : e?.text || ''))
        .filter(Boolean)
        .slice(0, 2)
      // the same meaning in other words: the synset's other members, then the first word of each similar synset
      // (an adjective's cluster: happy → blissful, glad…)
      const near = (syn.similar || []).map(id => synsets.get(id)?.members?.[0]).filter(Boolean)
      const same = [...new Set([...(syn.members || []), ...near].map(clean))].filter(m => keyOf(m) !== key).slice(0, 8)
      const opposite = [...new Set((s.antonym || []).map(id => senseWord.get(id)).filter(Boolean).map(clean))].slice(0, 4)
      senses.push([def, examples, same, opposite])
    }
    if (senses.length) groups.set(label, senses)
    // forms (ran, children, better) lead back to this word
    for (const form of x.form || []) {
      const fk = keyOf(form)
      const list = (shard(fk).f[fk] ??= [])
      if (!list.includes(lemma)) list.push(clean(lemma))
    }
  }
  if (!groups.size) continue
  ipa ||= cmu.get(key) || ''
  ipa = ipa.replace(/\./g, '')
  if (ipa) spoken++
  const entry = { w: clean(lemma), ...(ipa ? { ipa } : {}), m: ORDER.filter(p => groups.has(p)).map(p => [p, groups.get(p)]) }
  ;(shard(key).w[key] ??= []).push(entry)
  words++
}

const names = Object.keys(shards).sort()
const blobs = []
const index = {}
let offset = 0
for (const n of names) {
  const buf = zlib.gzipSync(JSON.stringify(shards[n]), { level: 9 })
  index[n] = [offset, buf.length]
  offset += buf.length
  blobs.push(buf)
}
const header = Buffer.from(
  JSON.stringify({ v: 1, words, source: 'Open English WordNet 2025 (CC BY 4.0) and the CMU Pronouncing Dictionary (BSD)', shards: index }),
)
const len = Buffer.alloc(4)
len.writeUInt32LE(header.length)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.concat([len, header, ...blobs]))
console.log(`${words} words (${spoken} with a pronunciation), ${names.length} shards, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB → ${OUT}`)
