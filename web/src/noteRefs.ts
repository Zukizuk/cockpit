// A link from a journal page to another note: [Title](note:stickies/2026-11-19-112535.md). In Cockpit it opens the
// note; synced to Kokoro, the page takes the note's text along (server/lib/note-refs.js).
export const NOTE_LINK = /\[([^\]\n]*)\]\(note:([^)\s]+)\)/g

const decode = (p: string) => {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

/** A link to a note, its title made safe for the brackets and its path for the parentheses. */
export const noteLink = (title: string, path: string) => `[${title.replace(/[[\]\n]/g, ' ').trim() || 'Note'}](note:${encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29')})`

/** The notes a text links to, each once. */
export function refsIn(text: string) {
  const seen = new Map<string, string>()
  for (const m of text.matchAll(NOTE_LINK)) {
    const p = decode(m[2])
    if (!seen.has(p)) seen.set(p, m[1].trim())
  }
  return [...seen].map(([path, title]) => ({ path, title }))
}

/** The note a href like "note:stickies/a%20b.md" points to. */
export const notePathOf = (href: string) => (href.startsWith('note:') ? decode(href.slice(5)) : '')
