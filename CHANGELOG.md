# What's new in Cockpit

Newest first. Each change is listed under New, Improved or Fixed.

## Coming next

**Fixed**
- Setup's "Open Cockpit" opens Cockpit as the app you installed from Edge, if you did, so you no longer get a second Cockpit window beside it.
- Cockpit's icon is sharp in the taskbar, on shortcuts, in Setup and in Settings > Apps: each size is drawn for itself instead of scaled down.
- On a Mac, Ctrl+click on a note's text opens Cockpit's menu again.

## 28 November 2026 (version 0.2.23)

**Improved**
- Menus show only what fits what you clicked. Right-click a table cell for just the cell, its row and its column; right-click the table's title (or use its ⋯) for the table.
- A menu no longer repeats a button that's already in front of you: Comment (the bubble on the card's corner), the reader's ⋮ menu (its bar buttons), and the hover buttons on a Later or Quick access row.
- While Focus is on, the menus leave out Focus, Lock, Tuck, Shelf, Tidy and Fold all, which only get in its way.
- A table's Fold is in its menu, "Copy for Excel" is now "Copy the table", and "Copy as Markdown" is gone (ask Claude for Markdown).
- The board's menu greys Undo and Redo when there is nothing to undo or redo, and keeps Keyboard shortcuts, What's new, Settings and Send feedback under More.
- Compare side by side is offered only when two files, pages or notes are picked. A card's Fit to contents, Read the page again and the editor choices are under More.
- An arrow's two toggles are one "Arrowheads" choice: One end, Both ends or None, with the current one ticked. A snippet's "Keep for…" ticks the one set now.
- Remove from board shows its Del key on every card. A locked section no longer offers Remove.

**Fixed**
- Right-click in text you're typing in (a note, a table cell, an answer box) gives the usual Cut, Copy and Paste again, not the card's menu.
- Tucking or putting away the card in Focus no longer leaves Focus on with nothing in it.
- A table's ⋯ menu no longer loses "Filter rows" after you right-clicked a cell.
- With several cards picked, a picked section no longer counts in "these N", and Share or Private says what is true of all of them.

## 28 November 2026 (version 0.2.22)

**New**
- Sort a table: right-click a cell for "Sort by <column>, A to Z" or "Z to A". Numbers sort as numbers (9 before 10, 1,200 after 900), and empty cells go last. Claude can sort a table too.
- Formulas in a table, written as in Excel: =SUM(D2:D7), =B2*C2, =ROUND(D2/3, 1), with AVERAGE, MIN, MAX, COUNT and ABS too. A cell shows its result, and its formula while you edit it. Errors show as Excel shows them (#DIV/0!). The table still opens in Excel with its formulas working. Sorting keeps a total row at the bottom, and each formula moves with its row. Claude sees both the formula and its result.
- Filter a table: "Filter rows" puts a box under each heading, and only the rows that match what you type are shown, with "Showing 3 of 12 rows" above the table. The file keeps every row. The filter stays until you clear it.
- Draw on the board: the pen button (or B) lets you draw lines and boxes around and between your cards, in five colours, with an eraser. Each space has its own drawings, and Undo takes back a stroke. Right-click the board to clear a space's drawings. Esc or Done goes back to moving cards.
- Approve on the board: when you ask Claude for a change from the board (Tell Claude), it can leave its plan in Questions with Do it and Don't buttons. Your click goes straight to Claude, with no switching to the chat to say yes. This covers changes to the board only: anything outside Cockpit still asks in the chat.
- On a Mac, a clone set up with `npm run setup:mac` gets Cockpit.app: open Cockpit from Launchpad or Spotlight, or keep it in the Dock. It starts the server if needed and opens Cockpit in its own Chrome or Edge window. The server also starts at login.

**Improved**
- A folded card's menu has Unfold in it, and a hidden card's has Show its contents. Before, both were under More.
- A folded table says how many rows it has, and has an Unfold button, so it no longer looks empty.
- While Focus is on, the sections behind fade, so a section whose cards moved to the side doesn't look emptied.

## 27 November 2026 (version 0.2.21)

**Fixed**
- Claude's changes on the board no longer wait for you to come back to Cockpit. Edge froze Cockpit's page when its window had been in the background a while. Claude's change then waited there and was only made when you next used the window, long after Claude had given up. Cockpit now keeps its page awake while it's open. An idle board costs next to nothing.

## 27 November 2026 (version 0.2.20)

**Fixed**
- Claude doesn't do a board change twice anymore. When Cockpit's window was slow to answer, Claude could stop waiting even though the change still went through a moment later. It then tried again, and a table got the same row twice. Now Claude's next call on the board tells it the earlier one went through, so it doesn't repeat it.

## 27 November 2026 (version 0.2.19)

**New**
- Choose files… in the + box now works on macOS too, opening the Mac's own file picker.

**Fixed**
- On a Mac, Cockpit speaks Mac: Show in Finder (with the file selected), TextEdit in place of Notepad, Terminal in place of Windows Terminal, "this Mac", and shortcuts written ⌘K, ⌥⌘T, ⇧⌘L. ⌥⌘T (Tidy) and ⌥⌘G (a section) work, though Option changes the letter typed, and the delete key takes cards off the board.
- On a Mac, Run on a command from Outputs works: it runs in your own shell (zsh or bash, with your PATH), Stop ends everything it started, and Open in a terminal opens Terminal in its folder. PowerShell is offered when it's installed.
- On a Mac, the key that encrypts your secret snippets is kept in your Keychain, not in a file. A key already in the file moves there the next time it's used.
- Settings can find and connect to Claude Code on macOS and Linux, even when Cockpit starts outside your terminal.
- On a Mac, a quick right-click on the board or on a card opens its menu. It could pick the item under the pointer instead (on a card low on the screen, for example "Stop sharing with agents") and close the menu.

## 27 November 2026 (version 0.2.18)

**New**
- Copy the picture: a button on an image card's strip (and in its menu) puts the picture itself on the clipboard, to paste straight into a chat with Claude. A pasted picture's path is no use to an agent.
- Setup.exe: each release now comes with `Cockpit-Setup-<version>.exe` too. Run it to install, with no admin rights. Checkboxes choose the login start, the Ctrl+Alt+K hotkey, Send to and the Claude Code connection. Cockpit then shows in Settings > Apps, where you can remove it. The zip and the one-line install work as before, and Cockpit keeps updating itself.

## 27 November 2026 (version 0.2.17)

**Improved**
- A card's menu has everything it does again: sharing (and stopping it), moving to another space, lock, pin, show in folder, read again, back to the original. Only what the card's own strip already has (full screen, fold, hide, open, draw, a sticky note's tuck) and Copy path are under More. Moving to another space is in the menu itself.

## 26 November 2026 (version 0.2.16)

**New**
- Draw on a picture. "Draw on it" on an image card (its menu, or the brush button on the card) opens it large with a pen, a highlighter, arrows, boxes, circles, text, blur (to hide a name or a number before you share it) and crop, in six colours, with undo. Save, and the card shows your marked-up picture.
- The picture you started from is kept: "Back to the original" (under More on the card's menu) returns to it. A picture from your own folders is never changed or removed. One pasted into Cockpit keeps its original for 30 days after the edit, then Cockpit removes it so edits don't pile up.
- Claude can draw on a picture on your board too: circle what it means, point an arrow at it, add a label, or blur something out.

**Improved**
- A card's menu is shorter, so it fits on the screen without scrolling. It keeps what you can only do there (comment, focus, the shelf, and sharing with agents while a card isn't shared or private yet); what the card's own strip already has (full screen, fold, hide, open, draw) and the rarer actions (moving to another space, pin, copy the path) are under More.
- Menus stay clear of the screen's edges and show above messages at the bottom of the screen.

**Fixed**
- More on a card's menu now opens its side menu. It could open hidden, cut off by the menu it came from, so it looked like nothing happened.
- The dots beside More sit apart from the word, like the other icons.

## 26 November 2026 (version 0.2.15)

**Improved**
- Claude now knows when cards on your board lie on top of each other or stick out of their section, and fixes it before saying the board is tidy. Before, it couldn't tell and asked you to look.
- When Claude puts cards in a section, it lays them out in rows inside it, and "tidy" on a section does the same.
- "Tidy what's in it" on a section's menu lays its cards out in rows, nothing on top of anything, and fits the section round them. Undo puts them back.
- When Claude leaves you a question, the Questions card comes out to where you're looking, opened, even if it was tucked away or inside a tucked section. Before, the question could sit out of sight.
- Moving a card into a tucked, shelved or folded section brings the section back first, instead of failing.
- A "Stop listening" button beside Tell Claude lets a chat that's listening for the board go, and tells it not to start again unless you ask.
- Claude can tell which cards it made, in this chat or an earlier one, so it leaves yours alone.
- Claude can name a card by its short reference wherever it names another card (beside, arrows, focus), and keeps using it when a note's title changes.
- Claude can put a whole section on the shelf in one step, instead of shelving its cards one by one, and it can see what's on the shelf and when it comes back.
- When Claude needs your Allow while Cockpit is minimised or behind other windows, Cockpit's taskbar button flashes and it waits up to a minute for you. If nobody presses Allow, Claude is told why and asks you in the chat.

**Fixed**
- Claude no longer sees an empty board while a Cockpit dialog is open (the shelf's "Put away", Settings). Before, it took that for Cockpit having stopped.
- Claude's changes to your board no longer stall while Cockpit's window is minimised or behind other windows. Before, a change could take minutes, Claude gave up waiting, and the change went through later anyway (so a retry did it twice). If Cockpit is ever slow to answer, Claude is now told the change may have gone through and to look before trying again.

## 26 November 2026 (version 0.2.14)

**New**
- Pages that remember. A page on your board (one Claude makes for you, a drawing from a chat, or any HTML file) now keeps what you type, pick or tick in it: close Cockpit, come back, and it's all still filled in. Ask Claude for a checklist, a calculator or a trip splitter and it lands on your board as a card like that; Claude can read back what you've filled in.
- The shelf, for what you won't come back to for a week or two. "Put on the shelf…" on a card, several cards or a section takes it off the board and out of the tucked-away tabs. It waits on the shelf, a button in the bottom-left corner, until you bring it back, or until a day you pick (tomorrow, next week, in two weeks, or a date). On its day it comes back into the tray at the top.

**Improved**
- A card's menu is shorter: what you use now and then (show in folder, open in Notepad, pin to Quick access, copy the path, lock in place, fit to contents) is under More, a side menu.
- Claude can put a card on the shelf for some days, and knows to make anything you'll fill in as a page on your board.
- The Add box (Ctrl+K) no longer lists your whole history at once. It shows a few recent files, links, notes and tables, with "Show more" under each for the rest, and searching still looks through everything you've kept. It opens fast however much you keep.
- Tucked-away cards no longer run off the top of the screen. As many tabs as fit show, and the rest are under "N more", a list you can search and bring them back from. Before, only 12 showed and the others couldn't be reached.

## 26 November 2026 (version 0.2.13)

**Improved**
- Cards Claude makes or puts on your board no longer zoom your view to them. You stay where you are; the view glides over (without zooming) only when a new card lands out of sight.
- When Claude lines up two cards joined by an arrow, it leaves room between them, so the arrow and its label show.

**Fixed**
- Settings → Agents listed a message you sent with Tell Claude as "You looked at the board · could see no cards". It now reads "You told Claude: …".

## 25 November 2026 (version 0.2.12)

**New**
- Fold a section down to a bar under its title ("3 cards in it"): the arrow at the end of its title, its menu, or F with it selected. Its cards wait out of sight where they were, and come back when you click the bar. Drag the folded section and they move with it.
- Tuck a section away at the top with everything in it: one dashed tab with its name, and a click brings it all back as it was. Tuck the last cards in a section and the section goes with them, so no empty box is left behind.
- Right-click inside a section for its menu, with what you can add there (a sticky note lands in it). Outside any section, the board's menu is as before.
- Claude can fold, open, tuck and bring back a section, and sees which ones are folded or tucked.

**Improved**
- Drag a card over a section and the section lights up: let go, and the card joins it. Let go half outside and the section grows round it; let go on top of what's in it and the card moves beside the nearest card there, lined up.
- A section grows when something in it gets bigger, such as a table gaining rows. It never shrinks by itself: "Fit it to what's in it" does that.

**Fixed**
- "Select what's in it" picked the section, not its cards.

## 25 November 2026 (version 0.2.11)

**Improved**
- What you send with **Tell Claude** is read as a message from you on the board: Claude looks and answers freely, but before changing anything it asked for, it writes its plan in the chat in one line and waits for your yes there.

**Fixed**
- Claude no longer sees cards you've taken off the board.

## 25 November 2026 (version 0.2.10)

**New**
- Questions from Claude that don't stop it. When Claude, working on your board, needs something only you know, it leaves the question on a **Questions** card with its best guess in grey where the answer goes, and carries on with that guess. Type over the grey whenever you like (Enter, or the arrow in the box, keeps it), or click **Use the guess**. A question can come with a few answers to pick from, Claude's guess marked, and you can still write something else. Claude reads your answers when it next looks. Answered questions go below, and an answer can be changed.
- Your view follows Claude: a card it changes, makes or asks about, on the space you're on, glides into view when it's mostly off the screen. And while Claude waits for your Allow (to remove something, or rewrite a note), the card it's about is framed: "Claude · wants to remove".

- **Tell Claude** from the board. While a Claude Code chat is listening (it starts listening when it leaves you questions, or when you ask it to), the note at the top right says so and has a Tell Claude button: type a few words, or nothing, and the chat wakes up and acts on it, without you typing in the chat. The Questions card has a one-click "Tell Claude I've answered". Changed your mind? The × closes it without sending.
- When one thing Claude does would take several things away (or rewrite several), you're asked once for all of them, listed, with **Allow all**. Not allowed, none of it happens.

**Fixed**
- Claude couldn't name the Later and Snippets lists on their own ("Later" also named the Later card). They're the Later list and the Snippets list now.

## 25 November 2026 (version 0.2.9)

**New**
- Arrows between cards. Hover a card and drag from the dot on any side to another card; let go on empty board and a new sticky note appears there with the arrow to it. An arrow follows its cards as they move. Double-click it to give it a label; right-click it to point it the other way, put a head at both ends or none, make it dashed, or remove it. Undo works on all of it, and an arrow goes out of view with its card (another space, tucked away).
- Claude sees the arrows between the cards it can see, and can draw one (with a label) or take one away; taking one away waits for your Allow.
- An arrow leaves and reaches the middle of a card's side (several on one side spread around it). Drag a card near level with a card it has an arrow to and it snaps into line, so the arrow runs straight.
- With several cards selected, a card's menu acts on all of them: fold, tuck, lock, hide their contents, sticky note colours, share with agents or keep private, move to another space, archive the notes, or take them all off the board with one Undo to bring them back. What's for one card (open, rename, copy, comment) is left out.

- Sections: a titled area on the board, behind the cards. Right-click the board for **Section here**, or select cards and press Ctrl+Alt+G (or right-click them: Put these in a section). A card whose middle is in a section is in it: drop one in and it's there, drag it out and it isn't. Drag a section by its title and what's in it comes along. Its title's menu renames it, colours it, fits it to what's in it, selects what's in it, locks it, moves it with its cards to another space, or takes it off (its cards stay, or go too). Inside a section it's still the board: drag to select, right-click, paste. Tidy leaves sections and their cards as you arranged them.
- Claude sees which section a card is in, and can put cards in a new section.
- You see where Claude is at work: an orange frame round each card it reads, writes, comments on, arranges or makes ("Claude · reading", and so on), which fades five seconds after it's done, and a small note at the top right while it looks at or works on the board, which stays half a minute after it's done ("Claude worked on the board · 12 s ago").
- Claude can put a card in a section (the section grows to hold it, and your view follows it there), and fit a section to what's in it. A note with no title and nothing in it is "Untitled sticky note" to Claude, not its file's time stamp.

**Improved**
- The one-line install shows how far its download has got.

## 25 November 2026 (version 0.2.8)

**New**
- Full screen has the card's menu too: ⋮ on its bar, or right-click the bar. It holds what makes sense there (open elsewhere, copy, pin, Comment, sharing with agents, moving to another space, archive, Remove from board) and leaves out what's about the board, like folding, focus, tuck and lock. Archiving a note full screen now takes its card off the board too.

**Fixed**
- An update (Settings → Updates) rewrote the Start menu entry and Explorer's Send to → Cockpit even when they pointed somewhere else, like another copy of Cockpit. It now refreshes them only when they point at the copy being updated. A new install can skip Send to with -NoSendTo. The installer also ends with a success code instead of 1.

## 24 November 2026 (version 0.2.7)

**New**
- **You decide what Claude sees on your board.** Until now, Claude could read every card in every space. Now agents see only what you share with them: the cards you select, cards you share (right-click a card: Share with agents), the cards in a space you share (the space menu at the top left), and cards Claude made itself. Keep a card or a whole space private and agents never see it, whatever else is set. Settings → Agents sets this for Claude Code and for other agents: Nothing, What I share (the default), or Everything except private cards. Shared and private cards show a small mark in their corner.
- **What agents looked at.** Settings → Agents lists each time an agent read or used the board, and which cards it could see then (their titles, never what's in them).
- **Claude Code is kept out of Cockpit's files.** Connect now also asks Claude Code not to read your notes folder or Cockpit's own data folder directly; it gets what you share through the board instead. If Claude Code is already connected, this is added once when the new version starts. Settings → Agents turns it off. It stops Claude Code's file tools and the common shell commands, but on Windows a command that reads files another way still could: it's a fence, not a lock.
- **Claude gets an overview, not your contents.** Looking at the board gives Claude only each card's title, kind and space. It reads a card's contents (a note's text, a table's rows, its comments) only when it asks for that one card, and only if it's shared with it. Later and Snippets list titles only; a snippet's text is read one at a time, and a secret's never. After Claude does something, it hears back only whether that worked, not the whole board again.
- Claude can add a line to a shared note or rewrite it (a rewrite waits for your Allow), and now hears whether that worked. Before, a change written the wrong way did nothing and Claude was told it was done.

**Improved**
- Drawings Claude shows in a chat now come to Outputs too, as artifacts do: each is kept as a page that opens in Cockpit looking as it did in the chat. Whatever sends a chat's outputs (Cockpit's hook, or a mod) sends the drawing's code, and Cockpit keeps the page.
- A sticky note's strip has a Tuck away button.
- A card's right-click menu is in a clearer order: what the card does (open, copy, rename, pin) first, then how it shows (fold, focus, compare, tuck), lock and hide, agents, other spaces, and Remove from board last on its own.
- Sticky notes roll up into their strip: the new button on the strip, F, or right-click → Roll up. The note rolls up as one piece, curled corner and all; rolled, it shows its title (or its first line) with the roll under it; double-click it, or the same button, to unroll it. Fold all cards leaves sticky notes as they are.

**Fixed**
- Closing the board's right-click menu without picking anything flashed a copy of it at the top-left corner of the window. It now just fades where it was.
- Fold all cards (right-click the board) folded cards in every space. It now folds only the cards in the space you're in.

## 24 November 2026 (version 0.2.6)

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
