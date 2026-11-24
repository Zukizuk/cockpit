// The Dictionary extra (Settings > Extras), offline: 128,000 English words kept with Cockpit. Two ways in:
//  - the Dictionary itself, a dialog (D on the board, or "Dictionary" in the + box): type a word, get its meanings;
//  - Look Up, as on a Mac: select a word anywhere (a note, a page, a card) and press Ctrl+D, and its meaning shows
//    right there, next to the word. With nothing selected in a note, the word at the cursor.
// Similar and opposite words are links; "Keep" puts the word and its meaning in today's journal (with the Journal
// extra on) or on a new sticky note.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, BookmarkPlus, Search, Volume2, X } from 'lucide-react'
import { get, post, type DictEntry, type DictResult } from '../api'
import { useBoard } from '../board'
import { emit, onEvent } from '../lib'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const RECENT_KEY = 'cockpit.dictionary.recent'
const MORE_AT = 5

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.filter(w => typeof w === 'string').slice(0, 24) : []
  } catch {
    return []
  }
}
function remember(word: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([word, ...readRecent().filter(w => w.toLowerCase() !== word.toLowerCase())].slice(0, 24)))
  } catch {}
}

const cache = new Map<string, DictResult>()
async function lookUp(word: string) {
  // as written: "Polish" and "polish" lead with different words
  const k = word.trim()
  if (cache.has(k)) return cache.get(k)!
  const r = await get<DictResult>(`/api/dictionary?word=${encodeURIComponent(k)}`)
  cache.set(k, r)
  return r
}

/** Says the word aloud with Windows' own voices (no internet needed for them). */
function speak(word: string) {
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(word)
    const voices = synth.getVoices()
    u.voice = voices.find(v => v.lang === 'en-US' && v.localService) || voices.find(v => v.lang.startsWith('en')) || null
    u.lang = u.voice?.lang || 'en-US'
    u.rate = 0.9
    synth.speak(u)
  } catch {}
}
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Keeps a word: a line in today's journal with the Journal extra on, else a sticky note of its own. */
async function keepWord(board: ReturnType<typeof useBoard>, e: DictEntry) {
  if (board.prefs.extras.journal) {
    await post('/api/notes/append', { text: journalLine(e) })
    board.toast(`Kept “${e.w}” in today's journal`)
  } else await board.newSticky(journalLine(e))
}

/** The word and its first meaning, as one line for the journal. */
function journalLine(e: DictEntry) {
  const [pos, senses] = e.m[0]
  return `**${e.w}** (${pos}): ${senses[0][0]}`
}

// ---------------------------------------------------------------------------------------------------------------
// What's selected, and where it is on screen

type Picked = { word: string; rect: DOMRect }

const wordish = (s: string) => {
  const t = s.replace(/[\s ]+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return t && t.length <= 60 && t.split(' ').length <= 4 && /\p{L}/u.test(t) ? t : ''
}

/** Where a range of a text box's text is on screen: a hidden copy of the box, laid out the same, measured. */
function rectInField(el: HTMLTextAreaElement | HTMLInputElement, start: number, end: number) {
  const cs = getComputedStyle(el)
  const div = document.createElement('div')
  const props = ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize'] as const
  for (const p of props) (div.style as any)[p] = cs[p]
  Object.assign(div.style, { position: 'fixed', visibility: 'hidden', top: '0', left: '0', whiteSpace: el.tagName === 'INPUT' ? 'pre' : 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden' })
  div.textContent = el.value.slice(0, start)
  const span = document.createElement('span')
  span.textContent = el.value.slice(start, end) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const box = el.getBoundingClientRect()
  // the board may be zoomed: the box is drawn smaller or larger than it's laid out
  const scale = el.offsetWidth ? box.width / el.offsetWidth : 1
  const r = new DOMRect(box.left + (span.offsetLeft - el.scrollLeft) * scale, box.top + (span.offsetTop - el.scrollTop) * scale, span.offsetWidth * scale, span.offsetHeight * scale)
  div.remove()
  return r
}

/** The word selected (or, in a text box with nothing selected, the word at the cursor), and where it is. */
export function pickedWord(): Picked | null {
  const el = document.activeElement
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|)$/.test(el.type))) {
    let start = el.selectionStart ?? 0
    let end = el.selectionEnd ?? start
    if (start === end) {
      const v = el.value
      while (start > 0 && /[\p{L}\p{N}'’]/u.test(v[start - 1])) start--
      while (end < v.length && /[\p{L}\p{N}'’]/u.test(v[end])) end++
    }
    const word = wordish(el.value.slice(start, end))
    return word ? { word, rect: rectInField(el, start, end) } : null
  }
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  let range = sel.getRangeAt(0)
  // nothing selected while writing (a note): the word at the cursor
  if (sel.isCollapsed) {
    const node = sel.focusNode
    const editing = (node instanceof Element ? node : node?.parentElement)?.closest('[contenteditable="true"]')
    if (!editing || !node || node.nodeType !== Node.TEXT_NODE) return null
    const text = node.textContent || ''
    let start = sel.focusOffset
    let end = start
    // the word between hyphens ("minute" in "one-minute"), as a Mac does
    while (start > 0 && /[\p{L}\p{N}'’]/u.test(text[start - 1])) start--
    while (end < text.length && /[\p{L}\p{N}'’]/u.test(text[end])) end++
    if (start === end) return null
    range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
  }
  const word = wordish(range.toString())
  if (!word) return null
  const rects = range.getClientRects()
  return { word, rect: rects[0] || range.getBoundingClientRect() }
}

// ---------------------------------------------------------------------------------------------------------------
// One word's entry

function Pron({ entry }: { entry: DictEntry }) {
  if (!entry.ipa && !canSpeak) return null
  return (
    <span className="dict-pron">
      {entry.ipa && <span>| {entry.ipa} |</span>}
      {canSpeak && (
        <button type="button" className="dict-speak" aria-label={`Say “${entry.w}”`} title="Say it" onClick={() => speak(entry.w)}>
          <Volume2 className="size-[15px]" strokeWidth={1.75} />
        </button>
      )}
    </span>
  )
}

function Words({ label, words, go }: { label: string; words: string[]; go: (w: string) => void }) {
  if (!words.length) return null
  return (
    <p className="dict-words">
      <span className="dict-words-label">{label}</span>
      {words.map((w, i) => (
        <span key={w}>
          <button type="button" className="dict-link" onClick={() => go(w)}>
            {w}
          </button>
          {i < words.length - 1 ? ', ' : ''}
        </span>
      ))}
    </p>
  )
}

function Entry({ entry, go, compact }: { entry: DictEntry; go: (w: string) => void; compact?: boolean }) {
  const [all, setAll] = useState<Record<string, boolean>>({})
  let left = compact ? 3 : Infinity
  return (
    <article className="dict-entry">
      <header className="dict-head">
        <h2 className="dict-word">{entry.w}</h2>
        <Pron entry={entry} />
      </header>
      {entry.m.map(([pos, senses]) => {
        if (left <= 0) return null
        const shown = compact ? senses.slice(0, left) : all[pos] ? senses : senses.slice(0, MORE_AT)
        left -= shown.length
        return (
          <section key={pos} className="dict-pos">
            <h3 className="dict-pos-label">{pos}</h3>
            <ol className="dict-senses">
              {shown.map(([def, examples, same, opposite], i) => (
                <li key={i} className="dict-sense">
                  {senses.length > 1 && <span className="dict-num">{i + 1}</span>}
                  <div className="min-w-0">
                    <p className="dict-def">
                      {def}
                      {examples[0] && (
                        <>
                          {': '}
                          <span className="dict-ex">{compact ? examples[0] : examples.join(' · ')}</span>
                        </>
                      )}
                    </p>
                    {!compact && <Words label="similar" words={same} go={go} />}
                    {!compact && <Words label="opposite" words={opposite} go={go} />}
                  </div>
                </li>
              ))}
            </ol>
            {!compact && senses.length > MORE_AT && !all[pos] && (
              <button type="button" className="dict-more" onClick={() => setAll(a => ({ ...a, [pos]: true }))}>
                {senses.length - MORE_AT} more meanings
              </button>
            )}
          </section>
        )
      })}
    </article>
  )
}

/** "ran" was looked up as "run": say so. */
function FromLine({ r }: { r: DictResult }) {
  if (!r.from?.length || r.entries.some(e => e.w.toLowerCase() === r.word)) return null
  return (
    <p className="dict-from">
      “{r.word}” is a form of {r.from.join(' and ')}
    </p>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The Dictionary dialog

function useLookup(word: string) {
  const [r, setR] = useState<DictResult | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setErr('')
    if (!word) return setR(null)
    lookUp(word).then(
      x => live && setR(x),
      e => live && setErr(e.message),
    )
    return () => {
      live = false
    }
  }, [word])
  return { r, err }
}

function DictionaryDialog({ open, setOpen, start }: { open: boolean; setOpen: (o: boolean) => void; start: string }) {
  const board = useBoard()
  const [q, setQ] = useState('')
  const [word, setWord] = useState('')
  const [trail, setTrail] = useState<string[]>([])
  const [hints, setHints] = useState<string[]>([])
  const [hi, setHi] = useState(-1)
  const [recent, setRecent] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const { r, err } = useLookup(word)

  useEffect(() => {
    if (!open) return
    setRecent(readRecent())
    setTrail([])
    setHints([])
    setQ(start)
    setWord(start)
  }, [open, start])
  useEffect(() => {
    if (r?.entries.length) {
      remember(r.entries[0].w)
      setRecent(readRecent())
    }
    body.current?.scrollTo({ top: 0 })
  }, [r])

  // words that start with what's typed
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2 || t.toLowerCase() === word.toLowerCase()) return setHints([])
    let live = true
    const timer = window.setTimeout(
      () =>
        get<string[]>(`/api/dictionary/suggest?q=${encodeURIComponent(t)}`).then(
          h => live && (setHints(h), setHi(-1)),
          () => {},
        ),
      90,
    )
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [q, word])

  const go = useCallback(
    (w: string, from?: string) => {
      const t = w.trim()
      if (!t) return
      if (from) setTrail(tr => [...tr, from])
      setQ(t)
      setWord(t)
      setHints([])
    },
    [],
  )
  const back = () => {
    const prev = trail.at(-1)
    if (!prev) return
    setTrail(tr => tr.slice(0, -1))
    setQ(prev)
    setWord(prev)
  }
  const keep = async (e: DictEntry) => {
    try {
      await keepWord(board, e)
    } catch (x: any) {
      board.toast(x.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="glass-panel dict top-[14vh] flex max-h-[calc(86vh-24px)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
        onOpenAutoFocus={e => {
          e.preventDefault()
          input.current?.focus()
          input.current?.select()
        }}
      >
        <DialogTitle className="sr-only">Dictionary</DialogTitle>
        <DialogDescription className="sr-only">Look up an English word.</DialogDescription>
        <div className="dict-bar">
          {trail.length > 0 ? (
            <button type="button" className="dict-icon-btn" aria-label={`Back to “${trail.at(-1)}”`} title={`Back to “${trail.at(-1)}”`} onClick={back}>
              <ArrowLeft className="size-4" strokeWidth={1.75} />
            </button>
          ) : (
            <Search className="mx-1.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          )}
          <input
            ref={input}
            value={q}
            placeholder="Look up a word"
            aria-label="Look up a word"
            className="dict-input"
            spellCheck={false}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' && hints.length) (e.preventDefault(), setHi(i => Math.min(hints.length - 1, i + 1)))
              else if (e.key === 'ArrowUp' && hints.length) (e.preventDefault(), setHi(i => Math.max(-1, i - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), go(hi >= 0 ? hints[hi] : q, word && word !== q ? word : undefined))
              else if (e.key === 'Escape' && hints.length) (e.preventDefault(), e.stopPropagation(), setHints([]))
            }}
          />
          <button type="button" className="dict-icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
          {hints.length > 0 && (
            <ul className="dict-hints" role="listbox" aria-label="Words">
              {hints.map((h, i) => (
                <li key={h} role="option" aria-selected={i === hi}>
                  <button type="button" className={cn('dict-hint', i === hi && 'is-on')} onMouseDown={e => e.preventDefault()} onClick={() => go(h, word || undefined)}>
                    {h}
                  </button>
                </li>
              ))}
            </ul>
          )}
        {/* only what there is to show: nothing typed and nothing looked up before is just the bar */}
        {!hints.length && (word || recent.length > 0) && (
        <div ref={body} className={cn('dict-body', !word && 'is-recent')}>
          {!word ? (
            <Recent words={recent} go={w => go(w)} />
          ) : err ? (
            <p className="dict-empty">{err}</p>
          ) : !r ? null : !r.entries.length ? (
            <p className="dict-empty">“{word}” isn't in the dictionary. Check the spelling, or try the word it comes from.</p>
          ) : (
            <>
              <FromLine r={r} />
              {r.entries.map(e => (
                <div key={e.w} className="dict-block">
                  <Entry entry={e} go={w => go(w, word)} />
                  <button type="button" className="dict-keep" onClick={() => keep(e)}>
                    <BookmarkPlus className="size-3.5" strokeWidth={1.75} />
                    {board.prefs.extras.journal ? "Keep in today's journal" : 'Keep as a sticky note'}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Recent({ words, go }: { words: string[]; go: (w: string) => void }) {
  return (
    <div>
      <p className="dict-words-label mb-2">Looked up lately</p>
      <div className="flex flex-wrap gap-1.5">
        {words.slice(0, 10).map(w => (
          <button key={w} type="button" className="dict-chip" onClick={() => go(w)}>
            {w}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Look Up: a word's meaning beside it

function LookUp({ at, onClose, onMore }: { at: Picked; onClose: () => void; onMore: (w: string) => void }) {
  const board = useBoard()
  const { r, err } = useLookup(at.word)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const entry = r?.entries[0]

  // below the word, or above it when there's no room; inside the window
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const below = at.rect.bottom + 8
    const top = below + h > innerHeight - 8 && at.rect.top - h - 8 > 8 ? at.rect.top - h - 8 : Math.min(below, innerHeight - h - 8)
    setPos({ left: Math.max(8, Math.min(at.rect.left - 12, innerWidth - w - 8)), top: Math.max(8, top) })
  }, [at, r, err])

  useEffect(() => {
    if (r?.entries.length) remember(r.entries[0].w)
  }, [r])
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    // the board moving under it (scrolled, zoomed) leaves it pointing at nothing
    const wheel = (e: WheelEvent) => !box.current?.contains(e.target as Node) && onClose()
    const timer = window.setTimeout(() => addEventListener('pointerdown', away, true), 0)
    addEventListener('keydown', key, true)
    addEventListener('wheel', wheel, { passive: true })
    return () => {
      window.clearTimeout(timer)
      removeEventListener('pointerdown', away, true)
      removeEventListener('keydown', key, true)
      removeEventListener('wheel', wheel)
    }
  }, [onClose])

  const keep = async () => {
    if (!entry) return
    try {
      await keepWord(board, entry)
      onClose()
    } catch (x: any) {
      board.toast(x.message)
    }
  }

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={`“${at.word}” in the dictionary`}
      className="dict dict-pop glass"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onMouseDown={e => e.preventDefault()}
    >
      {err ? (
        <p className="dict-empty">{err}</p>
      ) : !r ? (
        <p className="dict-empty">Looking it up…</p>
      ) : !entry ? (
        <p className="dict-empty">“{at.word}” isn't in the dictionary.</p>
      ) : (
        <>
          <FromLine r={r} />
          <Entry entry={entry} go={onMore} compact />
          <div className="dict-pop-foot">
            <button type="button" className="dict-keep" onClick={keep}>
              <BookmarkPlus className="size-3.5" strokeWidth={1.75} />
              Keep
            </button>
            <span className="flex-1" />
            <button type="button" className="dict-more" onClick={() => onMore(at.word)}>
              More in Dictionary
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------------------------------------------

/** Mounted once: the Dictionary dialog, Look Up, and their keys (only while the extra is on). */
export function DictionaryExtra() {
  const board = useBoard()
  const on = board.prefs.extras.dictionary
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const [at, setAt] = useState<Picked | null>(null)

  const openWith = useCallback((word = '') => {
    setAt(null)
    setStart(word)
    setOpen(true)
  }, [])
  useEffect(() => onEvent('dictionary-open', (d: { word?: string }) => openWith(d?.word || pickedWord()?.word || '')), [openWith])

  // Ctrl+D: the selected word's meaning, beside it (anywhere, even while typing); nothing selected: the Dictionary
  useEffect(() => {
    if (!on) return
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'd') return
      e.preventDefault()
      e.stopPropagation()
      const p = pickedWord()
      if (p) setAt(p)
      else openWith('')
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [on, openWith])

  const close = useCallback(() => setAt(null), [])
  const more = useMemo(() => (w: string) => openWith(w), [openWith])
  if (!on) return null
  return (
    <>
      <DictionaryDialog open={open} setOpen={setOpen} start={start} />
      {at && <LookUp key={`${at.word}-${at.rect.left}-${at.rect.top}`} at={at} onClose={close} onMore={more} />}
    </>
  )
}

/** For the + box and D: opens the Dictionary (on the selected word, if there is one). */
export const openDictionary = (word?: string) => emit('dictionary-open', { word })
