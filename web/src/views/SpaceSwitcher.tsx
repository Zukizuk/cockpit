// The space you're in, at the top left: click for the others, a new one, rename or remove. Double-click renames.
// [ and ] step through them, Alt+1 to 9 jumps to one, S opens this list (App's keys).
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { useBoard } from '../board'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { onEvent } from '../lib'

export function SpaceSwitcher() {
  const board = useBoard()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const current = board.spaces.find(s => s.id === board.space) ?? board.spaces[0]

  useEffect(() => onEvent('spaces-open', () => setOpen(true)), [])
  useEffect(() => onEvent('spaces-rename', () => setEditing(true)), [])
  useEffect(() => {
    if (editing) requestAnimationFrame(() => input.current?.select())
  }, [editing])

  if (editing)
    return (
      <form
        className="space-switch glass"
        onSubmit={e => {
          e.preventDefault()
          board.renameSpace(current.id, input.current?.value || current.name)
          setEditing(false)
        }}
      >
        <Layers className="size-[15px] shrink-0 opacity-70" strokeWidth={1.75} />
        <input
          ref={input}
          defaultValue={current.name}
          maxLength={40}
          aria-label="Space name"
          className="space-name-input"
          onBlur={e => {
            board.renameSpace(current.id, e.target.value || current.name)
            setEditing(false)
          }}
          onKeyDown={e => e.key === 'Escape' && setEditing(false)}
        />
      </form>
    )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="space-switch glass" aria-label={`Space: ${current.name}. Change space`} onDoubleClick={() => setEditing(true)}>
          <Layers className="size-[15px] shrink-0 opacity-70" strokeWidth={1.75} />
          <span className="truncate">{current.name}</span>
          <ChevronDown className="size-[14px] shrink-0 opacity-60" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {board.spaces.map((s, i) => (
          <DropdownMenuItem key={s.id} onSelect={() => board.switchSpace(s.id)}>
            <Check className={s.id === board.space ? '' : 'invisible'} strokeWidth={1.75} />
            <span className="truncate">{s.name}</span>
            {i < 9 && <DropdownMenuShortcut>Alt {i + 1}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => board.newSpace()}>
          <Plus strokeWidth={1.75} />
          New space
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTimeout(() => setEditing(true), 50)}>
          <Pencil strokeWidth={1.75} />
          Rename this space
        </DropdownMenuItem>
        {current.id !== 'main' && (
          <DropdownMenuItem
            onSelect={() =>
              board.toast(`Remove ${current.name}? Its cards go to Main.`, { label: 'Remove', ms: 6000, run: () => board.deleteSpace(current.id) })
            }
          >
            <Trash2 strokeWidth={1.75} />
            Remove this space
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
