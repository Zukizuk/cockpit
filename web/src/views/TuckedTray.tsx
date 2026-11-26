// Cards tucked away: small tabs hanging from the top edge of the screen, each with its card's title (a sticky note's
// in its paper). A click brings the card back to where it was. Only this space's. As many tabs as fit across the top
// show; the rest are under "N more", a list to search and bring back from, so none is ever out of reach.
import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import { useBoard, spaceOf, type CardNode } from '../board'
import { ChevronDown, SquareDashed, StickyNote } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ShelfTab, useShelf } from './Shelf'

/** Room kept on the right of the tabs for the "N more" button. */
const MORE_W = 104
/** The tray leaves this much of the window free (the space switcher on the left, the pill and window buttons right). */
const SIDES = 340

export function TuckedTray() {
  const board = useBoard()
  const key = useStore(s =>
    JSON.stringify(
      s.nodes
        .filter(n => (n.data as CardNode['data']).tucked && !(n.data as CardNode['data']).shelf && spaceOf(n as CardNode) === board.space)
        // a section by its title (what's in it went with it)
        .map(n => [n.id, n.type, n.type === 'section' ? (n.data as CardNode['data']).title || 'Section' : (n.data as CardNode['data']).ref, (n.data as CardNode['data']).color || '']),
    ),
  )
  const tucked = JSON.parse(key) as [string, string, string, string][]
  const tray = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(tucked.length)
  const [winW, setWinW] = useState(innerWidth)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const shelved = useShelf().length
  useLayoutEffect(() => {
    const on = () => setWinW(innerWidth)
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])
  // how many tabs fit across: each tab is measured (the ones over are laid out unseen, so they keep their width)
  useLayoutEffect(() => {
    const el = tray.current
    if (!el) return
    const tabs = [...el.querySelectorAll<HTMLElement>('.tuck-tab')]
    const room = winW - SIDES - ((el.querySelector<HTMLElement>('.tuck-shelf')?.offsetWidth ?? -6) + 6)
    let used = 0
    let n = 0
    for (const t of tabs) {
      const w = t.offsetWidth + 6
      const left = tabs.length - n - 1
      if (used + w > room - (left > 0 ? MORE_W : 0)) break
      used += w
      n++
    }
    setFit(n)
  }, [key, winW, shelved])
  if (!tucked.length && !shelved) return null

  const titleOf = (type: string, ref: string) => {
    if (type === 'section') return ref
    if (type === 'item') return board.items.find(x => x.id === ref)?.title || 'File'
    if (type === 'note') {
      if (/^journal\//.test(ref)) return `Journal ${ref.slice(8, 18)}`
      const n = board.notes?.notes.find(x => x.path === ref)
      return n?.title || n?.excerpt?.split('\n')[0] || 'Sticky note'
    }
    if (type === 'folder') return ref.split(/[\\/]/).filter(Boolean).pop() || 'Folder'
    if (type === 'table') return ref.split('/').pop()?.replace(/\.csv$/i, '') || 'Table'
    return { tasks: 'Today', later: 'Later', snippets: 'Snippets', outputs: 'Outputs', tracker: `Tracker: ${ref}`, command: 'Command' }[type] || 'Card'
  }

  return (
    <div className="tuck-tray" role="toolbar" aria-label="Tucked away cards" ref={tray}>
      <ShelfTab titleOf={titleOf} />
      {tucked.map(([id, type, ref, color], i) => {
        const sticky = type === 'note' && !/^(journal|drafts)\//.test(ref)
        const title = titleOf(type, ref)
        // a section's tab is dashed, like the area it stands for, with its mark
        return (
          <button
            key={id}
            type="button"
            className={cn('tuck-tab', i >= fit && 'is-over', sticky && `is-paper paper-${color || board.prefs.stickyColor}`, type === 'section' && 'is-section', type === 'section' && color && `paper-${color}`)}
            onClick={() => board.untuck(id)}
            tabIndex={i >= fit ? -1 : undefined}
            aria-hidden={i >= fit || undefined}
            title={type === 'section' ? `The section "${title}", with what's in it: click to bring it back` : `${title}: click to bring it back`}
          >
            {type === 'section' && <SquareDashed className="size-3 shrink-0" strokeWidth={2} />}
            <span className="truncate">{title}</span>
          </button>
        )
      })}
      {fit < tucked.length && (
        <Popover
          open={open}
          onOpenChange={o => {
            setOpen(o)
            if (!o) setQ('')
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className="tuck-tab tuck-more" title="The rest of what's tucked away">
              {tucked.length - fit} more
              <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="tuck-list w-72 p-1.5">
            {tucked.length - fit > 7 && (
              <input className="tuck-search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a tucked card…" aria-label="Find a tucked card" onKeyDown={e => e.stopPropagation()} />
            )}
            <div className="tuck-rows">
              {tucked
                .slice(fit)
                .map(([id, type, ref, color]) => ({ id, type, ref, color, title: titleOf(type, ref) }))
                .filter(t => !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase()))
                .map(t => {
                  const sticky = t.type === 'note' && !/^(journal|drafts)\//.test(t.ref)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="tuck-row"
                      onClick={() => {
                        board.untuck(t.id)
                        if (tucked.length - fit <= 1) setOpen(false)
                      }}
                      title="Bring it back"
                    >
                      {t.type === 'section' ? (
                        <SquareDashed className="size-3.5 shrink-0" strokeWidth={1.75} />
                      ) : sticky ? (
                        <span className={cn('tuck-dot', `paper-${t.color || board.prefs.stickyColor}`)} />
                      ) : (
                        <StickyNote className="size-3.5 shrink-0 opacity-0" />
                      )}
                      <span className="truncate">{t.title}</span>
                    </button>
                  )
                })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
