// What a Claude chat made, the way Claude shows it ("Edited 4 files", +12 −3), one group per chat with the newest
// turn on top. Every row works: view it here, see its changes, open it in its own program or folder, copy it, and
// run a command right in the row (or as a card on the board).
import { Fragment, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import {
  Bookmark, Copy, Eye, ExternalLink, FileCode2, FileSpreadsheet, FileText, FileType2, FolderOpen, GitCompareArrows, Globe, Maximize2, MessageSquareText, Play,
  Presentation, Sparkles, Square, SquareTerminal, TerminalSquare, X, type LucideIcon,
} from 'lucide-react'
import { get, openOutside, post, type Changes, type OutputGroup, type OutputItem, type RunView } from '../api'
import { ago, clock } from '../lib'
import { useBoard, type CardNode } from '../board'
import { basename, tidyPath } from '../components/Viewer'
import { dragToBoard } from '../drag'
import { CardShell, type CardAction } from './CardShell'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const CODE = /\.(tsx?|jsx?|mjs|py|ps1|sh|sql|json|ya?ml|toml|css|html?|rs|go|java|cs|cpp|c|rb|php)$/i

function rowIcon(i: OutputItem): LucideIcon {
  if (i.kind === 'link') return Globe
  if (i.kind === 'command') return SquareTerminal
  if (i.kind === 'draft' || i.kind === 'prompt') return MessageSquareText
  const t = i.target || i.label
  if (/\.(xlsx|xlsm|xls|csv)$/i.test(t)) return FileSpreadsheet
  if (/\.docx?$/i.test(t)) return FileType2
  if (/\.pptx?$/i.test(t)) return Presentation
  if (CODE.test(t)) return FileCode2
  return FileText
}

export function summary(g: OutputGroup) {
  const n = (k: OutputItem['kind']) => g.items.filter(i => i.kind === k).length
  const parts: string[] = []
  const add = (count: number, word: string) => count && parts.push(`${count} ${word}${count > 1 ? 's' : ''}`)
  add(n('file'), 'file')
  add(n('link'), 'link')
  add(n('draft') + n('prompt'), 'draft')
  add(n('command'), 'command')
  return `Made ${parts.join(', ')}`
}

/** What counts as new in a group right now: turns after it was last looked at (all of it if never). */
export const newSinceOf = (g?: OutputGroup) => (!g ? null : g.seen ? (g.seenAt ?? null) : (g.seenAt ?? ''))

const refOf = (item: OutputItem, index: number) => item.id || String(index)

export function RowButton({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={e => {
            e.stopPropagation()
            onClick()
          }}
          className={cn(
            'grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-(--ease-out) hover:bg-ink/[0.08] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]',
            active && 'text-foreground',
          )}
        >
          <Icon className="size-[14px]" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** A command run right in its row: the output opens underneath, nothing goes on the board. */
function InlineRun({ group, item, index, onClose }: { group: OutputGroup; item: OutputItem; index: number; onClose: () => void }) {
  const [run, setRun] = useState<RunView | null>(null)
  const [out, setOut] = useState('')
  const [error, setError] = useState('')
  const offset = useRef(0)
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    post<RunView>('/api/run', { group: group.id, index: refOf(item, index) }).then(
      v => {
        offset.current = v.offset
        setOut(v.out)
        setRun(v)
      },
      e => setError(e.message),
    )
  }, [group.id, item, index])
  useEffect(() => {
    if (!run || run.status !== 'running') return
    const t = setInterval(async () => {
      const v = await get<RunView>(`/api/run/${run.id}?from=${offset.current}`).catch(() => null)
      if (!v) return
      offset.current = v.offset
      if (v.out) setOut(o => o + v.out)
      if (v.status !== 'running') setRun(v)
    }, 250)
    return () => clearInterval(t)
  }, [run])
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [out])
  const state = error ? 'Could not start' : !run ? 'Starting…' : run.status === 'running' ? 'Running…' : run.status === 'done' ? 'Finished' : run.status === 'stopped' ? 'Stopped' : `Failed · exit code ${run.code}`
  return (
    <div className="inline-run">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className={cn('text-muted-foreground', run?.status === 'done' && 'text-emerald-300/90', (run?.status === 'failed' || error) && 'text-red-300/90')}>{state}</span>
        <span className="truncate text-muted-foreground/70">in {tidyPath(run?.cwd || group.cwd || '~')}</span>
        <span className="flex-1" />
        {run?.status === 'running' && <RowButton icon={Square} label="Stop" onClick={async () => setRun(await post<RunView>(`/api/run/${run.id}/stop`))} />}
        <RowButton icon={X} label="Close" onClick={onClose} />
      </div>
      {(out || error) && (
        <pre ref={pre} className="cmd-out inline">
          {error || out}
        </pre>
      )}
    </div>
  )
}

/** One output row, with its actions. `near` places what it opens beside that card. */
export function OutputRow({ group, item, index, near, onView, counts }: { group: OutputGroup; item: OutputItem; index: number; near?: string; onView?: () => void; counts?: Changes | null }) {
  const board = useBoard()
  const [running, setRunning] = useState(false)
  const Icon = rowIcon(item)
  const ref = refOf(item, index)
  const toBoard = (fn: () => unknown) => {
    onView?.()
    fn()
  }
  const view = () =>
    toBoard(() => {
      if (item.kind === 'command') return board.addCard('command', `${group.id}:${ref}`, { near })
      if (item.kind === 'file') return board.showItem({ path: item.target, from: group.from }, { near })
      if (item.kind === 'link') return board.showItem({ url: item.target }, { near })
      return board.showItem({ content: item.text, format: 'markdown', title: item.label.slice(0, 120) }, { near })
    })
  const changes = () =>
    toBoard(async () => {
      try {
        const c = await get<Changes>(`/api/changes?group=${group.id}&item=${ref}`)
        if (!c.diff.trim()) return board.toast(c.label)
        await board.showItem({ content: c.diff, format: 'diff', title: `Changes · ${basename(item.target)}` }, { near })
      } catch (e: any) {
        board.toast(e.message)
      }
    })
  const native = async (how: 'default' | 'reveal') => {
    if (item.kind === 'link') return board.openLink(item.target)
    try {
      await openOutside({ kind: 'output', id: group.id, index: ref, how })
      board.toast(how === 'reveal' ? 'Showing it in its folder…' : `Opening ${basename(item.target)}…`)
    } catch (e: any) {
      board.toast(e.message)
    }
  }
  const terminal = async () => {
    try {
      await post('/api/run/terminal', { group: group.id, index: ref })
      board.toast('Opened in Windows Terminal')
    } catch (e: any) {
      board.toast(e.message)
    }
  }
  const label = item.kind === 'file' ? basename(item.target || item.label) : item.label
  const detail = item.kind === 'file' ? tidyPath(item.detail || item.target.replace(/[\\/][^\\/]*$/, '')) : item.kind === 'link' ? item.target.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : item.detail
  const shown = item.kind === 'file' && counts && counts.repo && counts.added + counts.removed > 0 ? counts : null
  return (
    <>
      <div
        className="out-row group/row"
        onDoubleClick={view}
        {...dragToBoard(
          item.kind === 'file' || item.kind === 'link'
            ? { kind: item.kind, target: item.target, title: label }
            : { kind: 'text', target: item.kind === 'command' ? '```\n' + (item.text || '') + '\n```' : item.text || item.label, title: item.label.slice(0, 120) },
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <button type="button" className="min-w-0 shrink text-left" onClick={item.kind === 'command' ? () => setRunning(true) : view} title={item.target || item.text}>
          <span className="block truncate text-[13.5px]">{label}</span>
        </button>
        {shown ? (
          <span className="out-detail ml-auto shrink-0 font-mono text-[12px] tabular-nums" title={`${shown.label} · ${detail}`}>
            <span className="text-emerald-400">+{shown.added}</span> <span className="text-red-400">−{shown.removed}</span>
          </span>
        ) : (
          <span className="out-detail ml-auto max-w-[45%] truncate text-right text-[12px] text-muted-foreground">{detail}</span>
        )}
        <div className="out-actions absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {item.kind === 'command' ? (
            <>
              <RowButton icon={Play} label="Run here" onClick={() => setRunning(true)} active={running} />
              <RowButton icon={Maximize2} label="Open as a card on the board" onClick={view} />
              <RowButton icon={TerminalSquare} label="Run in Windows Terminal" onClick={terminal} />
            </>
          ) : (
            <RowButton icon={Eye} label="View here" onClick={view} />
          )}
          {item.kind === 'file' && <RowButton icon={GitCompareArrows} label="See the changes" onClick={changes} />}
          {(item.kind === 'file' || item.kind === 'link') && <RowButton icon={ExternalLink} label={item.kind === 'link' ? 'Open in your browser' : 'Open in its own program'} onClick={() => native('default')} />}
          {item.kind === 'file' && <RowButton icon={FolderOpen} label="Show in folder" onClick={() => native('reveal')} />}
          <RowButton
            icon={Bookmark}
            label="Save for later"
            onClick={() =>
              board.saveLater(item.kind === 'link' ? { url: item.target } : item.kind === 'file' ? { path: item.target } : { text: item.text, title: item.label.slice(0, 120) })
            }
          />
          <RowButton icon={Copy} label={item.kind === 'file' ? 'Copy path' : item.kind === 'link' ? 'Copy link' : 'Copy'} onClick={() => board.copy(item.text || item.target)} />
        </div>
      </div>
      {running && <InlineRun group={group} item={item} index={index} onClose={() => setRunning(false)} />}
    </>
  )
}

/** The files' +/− counts for a group, fetched once when it's shown. */
function useCounts(group: OutputGroup) {
  const [counts, setCounts] = useState<Record<string, Changes | null>>({})
  const sig = group.items.filter(i => i.kind === 'file').map((i, n) => i.id || n).join(',') + group.updatedAt
  useEffect(() => {
    let stop = false
    group.items.forEach((item, index) => {
      if (item.kind !== 'file') return
      const ref = refOf(item, index)
      get<Changes>(`/api/changes?group=${group.id}&item=${ref}`).then(
        c => !stop && setCounts(m => ({ ...m, [ref]: c })),
        () => !stop && setCounts(m => ({ ...m, [ref]: null })),
      )
    })
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return counts
}

/** A group's rows, newest turn first; a dashed line and the time between turns, "New" on turns not seen yet. */
export function OutputsList({ group, near, onView, newSince }: { group: OutputGroup; near?: string; onView?: () => void; newSince?: string | null }) {
  const counts = useCounts(group)
  const rows = group.items.map((item, index) => ({ item, index }))
  const turns = new Set(rows.map(r => r.item.at)).size
  return (
    <div className="grid min-w-0 grid-cols-1">
      {rows.map(({ item, index }, n) => {
        const turnStart = n === 0 || rows[n - 1].item.at !== item.at
        const isNew = typeof newSince === 'string' && item.at > newSince
        return (
          <Fragment key={item.id || index}>
            {turnStart && (turns > 1 || isNew) && (
              <div className={cn('turn-divider', n === 0 && 'first')}>
                <span>
                  {ago(item.at)} · {clock(item.at)}
                </span>
                {isNew && <span className="turn-new">New</span>}
              </div>
            )}
            <OutputRow group={group} item={item} index={index} near={near} onView={onView} counts={counts[refOf(item, index)]} />
          </Fragment>
        )
      })}
    </div>
  )
}

export function OutputsCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const group = board.outputs.find(g => g.id === data.ref)
  // what counted as new when the card was drawn (marking it seen must not take the badges away at once)
  const [since] = useState(() => newSinceOf(group))
  const unseen = group && !group.seen
  useEffect(() => {
    if (unseen) post(`/api/outputs/${data.ref}`, { seen: true }).then(board.reloadOutputs, () => {})
  }, [unseen, data.ref, board.reloadOutputs])
  const actions: CardAction[] = [
    {
      label: 'Open every file here',
      icon: Eye,
      run: () =>
        group?.items
          .filter(i => i.kind === 'file' || i.kind === 'link')
          .forEach((it, k) => setTimeout(() => board.showItem(it.kind === 'file' ? { path: it.target, from: group.from } : { url: it.target }, { near: id }), k * 150)),
      hidden: !group,
    },
    { label: 'Remove from board', icon: X, run: () => board.removeCard(id), gap: true },
  ]
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={Sparkles}
      title={group ? summary(group) : 'Output no longer kept'}
      subtitle={group ? `${group.from} · ${ago(group.updatedAt || group.createdAt)}` : undefined}
      actions={actions}
      bodyClassName="tight"
    >
      {group ? <OutputsList group={group} near={id} newSince={since} /> : <p className="px-2 text-[13px] text-muted-foreground">This output has been cleared.</p>}
    </CardShell>
  )
}
