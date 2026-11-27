// The computer Cockpit runs on, for the words it uses: on a Mac, Finder, TextEdit and Terminal, and shortcuts written
// the way a Mac writes them (⌘K for Ctrl K). The page opens on the same computer as Cockpit's server, so the browser's
// platform is the computer's. Every shortcut already takes ⌘ wherever it takes Ctrl; only the words change here.

export const mac = /^Mac/.test(navigator.platform)

/** What shows a file in its folder. */
export const fileManager = mac ? 'Finder' : 'Explorer'
/** The computer, as in "kept on this PC". */
export const computer = mac ? 'Mac' : 'PC'
/** The system, as in the theme "Like Windows". */
export const system = mac ? 'macOS' : 'Windows'
/** Where "Open in a terminal" opens a command. */
export const terminalApp = mac ? 'Terminal' : 'Windows Terminal'
/** The key held for shortcuts, as in "the Ctrl ones". */
export const mod = mac ? '⌘' : 'Ctrl'

const SYMBOL: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' }
// a Mac lists its modifiers in this order (⌃⌥⇧⌘), then the key
const ORDER = ['⌥', '⇧', '⌘']

/**
 * The keys of a shortcut as this keyboard names them: ['Ctrl', 'Shift', 'L'] as it is on Windows, ['⇧', '⌘', 'L'] on
 * a Mac. Redo is Ctrl Y on Windows and ⇧⌘Z on a Mac (the board takes both).
 */
export function keyList(keys: string[]): string[] {
  if (!mac) return keys
  const named = keys.length === 2 && keys[0] === 'Ctrl' && keys[1] === 'Y' ? ['Shift', 'Ctrl', 'Z'] : keys
  const mods = named.filter(k => SYMBOL[k]).map(k => SYMBOL[k])
  mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  return [...mods, ...named.filter(k => !SYMBOL[k])]
}

/** A shortcut written out, as this keyboard names it: "Ctrl Alt T" or "Ctrl+Alt+T" as it is on Windows, "⌥⌘T" on a Mac. */
export function shortcut(keys: string): string {
  if (!mac) return keys
  // "Ctrl +" and "Ctrl −" name the plus and minus keys; elsewhere a + only joins keys
  const parts = keys.split(/\s+/).flatMap(t => (t === '+' ? [t] : t.split('+').filter(Boolean)))
  return keyList(parts).join('')
}

/**
 * The letter a shortcut was pressed with. On a Mac, Option changes what a key types (⌥T types †): with ⌘ and ⌥ both
 * held and no plain letter typed, the letter is read from where the key is on the keyboard. A plain letter is kept
 * as typed, so AZERTY and Dvorak keep their own letters.
 */
export function letterOf(e: KeyboardEvent): string {
  const key = e.key.toLowerCase()
  if (e.metaKey && e.altKey && !/^[a-z]$/.test(key) && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  return key
}
