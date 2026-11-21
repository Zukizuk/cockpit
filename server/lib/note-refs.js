// A journal page can refer to other notes (a sticky note where a thought was gathered, say) with a link of its own
// kind: [Title](note:stickies/2026-11-19-112535.md). In Cockpit it opens the note. Kokoro only keeps an entry's
// title and text, so a page sent there carries the notes it refers to at its end, under a line Cockpit knows;
// coming back, that part is taken off again, so the page here keeps just the links.
import { readNote } from './notes.js'

export const NOTE_LINK = /\[([^\]\n]*)\]\(note:([^)\s]+)\)/g
const HEADING = 'Notes referred to (from Cockpit)'
const BLOCK = /\n*-{3,}[ \t]*\n+Notes referred to \(from Cockpit\)[ \t]*\n[\s\S]*$/
const MAX_NOTE = 6000

const decode = p => {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

/** The notes a text links to, each once, in the order they first appear. */
export function refsIn(text) {
  const seen = new Map()
  for (const m of String(text || '').matchAll(NOTE_LINK)) {
    const p = decode(m[2])
    if (!seen.has(p)) seen.set(p, m[1].trim())
  }
  return [...seen].map(([path, title]) => ({ path, title }))
}

/** The page as Kokoro gets it: its own text, then each note it refers to (as it is now). */
export function withNotes(cfg, file) {
  const own = withoutNotes(file)
  const refs = refsIn(own)
  if (!refs.length) return own
  const parts = []
  for (const r of refs) {
    let body
    try {
      body = readNote(cfg, r.path).text.replace(/\r\n/g, '\n').trim()
    } catch {
      continue // gone, or not a note: the link stays, there's nothing to add
    }
    if (body.length > MAX_NOTE) body = `${body.slice(0, MAX_NOTE)}…`
    parts.push(`### ${r.title || r.path.split('/').pop().replace(/\.md$/i, '')}\n\n${body || '(empty)'}`)
  }
  if (!parts.length) return own
  return `${own.replace(/\s+$/, '')}\n\n---\n\n${HEADING}\n\n${parts.join('\n\n')}\n`
}

/** The page as it's kept here: the notes block from Kokoro taken off. */
export function withoutNotes(text) {
  const s = String(text || '').replace(/\r\n/g, '\n')
  return BLOCK.test(s) ? s.replace(BLOCK, '\n') : s
}
