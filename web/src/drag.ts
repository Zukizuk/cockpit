// Dragging something out of a card or a panel onto the board: it becomes a card where it's dropped. Every list in
// Cockpit (Quick access, Later, Outputs, a folder card) gives its rows these props; the board takes the drop (App).
import type { DragEvent } from 'react'
import type { QuickThing } from './board'

export const BOARD_DRAG = 'application/x-cockpit-quick'

export function dragToBoard(thing: QuickThing | (() => QuickThing | null)) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      const t = typeof thing === 'function' ? thing() : thing
      if (!t) return e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.setData(BOARD_DRAG, JSON.stringify(t))
      // other programs get the plain address (a link into the browser, a path into a text box)
      if (t.kind === 'link' || t.kind === 'file' || t.kind === 'folder') e.dataTransfer.setData('text/plain', t.target)
      e.dataTransfer.effectAllowed = 'copy'
    },
  }
}
