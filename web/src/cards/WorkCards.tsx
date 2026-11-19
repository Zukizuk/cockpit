// Todoist's today and one tracker, as cards you put on the board only when you want them.
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Check, ListChecks, ListTodo, RefreshCw, X } from 'lucide-react'
import { get, post, type Task, type TodoState, type Tracker, type TrackerItem } from '../api'
import { clock, useData } from '../lib'
import { useBoard, type CardNode } from '../board'
import { CardShell, IconButton } from './CardShell'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const PRIORITY_RING: Record<number, string> = { 4: 'border-red-400/80', 3: 'border-orange-400/80', 2: 'border-sky-400/70', 1: 'border-ink/30' }

function due(t: Task) {
  if (!t.due) return ''
  if (t.overdue) return `Overdue · ${new Date(`${t.due.day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  return t.due.hasTime ? clock(t.due.when) : 'Today'
}

export function TasksCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const todo = useData(() => get<TodoState>('/api/todoist'), [], { refreshEvery: 120_000 })
  const [text, setText] = useState('')
  const s = todo.data
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={ListTodo}
      title="Today"
      subtitle={s?.configured ? `${s.tasks.length} due or overdue · Todoist` : 'Todoist'}
      quick={<IconButton icon={RefreshCw} label="Refresh" onClick={async () => todo.setData(await get<TodoState>('/api/todoist?force=1'))} />}
      actions={[{ label: 'Remove from board', icon: X, run: () => board.removeCard(id) }]}
    >
      {!s ? (
        <p className="text-[13px] text-muted-foreground">{todo.error || 'Loading…'}</p>
      ) : !s.configured ? (
        <div className="grid gap-2 text-[13.5px] text-muted-foreground">
          <p>Connect Todoist to see today's tasks here.</p>
          <button className="w-fit text-foreground underline underline-offset-4" onClick={() => board.setSettingsOpen(true)}>
            Add your Todoist token
          </button>
        </div>
      ) : (
        <div className="grid gap-2">
          <form
            onSubmit={async e => {
              e.preventDefault()
              if (!text.trim()) return
              try {
                await post('/api/todoist/add', { text })
                setText('')
                todo.setData(await get<TodoState>('/api/todoist?force=1'))
              } catch (err: any) {
                board.toast(err.message)
              }
            }}
          >
            <Input data-typeto value={text} onChange={e => setText(e.target.value)} placeholder='Add a task, e.g. "send the report tomorrow 10am p1"' />
          </form>
          {s.error && <p className="text-[13px] text-destructive">{s.error}</p>}
          {!s.error && !s.tasks.length && <p className="py-2 text-[13.5px] text-muted-foreground">Nothing due today.</p>}
          <ul className="grid">
            {s.tasks.map(t => (
              <li key={t.id} className="flex gap-3 border-b border-ink/[0.06] py-2.5 last:border-0">
                <button
                  aria-label="Complete"
                  className={cn('group/tick mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,scale] duration-150 hover:bg-ink/10 active:scale-[0.96]', PRIORITY_RING[t.priority] || PRIORITY_RING[1])}
                  onClick={async () => {
                    todo.setData({ ...s, tasks: s.tasks.filter(x => x.id !== t.id) })
                    try {
                      await post('/api/todoist/close', { id: t.id })
                    } catch (err: any) {
                      board.toast(err.message)
                      todo.reload()
                    }
                  }}
                >
                  <Check className="size-3 opacity-0 transition-opacity duration-150 group-hover/tick:opacity-100" strokeWidth={2} />
                </button>
                <div className="min-w-0">
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-[14px] leading-snug">
                    {t.content}
                  </a>
                  <div className="flex gap-2.5 text-[12px] text-muted-foreground">
                    <span className={cn(t.overdue && 'text-red-300')}>{due(t)}</span>
                    {t.projectName && <span>{t.projectName}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  )
}

const TYPE_LABEL: Record<TrackerItem['type'], string> = { todo: 'To do', waiting: 'Waiting on others', check: 'To check', decided: 'Decided' }

export function TrackerCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const list = useData(() => get<Tracker[]>('/api/trackers'), [], { refreshEvery: 120_000 })
  const [mine, setMine] = useState<'all' | 'mine'>('all')
  const trackers = (list.data || []).filter(t => t.ok)
  const current = trackers.find(t => t.name === data.ref) || trackers[0]
  const items = current ? (mine === 'mine' ? current.open.filter(i => i.you) : current.open) : []
  const groups = (['todo', 'waiting', 'check', 'decided'] as const).map(type => ({ type, items: items.filter(i => i.type === type) })).filter(g => g.items.length)

  const pick = (name: string) => board.retarget(id, name)

  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={ListChecks}
      title={current?.name || 'Tracker'}
      subtitle={current ? `${current.counts.yours} for you · ${current.open.length} open` : undefined}
      actions={[{ label: 'Remove from board', icon: X, run: () => board.removeCard(id) }]}
    >
      {!list.data ? (
        <p className="text-[13px] text-muted-foreground">{list.error || 'Loading…'}</p>
      ) : !current ? (
        <p className="text-[13px] text-muted-foreground">No trackers found.</p>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Select value={current.name} onValueChange={pick}>
              <SelectTrigger className="h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {trackers.map(t => (
                  <SelectItem key={t.file} value={t.name}>
                    {t.name}
                    <span className="text-muted-foreground">{t.counts.yours ? `${t.counts.yours} for you` : `${t.open.length} open`}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleGroup type="single" value={mine} onValueChange={v => v && setMine(v as 'all' | 'mine')} variant="outline" size="sm">
              <ToggleGroupItem value="all" className="px-3">
                All
              </ToggleGroupItem>
              <ToggleGroupItem value="mine" className="px-3">
                Mine
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {!items.length && <p className="py-2 text-[13.5px] text-muted-foreground">Nothing open{mine === 'mine' ? ' for you' : ''}.</p>}
          {groups.map(g => (
            <section key={g.type}>
              <h4 className="mb-1 mt-1 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">{TYPE_LABEL[g.type]}</h4>
              {g.items.map(i => (
                <article key={i.id} className="border-b border-ink/[0.06] py-2.5 last:border-0">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span className="font-mono">{i.id}</span>
                    {i.you && <span className="rounded bg-ink/10 px-1.5 text-foreground">you</span>}
                    {i.date && <span>{i.date}</span>}
                  </div>
                  <p className="mt-0.5 text-[14px] leading-snug font-medium">{i.title}</p>
                  {i.who && <p className="mt-1 text-[13px] text-muted-foreground">Waiting on {i.who}</p>}
                  {i.blocker && <p className="mt-1 text-[13px] text-muted-foreground">Blocked: {i.blocker}</p>}
                  {i.note && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{i.note}</p>}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </CardShell>
  )
}
