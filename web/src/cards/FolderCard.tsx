// A folder on the board, as a tree: subfolders open in place, a file opens as a card beside this one (or in its own
// program), and any row can be dragged onto the board. Paste a folder's path, or put a pinned folder on the board.
import { useCallback, useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import {
  ChevronRight,
  ExternalLink,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Pin,
  Presentation,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react'
import { get, openOutside, type FolderEntry, type FolderList } from '../api'
import { useBoard, type CardNode } from '../board'
import { dragToBoard } from '../drag'
import { placeOf } from '../components/Viewer'
import { CardShell, IconButton } from './CardShell'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  sheet: FileSpreadsheet, csv: FileSpreadsheet, docx: FileText, markdown: FileText, text: FileText, pdf: FileText,
  image: FileImage, code: FileCode, json: FileCode, html: FileCode, slides: Presentation, video: FileVideo, audio: FileAudio,
}
const iconOf = (e: FolderEntry) => (e.dir ? Folder : ICONS[e.format] || File)

/** Cockpit can draw it in a card (the rest only opens in its own program). */
const viewable = (e: FolderEntry) => !e.dir && !!e.format && e.format !== 'binary'

function size(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })

function RowButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color] duration-150 hover:bg-ink/[0.08] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={ev => {
            ev.stopPropagation()
            onClick()
          }}
        >
          <Icon className="size-[13px]" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function FolderCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const root = data.ref
  // what each opened folder holds (the card's own folder is always open)
  const [lists, setLists] = useState<Record<string, FolderList | { error: string }>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const load = useCallback(async (dir: string) => {
    try {
      const l = await get<FolderList>(`/api/folder?path=${encodeURIComponent(dir)}`)
      setLists(m => ({ ...m, [dir]: l }))
    } catch (e: any) {
      setLists(m => ({ ...m, [dir]: { error: e.message } }))
    }
  }, [])

  const refresh = useCallback(() => {
    load(root)
    open.forEach(d => load(d))
  }, [load, root, open])

  useEffect(() => {
    load(root)
  }, [load, root])
  // back to the window (after saving a file elsewhere, say): look again
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && refresh()
    addEventListener('focus', on)
    return () => removeEventListener('focus', on)
  }, [refresh])

  const toggle = (dir: string) =>
    setOpen(s => {
      const n = new Set(s)
      if (n.has(dir)) n.delete(dir)
      else {
        n.add(dir)
        load(dir)
      }
      return n
    })

  const outside = async (e: FolderEntry, how: 'default' | 'reveal') => {
    try {
      await openOutside({ kind: 'path', path: e.path, how })
      board.toast(how === 'reveal' ? 'Showing it in Explorer…' : `Opening ${e.name}…`)
    } catch (err: any) {
      board.toast(err.message)
    }
  }
  const asCard = (e: FolderEntry) => (e.dir ? board.addCard('folder', e.path, { near: id }) : board.showItem({ path: e.path }, { near: id }))
  const openRow = (e: FolderEntry) => (e.dir ? toggle(e.path) : viewable(e) ? asCard(e) : outside(e, 'default'))

  const top = lists[root]
  const q = filter.trim().toLowerCase()

  const rows = (dir: string, depth: number): React.ReactNode => {
    const l = lists[dir]
    if (!l) return depth ? <div className="folder-note" style={{ paddingLeft: 28 + depth * 16 }}>Loading…</div> : null
    if ('error' in l) return <div className="folder-note" style={{ paddingLeft: 12 + depth * 16 }}>{l.error}</div>
    const shown = q ? l.entries.filter(e => e.dir || e.name.toLowerCase().includes(q)) : l.entries
    if (!shown.length) return <div className="folder-note" style={{ paddingLeft: 28 + depth * 16 }}>{q ? 'Nothing matches' : 'Empty'}</div>
    return (
      <>
        {shown.map(e => {
          const Icon = e.dir && open.has(e.path) ? FolderOpen : iconOf(e)
          return (
            <div key={e.path}>
              <div
                className="folder-row group/row"
                style={{ paddingLeft: 6 + depth * 16 }}
                title={e.path}
                onClick={() => openRow(e)}
                onDoubleClick={() => !e.dir && outside(e, 'default')}
                {...dragToBoard({ kind: e.dir ? 'folder' : 'file', target: e.path, title: e.name })}
              >
                <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150', !e.dir && 'invisible', open.has(e.path) && 'rotate-90')} strokeWidth={1.75} />
                <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{e.name}</span>
                <span className="folder-meta">{e.dir ? '' : `${size(e.size)} · ${day(e.mtime)}`}</span>
                <div className="folder-actions">
                  {!e.dir && viewable(e) && <RowButton icon={ExternalLink} label="Open in its own program" onClick={() => outside(e, 'default')} />}
                  {e.dir && <RowButton icon={Folder} label="Open as its own card" onClick={() => asCard(e)} />}
                  <RowButton icon={Pin} label="Pin to Quick access" onClick={() => board.pin({ path: e.path, title: e.name })} />
                  <RowButton icon={FolderOpen} label="Show in Explorer" onClick={() => outside(e, 'reveal')} />
                </div>
              </div>
              {e.dir && open.has(e.path) && rows(e.path, depth + 1)}
            </div>
          )
        })}
        {l.more > 0 && <div className="folder-note" style={{ paddingLeft: 28 + depth * 16 }}>and {l.more} more: open it in Explorer</div>}
      </>
    )
  }

  const name = top && !('error' in top) ? top.name : root.split(/[\\/]/).filter(Boolean).pop() || root
  const count = top && !('error' in top) ? top.entries.length + top.more : 0
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={Folder}
      title={name}
      subtitle={<span title={root}>{[placeOf(root), count ? `${count} item${count === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>}
      quick={
        <>
          <IconButton icon={RefreshCw} label="Look again" onClick={refresh} />
          <IconButton icon={ExternalLink} label="Open in Explorer" onClick={() => outside({ name, path: root, dir: true, size: 0, mtime: 0, format: '' }, 'default')} />
        </>
      }
      actions={[
        { label: 'Open in Explorer', icon: ExternalLink, run: () => outside({ name, path: root, dir: true, size: 0, mtime: 0, format: '' }, 'default') },
        { label: 'Pin to Quick access', icon: Pin, run: () => board.pin({ path: root, title: name }) },
        { label: 'Copy path', icon: File, run: () => board.copy(root, 'Path copied') },
        { label: 'Remove from board', icon: X, run: () => board.removeCard(id), gap: true },
      ]}
      bodyClassName="flush"
    >
      <div className="flex h-full min-h-0 flex-col">
        {count > 12 && (
          <div className="px-3 pt-2.5 pb-1.5">
            <Input data-typeto value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a file by name" aria-label="Find a file by name" className="h-8" />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {!top ? (
            <div className="grid gap-2.5 p-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : (
            rows(root, 0)
          )}
        </div>
      </div>
    </CardShell>
  )
}
