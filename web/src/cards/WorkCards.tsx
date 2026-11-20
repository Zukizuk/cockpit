// One tracker (from the tracker mod for Claude Code), as a card you put on the board only when you want it.
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ListChecks, X } from 'lucide-react'
import { get, type Tracker, type TrackerItem } from '../api'
import { useData } from '../lib'
import { useBoard, type CardNode } from '../board'
import { CardShell } from './CardShell'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

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
