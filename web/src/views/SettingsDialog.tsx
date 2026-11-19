// Settings, as a small dialog: how the board behaves, Todoist, the notes folder, extra trackers, and What's new.
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { EDITORS, get, post, type Config, type TodoState } from '../api'
import { useBoard } from '../board'
import { STICKY_COLORS } from '../cards/CardShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const GAPS = [
  { value: 12, label: 'Tight' },
  { value: 24, label: 'Normal' },
  { value: 40, label: 'Roomy' },
]

/** One setting: its name (and a short line under it) on the left, the control on the right. */
function Row({ name, hint, children }: { name: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13.5px]">{name}</div>
        {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDialog() {
  const board = useBoard()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [token, setToken] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [notesDir, setNotesDir] = useState('')
  const [trackers, setTrackers] = useState('')
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null)

  useEffect(() => {
    if (!board.settingsOpen) return
    setMsg(null)
    get<Config>('/api/config').then(c => {
      setCfg(c)
      setNotesDir(c.notesDir)
      setTrackers(c.trackers.join('\n'))
    })
  }, [board.settingsOpen])

  const save = async (patch: Record<string, unknown>, done: string) => {
    try {
      setCfg(await post<Config>('/api/config', patch))
      board.reloadPrefs()
      setMsg({ t: done })
    } catch (e: any) {
      setMsg({ t: e.message, bad: true })
    }
  }

  return (
    <Dialog open={board.settingsOpen} onOpenChange={board.setSettingsOpen}>
      <DialogContent className="glass-panel max-h-[calc(100vh-48px)] grid-cols-1 overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Everything stays on this PC.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-6">
          <section className="grid gap-3">
            <h3 className="text-[14px] font-medium">Board</h3>
            <Row name="New sticky notes" hint="Each note can still get its own colour">
              <div className="flex gap-2" role="radiogroup" aria-label="New sticky notes">
                {STICKY_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={cfg?.stickyColor === c.value}
                    aria-label={c.label}
                    title={c.label}
                    className={cn('sticky-swatch', `paper-${c.value}`, cfg?.stickyColor === c.value && 'is-on')}
                    onClick={() => save({ stickyColor: c.value }, `New sticky notes are ${c.label.toLowerCase()}.`)}
                  />
                ))}
              </div>
            </Row>
            <Row name="Space between cards" hint="When you tidy (Ctrl+Alt+T)">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={String(cfg?.tidyGap ?? 24)}
                onValueChange={v => v && save({ tidyGap: Number(v) }, 'Saved.')}
              >
                {GAPS.map(g => (
                  <ToggleGroupItem key={g.value} value={String(g.value)} className="px-3">
                    {g.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Row>
            <Row name="Open notes in" hint="For “Open in…” on notes and text files">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={cfg?.editor ?? 'notepad'}
                onValueChange={v => v && save({ editor: v }, 'Saved.')}
              >
                {EDITORS.map(ed => (
                  <ToggleGroupItem key={ed.value} value={ed.value} className="px-3">
                    {ed.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Row>
            <Row name="Single-letter shortcuts" hint="N, L, T… Off keeps only the Ctrl ones">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={cfg?.singleKeys === false ? 'off' : 'on'}
                onValueChange={v => v && save({ singleKeys: v === 'on' }, v === 'on' ? 'Single-letter shortcuts on.' : 'Single-letter shortcuts off.')}
              >
                <ToggleGroupItem value="on" className="px-3">
                  On
                </ToggleGroupItem>
                <ToggleGroupItem value="off" className="px-3">
                  Off
                </ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </section>
          <section className="grid gap-2">
            <h3 className="text-[14px] font-medium">Todoist</h3>
            {cfg?.hasTodoistToken && !replacing ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-2 text-[13.5px]">
                  <span className="size-2 rounded-full bg-emerald-400" /> Connected
                </span>
                <span className="flex-1" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const r = await get<TodoState>('/api/todoist?force=1')
                    setMsg(r.error ? { t: r.error, bad: true } : { t: `Todoist works: ${r.tasks.length} due today or overdue.` })
                  }}
                >
                  Test
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(true)}>
                  Replace token
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => save({ todoistToken: '' }, 'Todoist disconnected.')}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">
                  Your API token is in Todoist under Settings → Integrations → Developer (
                  <a className="underline underline-offset-4" href="https://app.todoist.com/app/settings/integrations/developer" target="_blank" rel="noopener noreferrer">
                    open
                  </a>
                  ). It only goes to api.todoist.com.
                </p>
                <form
                  className="flex gap-2"
                  onSubmit={async e => {
                    e.preventDefault()
                    if (token.trim()) await save({ todoistToken: token.trim() }, 'Todoist connected.')
                    setToken('')
                    setReplacing(false)
                  }}
                >
                  <Input type="password" autoComplete="off" placeholder="Paste your Todoist API token" value={token} onChange={e => setToken(e.target.value)} />
                  <Button disabled={!token.trim()}>Save</Button>
                  {replacing && (
                    <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                      Cancel
                    </Button>
                  )}
                </form>
              </>
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="text-[14px] font-medium">Notes folder</h3>
            <form
              className="flex gap-2"
              onSubmit={e => {
                e.preventDefault()
                save({ notesDir }, 'Notes folder saved.')
              }}
            >
              <Input value={notesDir} onChange={e => setNotesDir(e.target.value)} />
              <Button variant="secondary">Save</Button>
            </form>
          </section>
          <section className="grid gap-2">
            <h3 className="text-[14px] font-medium">More trackers</h3>
            <p className="text-[13px] text-muted-foreground">tracker.json files (or folders holding one), one per line.</p>
            <textarea
              className="min-h-24 rounded-md border border-input bg-white/[0.03] px-3 py-2 font-mono text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={trackers}
              onChange={e => setTrackers(e.target.value)}
            />
            <Button variant="secondary" className="w-fit" onClick={() => save({ trackers: trackers.split('\n').map(s => s.trim()).filter(Boolean) }, 'Trackers saved.')}>
              Save
            </Button>
          </section>
          {msg && <p className={msg.bad ? 'text-[13px] text-destructive' : 'text-[13px] text-muted-foreground'}>{msg.t}</p>}
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              Cockpit {cfg?.version} · 127.0.0.1:{cfg?.port} · {cfg?.dataDir}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                board.setSettingsOpen(false)
                board.openChangelog()
              }}
            >
              <Sparkles className="size-3.5" strokeWidth={1.75} />
              What's new
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
