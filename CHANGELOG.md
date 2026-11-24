# What's new in Cockpit

Newest first. Each change is listed under New, Improved or Fixed.

## Coming next (version 0.2.6)

**Improved**
- Pasting a link and Later work together better. Press Ctrl+Shift+V (or select Later and paste) and the link goes straight to Later, without opening on the board first. A link pasted the usual way stays on the board as before, and the toast's Keep on Later too (or Keep on Later in the card's menu) also puts it on Later, under Reading, instead of taking the card away. Done reading in the card's menu ticks it off.
- A short password pasted on the board, 12 characters or more of mixed letters and digits like `nkC6Hsyvm8UnRe`, now goes into Snippets as a secret. Before, only 20 characters or more counted. Words with a number on the end or a date still don't.
- A snippet you keep without a name shows its value once, instead of the same text twice as its name and its value.
- Installing and updating are quicker. Cockpit is now about 250 files instead of 2,250, so it unzips in a few seconds.
- The journal is now an extra, off until you turn it on in Settings → Extras. If you already write in it, it stays on. With it off, words typed in the + box become a sticky note, and Keep in the Dictionary keeps the word on a sticky note.

## 24 November 2026 (version 0.2.5)

**Improved**
- A one-line install: paste `irm https://raw.githubusercontent.com/Zukizuk/cockpit/main/scripts/package/get.ps1 | iex` in PowerShell. It downloads the latest Cockpit, checks it and installs it, without the long wait for Windows to check a downloaded zip before Install.cmd will run.
- Opening an Excel file for the first time after you start your PC is quicker: Cockpit no longer loads its Word reader for a workbook, which alone could take several seconds then. Cockpit also starts a little faster.

## 24 November 2026 (version 0.2.4)

**Fixed**
- Shortcuts on French (AZERTY) and other keyboards that type [ and ] with AltGr: [ and ] now go to the space before or after, Alt with the 1 to 9 keys jumps to a space (no Shift needed), and Ctrl with the 0 key sets the zoom back to 100%.

## 24 November 2026 (version 0.2.3)

**Improved**
- New installs start with up-to-date welcome notes: pasting links, files and images, comments, full screen and side by side, Excel cells and columns, connecting Claude Code, spaces, and hiding cards while you share your screen. One note used to say pasted links go to Later; they become cards now. Boards you already have don't change.

## 24 November 2026 (version 0.2.2)

**New**
- **Side by side.** Open two things full screen next to each other to compare them: select two cards and press Space (or right-click, Compare side by side), or press the compare button in a card's full screen and pick the other one (a card, anything kept, a note, or a pasted path or link). Each side scrolls on its own and notes stay editable, so you can read one and write in the other. Drag the line between them to make one side wider (double-click it to even them). The bar at the bottom swaps the sides, makes both scroll together, and shows the differences between the two line by line. Each side's ✕ closes just that side; Esc closes both. Claude can open two cards side by side for you too.

## 23 November 2026 (version 0.2.1)

**New**
- Excel workbooks: long values no longer stay cut off. Click a cell to read all of it in a bar above the sheet. Drag a column's edge (on the A, B, C letters) to widen it, or double-click the edge to fit its longest value. Widths are kept for each file and sheet.

**Improved**
- Anonymous usage counts (only if you said yes) no longer carry a rough location. PostHog used to work out a city and country from the connection they came from; Cockpit now tells it not to.

**Fixed**
- Show in folder opened your Documents folder instead of the file's own folder when its path had a space in it. It now opens the right folder with the file selected.

## 23 November 2026 (version 0.2.0)

**New**
- **Claude works on your board with you.** In a Claude Code chat, Claude can see your board and use it: name a card ("my sticky note Post ideas") or select one and say "the selected card", and it reads just that one. It sees each card's first lines and comments, and can comment back, fold or unfold, bring a card into view, move it to another space, rename a note or change a sticky note's colour. It can add and tick off today's tasks, keep links on Later, leave snippets, add a sticky note or a line to today's journal, and make and switch spaces. Everything it changes shows on the board as it happens, and taking anything away always waits for you to click Allow.
- **Spaces.** Keep more than one board: the name at the top left switches between them, makes a new one, renames or removes one. [ and ] go to the space before or after, Alt+1 to 9 jumps to one. A card's menu sends it to another space, and Undo brings it back. Each space remembers where you were looking.
- **Comments on cards.** Any card can have a thread, for you and for Claude: a small bubble on its corner shows how many, with a dot when Claude has the last word. Hover a card for a +, or use Comment in its menu.
- **Sharing your screen?** The eye on a card (or H with cards selected) hides what's in it, title too, behind a blur, and the card stays where it is; click it to show it again. Or tuck a card away from its menu: it becomes a small tab hanging from the top edge of the screen, with its title (in its colour, for a sticky note), and a click brings it back to where it was. Each space has its own.
- **Paste anything on the board.** It lands where your mouse is, by what it is: an image becomes a card, and so does a link (the toast can send it to Later instead); a key, token or password goes straight into Snippets, hidden and encrypted; a file path becomes a card. Images dropped from Explorer become cards too.
- **Extras: things you turn on yourself.** Settings has a new Extras page. Each extra stays out of the way (no key, nothing in the + box) until you turn it on there. The first two:
  - **Dictionary.** 128,000 English words kept on this PC, so it works without the internet: meanings with examples, the pronunciation (▶ says it aloud), and words that mean the same or the opposite, each a link to its own meaning. Press D for a search bar that grows with what it finds, or do as on a Mac: select a word anywhere (in a note, a page, a card) and press Ctrl+D, and its meaning shows right beside it. In a note, with nothing selected, it's the word at the cursor. "Ran" finds run and "children" finds child. Keep puts the word and its meaning in today's journal.
  - **Tables.** A grid right on the board, from the + box: no card around it, just its name above it (drag it by that) and a + on its right and bottom edges for a column or a row. Right-click a cell to insert or delete its row or column. Type in the cells; Tab and Enter move along (Enter after Tab goes back to the row's first column, as in Excel) and add a row at the end. Paste a block copied from Excel and it fills the cells; Copy puts it back for Excel, or as Markdown for a note or a chat. Each table is a .csv file in your notes folder (tables/), so it opens in Excel too. A table taken off the board is kept, and the + box finds it by name to put it back; one you never typed in just goes. Delete table (in its menu) moves it to the notes folder's archive. Claude can make a table on your board, read it and fill it in; writing over all of it or taking a row out waits for your Allow.

**Improved**
- **Is Claude Code connected?** Settings → Claude Code now says whether Outputs and Claude's board tools are connected, and a Connect button sets them up if the installer didn't (if Claude Code's command wasn't found then, say). The Outputs button is always on the bottom toolbar, and while it's empty it points there.
- **Outputs, tidier.** Each chat in the Outputs panel folds: the newest is open, the rest show just their name and how much they made, and a click opens one. What a chat made ("18 links", "4 drafts"…) is shown as chips you click to see only those, in the panel and on its card on the board; the card is named after the chat.
- **Focus on several cards.** Select two or more (drag a box, or Shift+click) and choose Focus on these cards from a card's menu: they're laid out side by side in the middle, everything else folds into a column on the left, and Bring everything back puts every card back as it was. Claude can do it too ("put Post ideas and the Note apps table side by side and focus on them").
- Claude can put a card next to another one ("put the table to the right of Post ideas": right, left, below or above, in a free spot) and tidy the board as Ctrl+Alt+T does; Ctrl+Z undoes either.
- Claude can put a sticky note, a file or link, or a table straight into another space ("put it in Research"), without taking you there.
- After you select several cards by dragging, they're simply outlined: no box is left around them.
- Claude can show you visuals (charts, diagrams, small pages) as cards, drawn safely.

**Fixed**
- With a card in focus, its "Bring everything back" bar sat at the top, over the tabs of tucked-away cards. It's now just above the bottom toolbar.
- An Excel workbook on the board could jump back to its first row and column every so often, while Excel's AutoSave or OneDrive touched the file (on any sheet but the first). It now keeps your place and swaps in the new cells quietly.
- Snippets' paste box could come out squashed after the card was unfolded. It's now sized by the browser itself, and the card can never be shorter than the box.
- Rows in the Outputs panel can be dragged onto the board.

## 22 November 2026 (version 0.1.8)

**Fixed**
- Dragging a row from the Outputs panel onto the board did nothing: the panel dimmed the board and caught the drop. It now opens beside the board, like Quick access, and a dragged row becomes a card where you drop it.

## 22 November 2026 (version 0.1.7)

**New**
- **Send to → Cockpit.** Right-click files or folders in Explorer, choose Send to, then Cockpit: each one comes onto the board, a folder as a folder card, and Cockpit comes to the front. If Cockpit isn't running, it starts and they're waiting on the board. (Installing or updating to this version adds the entry.)
- **Choose files…** in the + box opens Windows' own Open dialog. Pick one file or several; each becomes a card.

**Improved**
- Something Claude shows while no Cockpit window is open now comes up on the board when you next open it (within ten minutes), instead of only being listed.

## 21 November 2026 (version 0.1.6)

**New**
- **Refer to your notes from the journal.** Type `[[` in a journal page and pick a note (sticky notes first): it goes in as a link that reads as the note's title. Click it in the reading view, or Ctrl+click while writing, to open the note; the notes a page refers to are also listed under it. With the journal synced to Kokoro, each page takes the text of the notes it refers to along at its end, and a change to one of those notes is synced with it. Coming back from Kokoro, the page keeps just the links.

## 20 November 2026 (version 0.1.5)

**Improved**
- **Often opened** in Quick access is choosier. Something shows there once you've opened it on three different days in two weeks (ten opens in one sitting count as one day), and it leaves by itself after a week without opening it. What's new, journal pages and anything already on the board are never listed there.

## 20 November 2026 (version 0.1.4)

**Improved**
- Settings > Updates says plainly whether you're up to date, with a **Check for updates** button and **Install** when there's a new version. A copy run from its code folder can check too, and says how to update it.
- Settings > Privacy says when usage counts were last sent and which days: a day that has been sent is gone from your PC, so the preview alone looked like nothing had gone.
- Settings is one sheet of glass again, and the Outputs panel lost its line of explanation at the top.

**Fixed**
- Snippets could get stuck at a fixed height and cut off its own paste box: a click on a resize corner (without dragging) fixed its height. Now only a real drag does, it can't be made shorter than the paste box, and a card already stuck goes back to fitting its content.

## 20 November 2026 (version 0.1.3)

**New**
- **Updates.** Cockpit checks for a new release about once a day. When there is one, the Settings button gets a dot and Settings > Updates offers **Update now**: it downloads the release, checks it against the checksum GitHub publishes, installs it and reopens Cockpit, with your notes and board untouched. You can turn the check off. (From 0.1.2, install this version by hand once; after that it updates itself.)
- **Outputs for everyone using Claude Code.** The installer offers a small Claude Code hook that lists what each turn made under Outputs: files written or edited, drafts, commands and links. Uninstall takes it out again.
- **A daily copy of the board**, the last 14 kept in `.cockpit/backups`.
- **Folders on the board.** Paste a folder's path (or put a pinned folder on the board) and it becomes a card with its files as a tree. Open subfolders in place; click a file to open it as a card beside the folder, or double-click to open it in its own program. Bigger folders get a box to find a file by name.
- **Today works without Todoist.** With no Todoist connected, the Today card (T) is a simple to-do list kept on this PC. Click a task's words to change them; tick it off or remove it. With Todoist, you can now change and remove tasks too.
- **Keep Quick access open.** The pin at the top of Quick access keeps it beside the board while you work, until you close it (or press Q).
- **Drag anything onto the board.** Rows in Later, Outputs, Quick access and a folder card all become cards where you drop them, and so does a link dragged in from the browser.

**Improved**
- A new task shows on the Today card at once, and is saved to Todoist in the background.
- Settings has its sections down the left and keeps one size, so nothing jumps in after it opens.
- Trackers add themselves: when a Claude Code chat works in a folder with a tracker, it's listed (Settings > Claude Code), and Remove takes one off for good. No list of paths to type. Cockpit only looks through your Projects, Desktop and synced folders for trackers if you turn that on.
- Switching sheets in a workbook is instant: the other sheets load in the background once the first is shown.
- A file's place reads as the two folders it's in ("Coupa › Savings Tracker"), not its whole path, on cards, in full screen and in Quick access. Quick access lost its long description.
- If Cockpit can't start (another program on its port, say), opening it says so instead of doing nothing. Without Edge, it opens in your default browser.
- The installer says plainly when Ctrl+Alt+K couldn't be set up, and Uninstall reminds you to remove a Cockpit installed as an app from Edge.
- A smaller download.

**Fixed**
- Installing or uninstalling one copy of Cockpit stopped the Ctrl+Alt+K helper of any other copy on the same PC.
- A PC without the hub listed a tracker called "hub" that couldn't be found.

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
