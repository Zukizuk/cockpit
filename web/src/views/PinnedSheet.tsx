// Quick access: the things you open again and again, in a panel from the left (Q or P). Two parts:
//   Pinned        what you pinned by hand (a daily Excel file, a folder, a site, a note); groups optional
//   Often opened  what you keep opening anyway (a card read full screen, a file, a link), on 3+ days in two weeks
//                 and in the last week (not what's already on the board),
//                 there by itself; pin it to keep it, or say "don't show"
// A click opens it the way you open it: a file in its own program, a folder in Explorer, a link in the browser, a
// note (or something you usually read in Cockpit) full screen. Keys 1-9 open the first nine.
import { Fragment, useEffect, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  BookOpen,
  EyeOff,
  ExternalLink,
  MoreVertical,
  PinOff,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Globe,
  LayoutGrid,
  NotebookPen,
  Pencil,
  Pin as PinIcon,
  Presentation,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { post, type Often, type Pin } from '../api'
import { useBoard } from '../board'
import { RowButton } from '../cards/OutputsCard'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { isPath, isUrl } from './paste'
import { dragToBoard } from '../drag'
import { placeOf } from '../components/Viewer'
import { cn } from '@/lib/utils'
import { fileManager } from '../platform'
import { KeyCaps } from '../components/KeyCaps'

function iconOf(p: Pin): LucideIcon {
  if (p.kind === 'link') return Globe
  if (p.kind === 'note') return NotebookPen
  if (p.kind === 'folder') return Folder
  const ext = p.target.split('.').pop()?.toLowerCase() || ''
  if (['xlsx', 'xlsm', 'xls', 'csv', 'tsv'].includes(ext)) return FileSpreadsheet
  if (['pptx', 'ppt'].includes(ext)) return Presentation
  if (['docx', 'doc', 'pdf', 'md', 'txt'].includes(ext)) return FileText
  return File
}

function whereOf(p: Pin) {
  if (p.kind === 'link') {
    try {
      return new URL(p.target).hostname.replace(/^www\./, '')
    } catch {
      return p.target
    }
  }
  if (p.kind === 'note') return 'Note'
  return placeOf(p.target) || p.target
}

/** Dragged out of the panel onto the board, a row becomes a card where it's dropped (App's board handles the drop). */
export { BOARD_DRAG as QUICK_DRAG } from '../drag'

type RowAction = { label: string; icon: LucideIcon; run: () => void; primary?: boolean; danger?: boolean; gap?: boolean }

const openLabel = (kind: Pin['kind']) => (kind === 'folder' ? `Open in ${fileManager}` : kind === 'link' ? 'Open in the browser' : 'Open in its own program')

/**
 * One row: a click does the usual thing; on hover, its main actions (open in its own program, read in Cockpit when
 * Cockpit can show it); the rest in the ⋮ menu and on right-click; dragged onto the board it becomes a card.
 */
function QuickRow({ thing, icon: Icon, title, detail, faded, n, onOpen, actions }: {
  thing: { kind: Pin['kind']; target: string; title: string }
  icon: LucideIcon
  title: React.ReactNode
  detail: React.ReactNode
  faded?: boolean
  n?: number
  onOpen: () => void
  actions: RowAction[]
}) {
  const menu = (Item: typeof ContextMenuItem | typeof DropdownMenuItem, Sep: typeof ContextMenuSeparator | typeof DropdownMenuSeparator) =>
    // (what's already a button on the row isn't repeated)
    actions
      .filter(a => !a.primary)
      .map((a, i) => (
        <Fragment key={a.label}>
          {a.gap && i > 0 && <Sep />}
          <Item variant={a.danger ? 'destructive' : 'default'} onSelect={() => a.run()}>
            <a.icon strokeWidth={1.75} />
            {a.label}
          </Item>
        </Fragment>
      ))
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="out-row group/row"
          {...dragToBoard(thing)}
        >
          <Icon className={cn('size-4 shrink-0 text-muted-foreground', faded && 'opacity-40')} strokeWidth={1.5} />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen} title={thing.target}>
            <span className={cn('block truncate text-[13.5px]', faded && 'text-muted-foreground line-through')}>{title}</span>
            <span className="out-detail block truncate text-[11.5px] text-muted-foreground">{detail}</span>
          </button>
          {n !== undefined && n < 9 && <Kbd className="mr-1 shrink-0 opacity-50 group-hover/row:opacity-0">{n + 1}</Kbd>}
          <div className="out-actions absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[data-state=open]]:opacity-100">
            {actions
              .filter(a => a.primary)
              .map(a => (
                <RowButton key={a.label} icon={a.icon} label={a.label} onClick={a.run} />
              ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color] duration-150 hover:bg-ink/[0.08] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <MoreVertical className="size-[14px]" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {menu(DropdownMenuItem, DropdownMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">{menu(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  )
}

function PinRow({ p, n }: { p: Pin; n?: number }) {
  const board = useBoard()
  const [editing, setEditing] = useState<'' | 'title' | 'group'>('')
  const Icon = iconOf(p)
  const save = (patch: Partial<Pin>) => post(`/api/pinned/${p.id}`, patch).catch((e: Error) => board.toast(e.message))

  if (editing) {
    const field = editing
    const initial = field === 'title' ? p.title : p.group
    const done = (v: string) => {
      if (v.trim() !== initial) save({ [field]: v })
      setEditing('')
    }
    return (
      <div className="out-row">
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <Input
          autoFocus
          defaultValue={initial}
          list={field === 'group' ? 'pin-groups' : undefined}
          placeholder={field === 'group' ? 'Group name (empty: no group)' : 'Name'}
          aria-label={field === 'group' ? 'Group' : 'Name'}
          className="h-8"
          onFocus={ev => ev.currentTarget.select()}
          onKeyDown={ev => {
            if (ev.key === 'Enter') done(ev.currentTarget.value)
            else if (ev.key === 'Escape') {
              ev.stopPropagation()
              setEditing('')
            }
          }}
          onBlur={ev => done(ev.currentTarget.value)}
        />
      </div>
    )
  }

  const outside = p.kind !== 'note'
  const actions: RowAction[] = [
    ...(outside ? [{ label: openLabel(p.kind), icon: ExternalLink, run: () => board.openPin(p), primary: true }] : []),
    ...(p.viewable ? [{ label: p.kind === 'note' ? 'Open in Cockpit' : 'Read in Cockpit', icon: BookOpen, run: () => board.readPin(p), primary: true }] : []),
    ...(p.kind === 'file' || p.kind === 'folder' ? [{ label: `Show in ${fileManager}`, icon: FolderOpen, run: () => board.openPin(p, 'reveal') }] : []),
    { label: 'Put on the board', icon: LayoutGrid, run: () => board.putOnBoard(p) },
    { label: 'Rename', icon: Pencil, run: () => setEditing('title'), gap: true },
    { label: 'Move to a group', icon: FolderInput, run: () => setEditing('group') },
    { label: 'Unpin', icon: PinOff, run: () => post(`/api/pinned/${p.id}/remove`).catch((e: Error) => board.toast(e.message)), danger: true, gap: true },
  ]
  return (
    <QuickRow
      thing={p}
      icon={Icon}
      title={p.title}
      detail={
        <>
          {p.missing ? 'No longer there' : whereOf(p)}
          {p.opens > 0 && ` · opened ${p.opens}×`}
        </>
      }
      faded={p.missing}
      n={n}
      onOpen={() => board.openPin(p)}
      actions={actions}
    />
  )
}

function OftenRow({ o, n }: { o: Often; n: number }) {
  const board = useBoard()
  const thing = { kind: o.kind, target: o.target, title: o.title }
  const act = (what: 'pin' | 'hide') =>
    post<Pin & { already?: boolean }>(`/api/usage/${what}`, { key: o.key }).then(
      r => board.toast(what === 'pin' ? `Pinned ${r.title}` : `${o.title} won't show here again`),
      (e: Error) => board.toast(e.message),
    )
  const actions: RowAction[] = [
    ...(o.kind !== 'note' ? [{ label: openLabel(o.kind), icon: ExternalLink, run: () => board.openOften(o, 'outside'), primary: true }] : []),
    ...(o.viewable ? [{ label: o.kind === 'note' ? 'Open in Cockpit' : 'Read in Cockpit', icon: BookOpen, run: () => board.readPin(thing), primary: true }] : []),
    { label: 'Put on the board', icon: LayoutGrid, run: () => board.putOnBoard(thing) },
    { label: 'Pin it', icon: PinIcon, run: () => act('pin'), gap: true },
    { label: "Don't show this here", icon: EyeOff, run: () => act('hide') },
  ]
  return (
    <QuickRow
      thing={thing}
      icon={iconOf({ kind: o.kind, target: o.target } as Pin)}
      title={o.title}
      detail={`${whereOf({ kind: o.kind, target: o.target } as Pin)} · opened on ${o.days} days lately${o.inCockpit ? ' · usually read in Cockpit' : ''}`}
      n={n}
      onOpen={() => board.openOften(o)}
      actions={actions}
    />
  )
}

export function PinnedSheet() {
  const board = useBoard()
  const [text, setText] = useState('')
  const rf = useReactFlow()
  const { items, groups } = board.pinned
  // what's already on the board is in front of you: not offered again here
  const onBoard = new Set(rf.getNodes().map(n => `${n.type}:${(n.data as { ref: string }).ref}`))
  const often = board.pinned.often.filter(o => !(o.shownId && onBoard.has(`item:${o.shownId}`)) && !(o.kind === 'note' && onBoard.has(`note:${o.target}`)))
  const loose = items.filter(p => !p.group)
  const sections: [string, Pin[]][] = [['', loose], ...groups.map(g => [g, items.filter(p => p.group === g)] as [string, Pin[]])].filter(([, ps]) => ps.length) as [string, Pin[]][]
  const pins = sections.flatMap(([, ps]) => ps)
  const order: (Pin | Often)[] = [...pins, ...often]
  const openNth = (x: Pin | Often) => ('key' in x ? board.openOften(x) : board.openPin(x))

  // 1-9 open the first nine while the panel is open (not while typing in it)
  useEffect(() => {
    if (!board.pinnedOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.closest('input, textarea')) return
      const i = Number(e.key) - 1
      if (Number.isInteger(i) && i >= 0 && i < 9 && order[i]) {
        e.preventDefault()
        openNth(order[i])
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const add = async () => {
    const v = text.trim().replace(/^"(.*)"$/, '$1')
    if (!v) return
    if (!isUrl(v) && !isPath(v)) return board.toast('Paste a file or folder path, or a web link')
    await board.pin(isUrl(v) ? { url: v } : { path: v })
    setText('')
  }

  return (
    <Sheet open={board.pinnedOpen} onOpenChange={board.setPinnedOpen} modal={false}>
      <SheetContent
        side="left"
        className="glass-panel w-[min(400px,calc(100vw-24px))] gap-0 sm:max-w-none"
        // kept open: working on the board leaves it where it is; only the close button (or Q) closes it
        onInteractOutside={e => board.quickKept && e.preventDefault()}
        onEscapeKeyDown={e => board.quickKept && e.preventDefault()}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>Quick access</SheetTitle>
          <SheetDescription className="sr-only">Pinned things and what you open often. Drag one onto the board to make it a card.</SheetDescription>
          <button
            type="button"
            aria-pressed={board.quickKept}
            title={board.quickKept ? 'Kept open: click to let it close by itself again' : 'Keep open beside the board'}
            onClick={() => board.setQuickKept(!board.quickKept)}
            className={cn(
              'absolute top-[10px] right-10 grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color] duration-150 hover:bg-ink/[0.08] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
              board.quickKept && 'bg-ink/10 text-foreground',
            )}
          >
            <PinIcon className={cn('size-[15px]', board.quickKept && 'fill-current')} strokeWidth={1.75} />
            <span className="sr-only">Keep open</span>
          </button>
        </SheetHeader>
        <div className="px-4 pb-3">
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Paste a file or folder path, or a link, to pin it"
            aria-label="Pin a path or a link"
            className="h-9"
          />
        </div>
        <datalist id="pin-groups">
          {groups.map(g => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <div className="quick min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {!items.length && !often.length && (
            <div className="grid justify-items-center gap-2 px-6 pt-10 text-center text-[13.5px] text-muted-foreground">
              <PinIcon className="size-5 opacity-60" strokeWidth={1.5} />
              <p>Nothing here yet.</p>
              <p className="text-[12.5px] leading-relaxed">
                Paste a path or a link above, or choose Pin on a card or in the <KeyCaps keys={['Ctrl', 'K']} /> box. What you open on three different days
                shows up here by itself. Drag any of them onto the board to make it a card.
              </p>
            </div>
          )}
          {pins.length > 0 && often.length > 0 && <h3 className="quick-head">Pinned</h3>}
          {sections.map(([g, ps]) => (
            <section key={g || '_'} className="mb-2">
              {g && <h3 className="quick-head quick-group">{g}</h3>}
              {ps.map(p => (
                <PinRow key={p.id} p={p} n={order.indexOf(p)} />
              ))}
            </section>
          ))}
          {often.length > 0 && (
            <section className="mb-2">
              <h3 className="quick-head">Often opened</h3>
              {often.map(o => (
                <OftenRow key={o.key} o={o} n={order.indexOf(o)} />
              ))}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
