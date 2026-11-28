# Menu review: what each menu should show

28 Nov 2026. Based on a full list of Cockpit's 14 menus (about 190 items), with your rules:

1. **A menu fits what was clicked.** A cell's menu is about the cell, not the whole card.
2. **No duplicates of what's already on screen.** If a strip button, badge or bar does it, it isn't also in the main
   menu. The one exception is the way back out of a state, such as Unfold or Show its contents.
3. **Nothing that makes no sense right now.** For example, nothing about Focus or Lock while Focus is on.
4. **Cut what's rarely used.** Claude can do the heavy lifting instead: formulas, Markdown, rewriting.

Each line is **Keep**, **More** (moved under the More submenu), **Cut**, or **Fix** (a bug).

---

## 1. Every card's menu (the parts all cards share)

| Item | Now | Proposal |
|---|---|---|
| Comment | main | **Cut.** The comment bubble on the card's corner does it. |
| Focus on this card | main | **Keep.** Hidden while Focus is on, because the bar at the bottom brings everything back. |
| Bring everything back | main, in Focus | **Cut.** The Focus bar has it. |
| Compare side by side | main | **Cut here.** It never shows on one card. It stays in the several-cards menu, and only when both cards can be compared. |
| Tuck away, Put on the shelf… | main | **Keep.** Hidden while Focus is on. |
| Lock in place / Unlock | main | **Keep.** Hidden while Focus is on. |
| Share with agents, Private from agents | main | **Keep.** The badge only shows once it's on, so the menu is the way in. |
| Move to <space>, Move to a new space | main | **Keep.** |
| Fold / Unfold | More / main when folded | **Keep as is**, except tables, below. |
| Hide / Show its contents | More / main when hidden | **Keep as is.** |
| Fit to contents | main | **More.** |
| Remove from board | end | **Keep**, with the Del key shown on every card, not just some. |

## 2. Table

**Right-click on a cell: only the cell, its row and its column.**

| Item | Proposal |
|---|---|
| Sort by <column>, A to Z / Z to A | **Keep** |
| Filter rows | **Keep** |
| Insert a row above / below | **Keep** |
| Insert a column left / right | **Keep**, for putting a column between two others |
| Delete this row / Delete <column> | **Keep** |
| Everything about the whole table (rename, copy, Excel, focus, tuck, lock, share, move, delete table…) | **Cut from the cell menu.** It's on the title's menu. |

**Right-click on the table's title, or its ⋮ button:**

| Item | Proposal |
|---|---|
| Rename | **Keep** |
| Copy for Excel | **Keep**, renamed "Copy the table" |
| Copy as Markdown | **Cut.** Claude can write it as Markdown. |
| Open in Excel | **Keep** |
| Filter rows / Clear the filter | **Keep** |
| Fold to its title | **Main**, because a table has no fold button on its strip |
| Delete table | **Keep**, at the end. It's no longer two lines below "Delete this row". |
| **Fix** | After a cell right-click, the ⋮ menu wrongly hides "Filter rows". |

## 3. Sticky note and journal page

| Item | Proposal |
|---|---|
| Rename, Copy the text, Pin to Quick access | **Keep** |
| Open in its own program / Notepad / VS Code | **More** |
| Open full screen | **More** (it's on the strip) |
| Archive note, Remove from board | **Keep** |

## 4. File, link, picture

| Item | Proposal |
|---|---|
| Open, Copy the picture, Draw on it, Open full screen | **More** (all on the strip), as now |
| Show in folder, Keep on Later / Done reading, Pin to Quick access, Copy link | **Keep** |
| Back to the original | **Keep** (only on a picture that's been drawn on) |
| Read the page again, Open in Notepad/VS Code, Copy path | **More** |
| Copy the text, on written content | **Cut.** The strip's Copy button does it. |

## 5. Several cards selected

| Item | Proposal |
|---|---|
| Focus, Put in a section, Fold/Unfold, Tuck, Shelf, Lock, Hide | **Keep.** Focus, Tuck, Shelf and Lock are hidden while Focus is on. |
| Compare side by side | **Keep** only when exactly 2 cards are selected and both are files, pages or notes |
| Share / Private | **Fix**: the label should reflect all the cards, not just the one right-clicked |
| Archive these notes, Remove these N | **Keep** |
| **Fix** | The count "these N" includes a selected section, which is then skipped. |

## 6. Board (right-click on empty board)

| Item | Proposal |
|---|---|
| Sticky note here, Section here, Add or find… | **Keep** |
| Tidy, Fold all, Unfold all | **Keep.** Hidden while Focus is on, since they do nothing then. |
| Show everything | **Keep** |
| Clear the drawings in this space | **Keep** (only when there are some) |
| Undo, Redo | **Keep**, greyed when there's nothing to undo or redo |
| Keyboard shortcuts, What's new, Settings, Send feedback | **More.** Each is also on the Dock or a corner button. |

## 7. Section (its title menu)

| Item | Proposal |
|---|---|
| Colours, Rename, Fold, Tuck, Shelf, Tidy, Fit, Select what's in it, Move to | **Keep** |
| Lock / Unlock | **Keep** |
| Remove the section / Remove it and its cards | **Hidden while locked**, instead of shown and then refusing with a toast |

## 8. Full-screen reader (⋮)

| Item | Proposal |
|---|---|
| Everything that already has a button on the reader's bar | **Cut from the ⋮ menu.** Today the menu repeats every bar button. |
| Comment, Share, Private, Move to, Archive, Remove from board | **Keep** |

## 9. Rows: Later list, Quick access, Snippets

| Menu | Proposal |
|---|---|
| Later row (right-click or ⋮) | **Only what isn't already a hover button on the row.** Today it lists all 9 again. |
| Quick access row | The same: no repeats of the hover buttons. |
| Snippet row, Keep for 1 day / 1 week… | **Fix:** tick the one that's set now. |

## 10. Arrow

| Item | Proposal |
|---|---|
| Label, Point the other way, Dashed / Solid, Remove | **Keep** |
| Arrowheads at both ends, Plain line | **Merge** into one "Arrowheads ▸ One end / Both ends / None" |

## 11. Bugs found on the way

- **Right-click inside a text box blocks Cut, Copy and Paste.** That covers a note you're typing in, a table cell, and an
  answer box. Right-click inside text you're editing should give the normal Cut / Copy / Paste menu, not the card's.
- Tucking or shelving the focused card leaves Focus on, with nothing in it.
- On a table, the ⋮ menu hides "Filter rows" after an earlier right-click on a cell.

---

**Rough effect:** a cell's menu goes from about 25 items to 9. A card's main menu loses 3 to 5 items. The reader's menu
loses everything it repeated from its bar.
