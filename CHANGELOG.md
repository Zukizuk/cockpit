# What's new in Cockpit

Newest first. Each change is listed under New, Improved or Fixed.

## 20 November 2026 (version 0.1.2)

**New**
- **Select several cards** by dragging a box on empty board, as in FigJam. Shift- or Ctrl-click adds one. Move them together; Delete, Lock and F work on all of them. Scroll (or two fingers on a touchpad) moves around the board, and so does dragging with Space held or with the middle button.
- **Zoom buttons** at the bottom right (− and +), with **?** for the shortcuts beside them. Ctrl + and Ctrl − zoom the board; Ctrl 0 goes back to 100%.

**Improved**
- The shortcuts list is grouped: Open, Selected cards, The board, Anywhere.
- The sticky-note button in the dock is a little sticky note, in your colour, that pops up when you point at it.
- Settings shows just the version at the bottom.

**Fixed**
- A workbook on the board sometimes jumped back to its first sheet while you were reading another one.
- Inside sticky notes, some hover shades and lines weren't drawn (since light mode).

## 19 November 2026 (evening)

**New**
- **Light mode.** Settings > Theme: Light, Dark, or Like Windows (new installs follow Windows). It switches instantly, menus, notes, code and diagrams included.

**Improved**
- **Excel, Word and PowerPoint open much faster.** A preview is made once and kept, so opening the same file again is instant, even after a restart (a 12 MB workbook went from about 10 seconds every time to a few milliseconds). The first read runs in the background, so the rest of Cockpit never waits for it. A workbook shows one sheet at a time and loads another when you pick it; long sheets show their first 150 rows, with the rest a click away.
- Cards that show a document or a sheet aren't redrawn when something else on the board changes, so the board stays quick with big cards on it.
- The board's dots are bigger and easier to see.

**Fixed**
- The Snippets card couldn't be made taller. It still fits what's in it, until you drag it taller; then it keeps that height. "Fit to contents" in its menu goes back.
- A draft from Claude put on the board had no way to copy it. It now has a copy button in its header, and "Copy the text" in its menu (so do other text cards).

## 19 November 2026 (version 0.1.1)

**New**
- **Cockpit is open source** (MIT). It installs with a double-click: download the release, unzip it and run Install.cmd. It brings its own Node, adds Cockpit to the Start menu, starts it at login, sets up Ctrl+Alt+K, and offers to connect Claude Code. Uninstall.cmd takes it away and keeps your notes.
- **Send feedback** (Settings, right-click the board, or Ctrl+K): opens a GitHub issue with your Cockpit version and Windows build filled in.
- **Anonymous usage counts, only if you say yes.** After its first day, Cockpit asks once. With a yes, it counts how often features are used (for example, sticky notes made or Tidy used) and sends one summary a day, with the version and Windows build. It never sends what's on your board: no text, titles, links, paths or file names. Settings shows exactly what's sent and turns it off, which also forgets anything counted.
- **A welcome on first launch:** a few sticky notes that say how Cockpit works, and the Later card.

**Improved**
- New installs keep notes in Documents\Cockpit, so they never mix with other notes. Existing setups keep their folder.
- The Outputs button appears in the dock once something has arrived there.

## 18 November 2026 (night)

**New**
- **Right-click the empty board** for what applies to the whole board: a sticky note right there, fold or unfold all cards, Tidy, show everything, undo and redo, shortcuts, What's new and Settings.
- **The journal card always shows today.** On a new day it moves to the new page by itself, and J brings it back to today from anywhere. ‹ › step back through earlier days, including entries written on your phone. An earlier day is read-only until you unlock it (the lock button), and it still syncs with Kokoro if you change it.
- **Note titles:** a note has no title until you give it one, and its card says "Untitled" ("Untitled Journal" for the journal; a sticky note shows it only on hover). Click the top of the card, press F2, or use "Add a title" in its ⋯ menu. The title shows only at the top of the card and never goes into the note, so the note stays plain writing. Leave it empty to remove it.

**Improved**
- Notes and text files now open in **Notepad** instead of VS Code. You can choose Notepad, VS Code or the default app in Settings.
- Select the Today, Later or Snippets card and just start typing: the words go into its box, as they already did for notes.
- **Later** rows are back to one line. On hover the buttons cover the right end of the row, like on Outputs, and ⋯ has the rest.

## 18 November 2026 (evening)

**New**
- **What's new:** this page. Open it from Settings or from the + box (Ctrl+K, then "What's new").
- **Board settings:** pick a default colour for new sticky notes, choose how much space Tidy leaves between cards, and turn the single-letter shortcuts off if you'd rather keep only the Ctrl ones.

**Improved**
- New sticky notes are charcoal by default. You can change the default in Settings, or change one note from its ⋯ menu.
- The shortcuts list fits on the screen: two columns, scrolling if it ever gets longer.

## 18 November 2026

**New**
- **Sticky notes:** press N, use the dock, or pick "Sticky note" in Ctrl+K. Click anywhere on one and type, or select it and just start typing. They come in five colours and have a folded corner. Each one is a file in `notes/stickies`, named by its first line.
- **Lock in place** (Ctrl+Shift+L, or the card's menu): a locked card can't be moved, resized or deleted, and Tidy works around it.
- **Undo and redo** for the board (Ctrl+Z, Ctrl+Y): moves, resizes, folds, Tidy, and cards added or removed. Removing a card or tidying shows an Undo button.

**Improved**
- **Tidy** (now Ctrl+Alt+T) keeps every card's size and your zoom. It lines cards up from the top-left of the screen, roughly in the order they were in, filling the space under shorter cards.
- **Later:** every row's buttons appear under its name on hover, with Copy added; they're also on right-click. Notes in Later are edited in place and can be copied or turned into a sticky note. Long links are cut off with "…" instead of scrolling sideways.
- Journal cards open ready to write.
- Menus are more solid, so they stay readable over a bright sticky note.

**Fixed**
- Typing while a note was in Read mode set off shortcuts. G and Shift+F are gone, and a capital letter is never a shortcut.
- The Snippets card could get stuck short with no way to make it taller.
- A Later note moved to Reading when clicked.
- A task typed into the Today card with no date went to the Todoist inbox and seemed to vanish. It's now due today.

## 17 November 2026

**New**
- **Snippets** (C): things to copy in one click. Secrets are hidden, encrypted on disk, and gone as soon as you delete them. Claude can leave things here too.
- **Quick access** (Q): your pins plus what you open most often. A row opens in its own program; drag it onto the board to make a card.
- **Journal sync with Kokoro:** one journal, synced with Kokoro over SSH only when something changed, at most every 3 hours and once after 23:00. Thoughts from the + box go into today's page.
- **The Cockpit helper:** keeps the server running and brings it back if it stops.

**Improved**
- Snippets redesigned: a single paste box and slim rows, and the card is only as tall as what's in it.

**Fixed**
- A note open on a card and full screen at the same time said it had "changed on disk" while you typed.
- A new pin didn't show up until a reload.

## 16 November 2026

**New**
- **Cockpit:** a local, free-form board for files, links, notes and what Claude makes.
- **Later** (L): paste a link anywhere and it's kept to check later, with the page read in the background. It moves through To check, Reading and Done.
- **Outputs** (O): what Claude made, one group per chat, with commands you can run in place and changes shown GitHub-style.
- Ctrl+Alt+K brings Cockpit up from anywhere in Windows.
- Cards fold to their title. Single-letter shortcuts, with a list under ?.

**Improved**
- New cards land in free space, never on top of others. Image cards take the image's shape.
- Zooming works on the empty board too. Links open through Windows, so your browser picker chooses.
