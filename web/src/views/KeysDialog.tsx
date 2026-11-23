// The keyboard shortcuts, in four groups: opening things, the selected card, the board, and anywhere. Single keys
// work on the board when nothing is being typed, so they never take a key from a text box, a note or the browser;
// with a card selected, typing goes into it. What moves the whole board (Tidy) needs Ctrl, so a stray key can't do
// it, and every layout change can be undone.
import { useBoard } from '../board'
import { Kbd } from '@/components/ui/kbd'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Key = { keys: string[]; what: string }

export const KEY_GROUPS: { title: string; keys: Key[] }[] = [
  {
    title: 'Open',
    keys: [
      { keys: ['Ctrl', 'K'], what: 'Add, or find anything kept (also /)' },
      { keys: ['N'], what: 'New sticky note' },
      { keys: ['J'], what: "Today's journal" },
      { keys: ['L'], what: 'Later' },
      { keys: ['C'], what: 'Snippets' },
      { keys: ['T'], what: "Today's tasks" },
      { keys: ['Q'], what: 'Quick access (then 1 to 9 opens one)' },
      { keys: ['O'], what: 'Outputs' },
    ],
  },
  {
    title: 'Selected cards',
    keys: [
      { keys: ['Enter'], what: 'Write in the selected one (or just start typing)' },
      { keys: ['Space'], what: 'Open the selected one full screen (two selected: side by side)' },
      { keys: ['F2'], what: 'Give a note a title, or rename it' },
      { keys: ['F'], what: 'Fold or unfold them' },
      { keys: ['H'], what: 'Hide their contents, or show them (sharing the screen)' },
      { keys: ['Ctrl', 'Shift', 'L'], what: 'Lock them in place, or unlock them' },
      { keys: ['Delete'], what: 'Take them off the board' },
    ],
  },
  {
    title: 'The board',
    keys: [
      { keys: ['Scroll'], what: 'Move around (or hold Space and drag)' },
      { keys: ['Drag'], what: 'On empty board: select several cards' },
      { keys: ['Shift', 'Click'], what: 'Add a card to the selection' },
      { keys: ['Ctrl', '+'], what: 'Zoom in (Ctrl − zooms out)' },
      { keys: ['Ctrl', '0'], what: 'Back to 100%' },
      { keys: ['0'], what: 'Show everything' },
      { keys: ['Ctrl', 'Alt', 'T'], what: 'Tidy: line cards up from the top-left' },
      { keys: ['[', ']'], what: 'The space before or after (S lists them)' },
      { keys: ['Alt', '1'], what: 'Go to space 1 (to 9)' },
      { keys: ['Ctrl', 'Z'], what: 'Undo (Ctrl Y redoes)' },
    ],
  },
  {
    title: 'Anywhere',
    keys: [
      { keys: ['Esc'], what: 'Leave a note, close, or deselect' },
      { keys: [','], what: 'Settings' },
      { keys: ['?'], what: 'This list' },
      { keys: ['Ctrl', 'Alt', 'K'], what: 'Bring Cockpit up from anywhere in Windows' },
    ],
  },
]

export function KeysDialog() {
  const board = useBoard()
  // the extras turned on (Settings > Extras) bring their keys
  const extra: Key[] = board.prefs.extras.dictionary
    ? [
        { keys: ['D'], what: 'The Dictionary' },
        { keys: ['Ctrl', 'D'], what: 'The selected word’s meaning, right beside it (in a note too)' },
      ]
    : []
  const groups = extra.length ? [...KEY_GROUPS, { title: 'Extras', keys: extra }] : KEY_GROUPS
  return (
    <Dialog open={board.keysOpen} onOpenChange={board.setKeysOpen}>
      <DialogContent className="glass-panel max-h-[calc(100vh-48px)] grid-cols-1 overflow-y-auto sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {board.prefs.singleKeys ? "Single keys work on the board whenever you're not typing." : 'Single keys are off (Settings); the Ctrl ones still work.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map(g => (
            <section key={g.title}>
              <h3 className="mb-1 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              <ul>
                {g.keys.map(k => (
                  <li key={k.what} className="flex items-center justify-between gap-4 border-b border-ink/[0.06] py-2 text-[13.5px] last:border-0">
                    <span>{k.what}</span>
                    <span className="flex shrink-0 gap-1">
                      {k.keys.map(key => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
