// The keyboard shortcuts, one list. Single keys work on the board when nothing is being typed, so they never
// take a key from a text box, a note or the browser; with a note selected, typing goes into the note. What moves
// the whole board (Tidy) needs Ctrl, so a stray key can't do it, and every layout change can be undone.
import { useBoard } from '../board'
import { Kbd } from '@/components/ui/kbd'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const KEYS: { keys: string[]; what: string }[] = [
  { keys: ['Ctrl', 'K'], what: 'Add, or find anything kept (also /)' },
  { keys: ['N'], what: 'New sticky note' },
  { keys: ['L'], what: 'Later' },
  { keys: ['O'], what: 'Outputs' },
  { keys: ['C'], what: 'Snippets: things to copy' },
  { keys: ['Q'], what: 'Quick access: pinned and often opened (then 1 to 9 opens one); P works too' },
  { keys: ['T'], what: "Today's tasks" },
  { keys: ['J'], what: "Today's journal" },
  { keys: ['0'], what: 'Show everything' },
  { keys: ['F'], what: 'Fold or unfold the selected card' },
  { keys: ['Ctrl', 'Alt', 'T'], what: 'Tidy: pack every card from the top-left, sizes kept (locked ones stay)' },
  { keys: ['Ctrl', 'Shift', 'L'], what: 'Lock the selected card in place, or unlock it' },
  { keys: ['Ctrl', 'Z'], what: 'Undo a move, resize, tidy or removal (Ctrl Y redoes)' },
  { keys: ['Enter'], what: "Write in the selected note or card's box (or just start typing)" },
  { keys: ['F2'], what: 'Give the selected note a title, or rename it' },
  { keys: ['Space'], what: 'Open the selected card full screen' },
  { keys: ['Delete'], what: 'Take the selected card off the board' },
  { keys: ['Esc'], what: 'Leave a note, close, or deselect' },
  { keys: [','], what: 'Settings' },
  { keys: ['?'], what: 'This list' },
  { keys: ['Ctrl', 'Alt', 'K'], what: 'Bring Cockpit up from anywhere in Windows' },
]

export function KeysDialog() {
  const board = useBoard()
  return (
    <Dialog open={board.keysOpen} onOpenChange={board.setKeysOpen}>
      <DialogContent className="glass-panel max-h-[calc(100vh-48px)] grid-cols-1 overflow-y-auto sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {board.prefs.singleKeys ? "Single keys work on the board whenever you're not typing." : 'Single keys are off (Settings); the Ctrl ones still work.'}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {KEYS.map(k => (
            <li key={k.what} className="flex items-center justify-between gap-4 border-b border-ink/[0.06] py-2 text-[13.5px]">
              <span>{k.what}</span>
              <span className="flex shrink-0 gap-1">
                {k.keys.map(key => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
