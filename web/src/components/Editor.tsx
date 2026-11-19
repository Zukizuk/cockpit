// A markdown editor for writing (not for code): CodeMirror with prose styling, history, search and Ctrl+S.
// Its colours and sizes come from --ed-* variables, so a sticky note's paper can set its own.
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap, searchPanelOpen } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { onEvent } from '../lib'

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
}

export function Editor({ docKey, value, onChange, onSave, placeholder, autoFocus, focusId }: Props) {
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
