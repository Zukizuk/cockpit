// A markdown editor for writing (not for code): CodeMirror with prose styling, history, search and Ctrl+S.
// Its colours and sizes come from --ed-* variables, so a sticky note's paper can set its own.
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, drawSelection, dropCursor, keymap, placeholder as cmPlaceholder, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap, searchPanelOpen } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { onEvent } from '../lib'
import { NOTE_LINK, noteLink, notePathOf } from '../noteRefs'

/** A note that can be referred to: [[ in the editor lists them. */
export type NoteChoice = { path: string; title: string; detail?: string }

/** [[ then a few letters: the notes whose title or words match, most recent first; picking one puts its link in. */
function noteSource(list: () => NoteChoice[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/)
    if (!m) return null
    const q = m.text.slice(2).toLowerCase()
    const options = list()
      .filter(n => !q || n.title.toLowerCase().includes(q) || (n.detail || '').toLowerCase().includes(q))
      .slice(0, 30)
      .map(n => ({
        label: n.title,
        detail: n.detail,
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          // a "]]" typed ahead of the cursor goes too
          const after = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to
          const link = noteLink(n.title, n.path)
          view.dispatch({ changes: { from, to: after, insert: link }, selection: { anchor: from + link.length } })
        },
      }))
    return { from: m.from, options, filter: false }
  }
}

/**
 * A link to a note reads as its title alone: the "(note:…)" part is hidden and the title gets a chip look, except
 * while the cursor is in that link (to change it).
 */
const hidePath = Decoration.replace({})
const titleMark = Decoration.mark({ class: 'cm-note-ref' })
function noteDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const sel = view.state.selection.main
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to)
    for (const m of text.matchAll(NOTE_LINK)) {
      const a = from + (m.index ?? 0)
      const z = a + m[0].length
      if (sel.from <= z && sel.to >= a) continue
      const titleEnd = a + 1 + m[1].length
      b.add(a, a + 1, hidePath)
      b.add(a + 1, titleEnd, titleMark)
      b.add(titleEnd, z, hidePath)
    }
  }
  return b.finish()
}
const noteLinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = noteDecorations(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = noteDecorations(u.view)
    }
  },
  { decorations: v => v.decorations },
)

/** The note link under a position, if any. */
function noteAt(doc: string, pos: number) {
  const line0 = doc.lastIndexOf('\n', pos - 1) + 1
  const line1 = doc.indexOf('\n', pos)
  const line = doc.slice(line0, line1 < 0 ? doc.length : line1)
  for (const m of line.matchAll(NOTE_LINK)) {
    const a = line0 + (m.index ?? 0)
    if (pos >= a && pos <= a + m[0].length) return notePathOf(`note:${m[2]}`)
  }
  return ''
}

const prose = HighlightStyle.define([
  { tag: t.heading1, fontSize: 'var(--ed-h1, 1.9em)', fontWeight: '700', letterSpacing: '-0.02em' },
  { tag: t.heading2, fontSize: 'var(--ed-h2, 1.28em)', fontWeight: '700' },
  { tag: t.heading3, fontSize: 'var(--ed-h3, 1.12em)', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--ed-link)', textDecoration: 'underline', textUnderlineOffset: '3px' },
  { tag: t.url, color: 'var(--ed-muted)' },
  { tag: t.monospace, fontFamily: 'var(--ed-mono)', fontSize: '0.9em', color: 'var(--ed-code)' },
  { tag: t.quote, color: 'var(--ed-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--ed-faint)' },
  { tag: t.keyword, color: 'var(--hl-keyword)' },
  { tag: t.string, color: 'var(--hl-string)' },
  { tag: t.comment, color: 'var(--hl-comment)' },
  { tag: t.number, color: 'var(--hl-number)' },
])

const theme = EditorView.theme({
  '&': { fontSize: 'var(--ed-size, 16.5px)', backgroundColor: 'transparent', color: 'var(--ed-text)' },
  '.cm-scroller': { fontFamily: 'var(--ed-font)', lineHeight: 'var(--ed-leading, 1.75)' },
  '.cm-content': { padding: '8px 0 30vh', caretColor: 'var(--ed-text)', minHeight: '50vh' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ed-text)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--ed-selection) !important',
  },
  '.cm-placeholder': { color: 'var(--ed-faint)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-match)' },
  '.cm-panels': { backgroundColor: 'var(--popover)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--ed-font)', fontSize: '13px' },
})

interface Props {
  /** A new key starts a fresh editor (another note). */
  docKey: string
  value: string
  onChange: (text: string) => void
  onSave?: () => void
  placeholder?: string
  /** Put the cursor in it as soon as it's there (full screen; a note just made). */
  autoFocus?: boolean
  /** A "note-focus" event with this id puts the cursor at the end (typing on a selected note card). */
  focusId?: string
  /** Notes to refer to: [[ lists them, and Ctrl+click on a link to one opens it. */
  notes?: () => NoteChoice[]
  onOpenNote?: (path: string) => void
}

export function Editor({ docKey, value, onChange, onSave, placeholder, autoFocus, focusId, notes, onOpenNote }: Props) {
  const notesRef = useRef(notes)
  const openRef = useRef(onOpenNote)
  notesRef.current = notes
  openRef.current = onOpenNote
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  const saveRef = useRef(onSave)
  changeRef.current = onChange
  saveRef.current = onSave

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(prose),
        theme,
        cmPlaceholder(placeholder || 'Write…'),
        ...(notes
          ? [
              autocompletion({ override: [noteSource(() => notesRef.current?.() || [])], icons: false }),
              noteLinks,
              EditorView.domEventHandlers({
                mousedown: (e, v) => {
                  if (!(e.ctrlKey || e.metaKey)) return false
                  const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
                  const p = pos == null ? '' : noteAt(v.state.doc.toString(), pos)
                  if (!p) return false
                  e.preventDefault()
                  openRef.current?.(p)
                  return true
                },
              }),
              keymap.of(completionKeymap),
            ]
          : []),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (saveRef.current?.(), true) },
          // Esc leaves the note (the board's keys work again); with search open, it closes search first
          { key: 'Escape', run: v => (searchPanelOpen(v.state) ? false : (v.contentDOM.blur(), true)) },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of(u => {
          if (u.docChanged) changeRef.current(u.state.doc.toString())
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    if (autoFocus) {
      v.dispatch({ selection: { anchor: v.state.doc.length } })
      v.focus()
    }
    return () => {
      v.destroy()
      view.current = null
    }
    // A new editor per note; value changes for the same note are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // Typing on a selected note card: the cursor goes to the end and the key lands in the note.
  useEffect(() => {
    if (!focusId) return
    return onEvent('note-focus', (d: { id?: string }) => {
      const v = view.current
      if (!v || d.id !== focusId) return
      v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true })
      v.focus()
    })
  }, [focusId])

  // Text replaced from outside (reloaded from disk): swap it in, keeping the cursor where it can be.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current === value) return
    const head = Math.min(v.state.selection.main.head, value.length)
    v.dispatch({ changes: { from: 0, to: current.length, insert: value }, selection: { anchor: head } })
  }, [value])

  return <div className="editor" ref={host} />
}
