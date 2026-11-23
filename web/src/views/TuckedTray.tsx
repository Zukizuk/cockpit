// Cards tucked away: small tabs hanging from the top edge of the screen, each with its card's title (a sticky note's
// in its paper). A click brings the card back to where it was. Only this space's.
import { useStore } from '@xyflow/react'
import { useBoard, spaceOf, type CardNode } from '../board'
import { cn } from '@/lib/utils'

const MAX = 12

export function TuckedTray() {
  const board = useBoard()
  const key = useStore(s =>
    JSON.stringify(
      s.nodes
        .filter(n => (n.data as CardNode['data']).tucked && spaceOf(n as CardNode) === board.space)
        .map(n => [n.id, n.type, (n.data as CardNode['data']).ref, (n.data as CardNode['data']).color || '']),
    ),
  )
  const tucked = JSON.parse(key) as [string, string, string, string][]
  if (!tucked.length) return null

  const titleOf = (type: string, ref: string) => {
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
    <div className="tuck-tray" role="toolbar" aria-label="Tucked away cards">
      {tucked.slice(0, MAX).map(([id, type, ref, color]) => {
        const sticky = type === 'note' && !/^(journal|drafts)\//.test(ref)
        const title = titleOf(type, ref)
        return (
          <button
            key={id}
            type="button"
            className={cn('tuck-tab', sticky && `is-paper paper-${color || board.prefs.stickyColor}`)}
            onClick={() => board.untuck(id)}
            title={`${title}: click to bring it back`}
          >
            <span className="truncate">{title}</span>
          </button>
        )
      })}
      {tucked.length > MAX && <span className="tuck-more">+{tucked.length - MAX}</span>}
    </div>
  )
}
