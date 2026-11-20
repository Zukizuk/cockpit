// Today: a to-do list. With Todoist connected it's Todoist's today (and overdue); without, a simple list kept on
// this PC. Either way: add, tick off, change the words (click them), remove. Everything shows at once and is saved
// behind the scenes; if saving fails, the list goes back and says why.
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Check, ExternalLink, ListTodo, RefreshCw, Trash2, X } from 'lucide-react'
import { get, post, type LocalTask, type Task, type TodoState } from '../api'
import { clock, useData } from '../lib'
import { useBoard, type CardNode } from '../board'
import { CardShell, IconButton } from './CardShell'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const PRIORITY_RING: Record<number, string> = { 4: 'border-red-400/80', 3: 'border-orange-400/80', 2: 'border-sky-400/70', 1: 'border-ink/30' }

/** One row, whichever list it comes from. */
type Row = { id: string; content: string; done?: boolean; pending?: boolean; priority?: number; detail?: string; overdue?: boolean; url?: string }

function due(t: Task) {
  if (!t.due) return ''
  if (t.overdue) return `Overdue · ${new Date(`${t.due.day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  return t.due.hasTime ? clock(t.due.when) : 'Today'
}

const tempId = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function TaskRow({ row, onToggle, onRename, onRemove }: { row: Row; onToggle: () => void; onRename: (text: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <li className="task-row group/row">
      <button
        type="button"
        aria-label={row.done ? 'Not done after all' : 'Done'}
        className={cn(
          'group/tick mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,scale] duration-150 hover:bg-ink/10 active:scale-[0.96]',
          PRIORITY_RING[row.priority || 1] || PRIORITY_RING[1],
          row.done && 'border-ink/30 bg-ink/15',
        )}
        onClick={onToggle}
        disabled={row.pending}
      >
        <Check className={cn('size-3 transition-opacity duration-150', row.done ? 'opacity-100' : 'opacity-0 group-hover/tick:opacity-100')} strokeWidth={2} />
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            defaultValue={row.content}
            aria-label="Task"
            className="-my-1 h-7 px-2 text-[14px]"
            onFocus={e => e.currentTarget.select()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim()
                if (v && v !== row.content) onRename(v)
                setEditing(false)
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
              }
            }}
            onBlur={e => {
              const v = e.currentTarget.value.trim()
              if (v && v !== row.content) onRename(v)
              setEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            className={cn('block w-full text-left text-[14px] leading-snug', row.done && 'text-muted-foreground line-through', row.pending && 'opacity-60')}
            title="Click to change"
            onClick={() => !row.pending && setEditing(true)}
          >
            {row.content}
          </button>
        )}
        {row.detail && <div className={cn('text-[12px] text-muted-foreground', row.overdue && 'text-red-400')}>{row.detail}</div>}
      </div>
      {!editing && !row.pending && (
        <div className="task-actions">
          {row.url && (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in Todoist"
              title="Open in Todoist"
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-ink/[0.08] hover:text-foreground"
            >
              <ExternalLink className="size-[13px]" strokeWidth={1.75} />
            </a>
          )}
          <button
            type="button"
            aria-label="Remove"
            title="Remove"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-ink/[0.08] hover:text-foreground"
            onClick={onRemove}
          >
            <Trash2 className="size-[13px]" strokeWidth={1.75} />
          </button>
        </div>
      )}
    </li>
  )
}

export function TasksCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const todo = useData(() => get<TodoState>('/api/todoist'), [], { refreshEvery: 120_000 })
  const local = useData(() => get<LocalTask[]>('/api/tasks'), [])
  const [text, setText] = useState('')
  const s = todo.data
  const todoist = !!s?.configured

  // ---- Todoist ----
  const setTasks = (fn: (t: Task[]) => Task[]) => todo.setData(d => (d ? { ...d, tasks: fn(d.tasks) } : d))
  const refetch = () => get<TodoState>('/api/todoist?force=1').then(todo.setData, () => {})
  const fail = (err: any) => {
    board.toast(err.message)
    refetch()
  }
  const todoistRows: Row[] = (s?.tasks || []).map(t => ({
    id: t.id,
    content: t.content,
    pending: t.id.startsWith('t-'),
    priority: t.priority,
    detail: [due(t), t.projectName].filter(Boolean).join(' · '),
    overdue: t.overdue,
    url: t.id.startsWith('t-') ? undefined : t.url,
  }))

  // ---- this PC ----
  const setLocal = (fn: (t: LocalTask[]) => LocalTask[]) => local.setData(d => fn(d || []))
  const failLocal = (err: any) => {
    board.toast(err.message)
    local.reload()
  }
  const localRows: Row[] = [...(local.data || [])].sort((a, b) => Number(!!a.doneOn) - Number(!!b.doneOn)).map(t => ({ id: t.id, content: t.content, done: !!t.doneOn }))

  const add = (line: string) => {
    if (todoist) {
      const tmp = tempId()
      setTasks(ts => [...ts, { id: tmp, content: line, description: '', projectId: '', projectName: '', priority: 1, labels: [], due: null, overdue: false, url: '' }])
      post<{ task: Task | null }>('/api/todoist/add', { text: line }).then(r => {
        // Todoist reads dates and priorities out of the words: its version of the task replaces ours
        if (r.task) setTasks(ts => ts.map(t => (t.id === tmp ? r.task! : t)))
        refetch()
      }, err => {
        setTasks(ts => ts.filter(t => t.id !== tmp))
        setText(line)
        board.toast(err.message)
      })
    } else {
      const tid = crypto.randomUUID()
      setLocal(ts => [...ts, { id: tid, content: line, createdAt: new Date().toISOString(), doneOn: '' }])
      post('/api/tasks', { id: tid, content: line }).catch(err => {
        setText(line)
        failLocal(err)
      })
    }
  }

  const today = new Date().toLocaleDateString('en-CA')
  const actionsFor = (r: Row) =>
    todoist
      ? {
          onToggle: () => {
            setTasks(ts => ts.filter(t => t.id !== r.id))
            post('/api/todoist/close', { id: r.id }).catch(fail)
          },
          onRename: (v: string) => {
            setTasks(ts => ts.map(t => (t.id === r.id ? { ...t, content: v } : t)))
            post('/api/todoist/rename', { id: r.id, content: v }).catch(fail)
          },
          onRemove: () => {
            setTasks(ts => ts.filter(t => t.id !== r.id))
            post('/api/todoist/delete', { id: r.id }).then(() => board.toast('Removed from Todoist'), fail)
          },
        }
      : {
          onToggle: () => {
            setLocal(ts => ts.map(t => (t.id === r.id ? { ...t, doneOn: r.done ? '' : today } : t)))
            post(`/api/tasks/${r.id}`, { done: !r.done }).catch(failLocal)
          },
          onRename: (v: string) => {
            setLocal(ts => ts.map(t => (t.id === r.id ? { ...t, content: v } : t)))
            post(`/api/tasks/${r.id}`, { content: v }).catch(failLocal)
          },
          onRemove: () => {
            const was = local.data || []
            setLocal(ts => ts.filter(t => t.id !== r.id))
            post(`/api/tasks/${r.id}/remove`).then(
              () =>
                board.toast('Task removed', {
                  label: 'Undo',
                  run: () => {
                    local.setData(was)
                    const t = was.find(x => x.id === r.id)
                    if (t) post('/api/tasks', { id: t.id, content: t.content }).catch(failLocal)
                  },
                }),
              failLocal,
            )
          },
        }

  const rows = todoist ? todoistRows : localRows
  const open = rows.filter(r => !r.done).length
  const loading = !s || (!todoist && !local.data)
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={ListTodo}
      title="Today"
      subtitle={loading ? '' : todoist ? `${open} due or overdue · Todoist` : `${open} to do`}
      quick={todoist ? <IconButton icon={RefreshCw} label="Refresh" onClick={refetch} /> : undefined}
      actions={[
        ...(todoist ? [] : [{ label: 'Connect Todoist instead', icon: ExternalLink, run: () => board.setSettingsOpen(true) }]),
        { label: 'Remove from board', icon: X, run: () => board.removeCard(id), gap: !todoist },
      ]}
    >
      {loading ? (
        <p className="text-[13px] text-muted-foreground">{todo.error || 'Loading…'}</p>
      ) : (
        <div className="grid gap-2">
          <form
            onSubmit={e => {
              e.preventDefault()
              const line = text.trim()
              if (!line) return
              setText('')
              add(line)
            }}
          >
            <Input data-typeto value={text} onChange={e => setText(e.target.value)} placeholder={todoist ? 'Add a task, e.g. "send the report tomorrow 10am p1"' : 'Add a task'} />
          </form>
          {s.error && <p className="text-[13px] text-destructive">{s.error}</p>}
          {!s.error && !rows.length && <p className="py-2 text-[13.5px] text-muted-foreground">{todoist ? 'Nothing due today.' : 'Nothing to do yet. Type above and press Enter.'}</p>}
          <ul className="grid">
            {rows.map(r => (
              <TaskRow key={r.id} row={r} {...actionsFor(r)} />
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  )
}
