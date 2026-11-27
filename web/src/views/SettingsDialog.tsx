// Settings, as a dialog with its sections down the left: the board, tasks, notes, Claude Code, updates, privacy.
// It keeps one size whichever section is open, and everything it shows is loaded before it's drawn (and kept
// between openings), so nothing jumps in after it opens.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ago, onEvent } from '../lib'
import { BookA, MessageSquare, NotebookPen, Sparkles, Table2, X, type LucideIcon } from 'lucide-react'
import type { AgentAccess, AgentLogEntry, AgentName } from '../api'
import { EDITORS, get, post, type ClaudeLink, type Config, type TelemetryStatus, type TodoState, type Tracker, type UpdateStatus } from '../api'
import { useBoard } from '../board'
import { STICKY_COLORS } from '../cards/CardShell'
import { placeOf } from '../components/Viewer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { computer, mac, mod, shortcut, system } from '../platform'

const THEMES = [
  { value: 'system', label: `Like ${system}` },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const GAPS = [
  { value: 12, label: 'Tight' },
  { value: 24, label: 'Normal' },
  { value: 40, label: 'Roomy' },
]

type Section = 'board' | 'tasks' | 'notes' | 'claude' | 'agents' | 'extras' | 'updates' | 'privacy'

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

function OnOff({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={on ? 'on' : 'off'} onValueChange={v => v && onChange(v === 'on')}>
      <ToggleGroupItem value="on" className="px-3">
        On
      </ToggleGroupItem>
      <ToggleGroupItem value="off" className="px-3">
        Off
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function SettingsDialog() {
  const board = useBoard()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [usage, setUsage] = useState<TelemetryStatus | null>(null)
  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  const [section, setSection] = useState<Section>('board')
  // opened at a section from elsewhere (the empty Outputs panel points to Claude Code)
  useEffect(() => onEvent('settings-section', (d: { section?: Section }) => d.section && setSection(d.section)), [])
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null)

  // loaded together (at start, and again on each opening), drawn once all three are here
  const load = useCallback(async () => {
    const [c, u, up] = await Promise.all([
      get<Config>('/api/config'),
      get<TelemetryStatus>('/api/telemetry').catch(() => null),
      get<UpdateStatus>('/api/update').catch(() => null),
    ])
    setCfg(c)
    setUsage(u)
    setUpd(up)
  }, [])
  useEffect(() => {
    load().catch(() => {})
  }, [load])
  useEffect(() => {
    if (!board.settingsOpen) return
    setMsg(null)
    load().catch(() => {})
  }, [board.settingsOpen, load])

  const save = async (patch: Record<string, unknown>, done: string) => {
    try {
      setCfg(await post<Config>('/api/config', patch))
      board.reloadPrefs()
      setMsg({ t: done })
    } catch (e: any) {
      setMsg({ t: e.message, bad: true })
    }
  }

  const sections: { id: Section; label: string; dot?: boolean }[] = [
    { id: 'board', label: 'Board' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'notes', label: 'Notes' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'agents', label: 'Agents' },
    { id: 'extras', label: 'Extras' },
    { id: 'updates', label: 'Updates', dot: !!upd?.available },
    ...(usage?.available ? [{ id: 'privacy' as Section, label: 'Privacy' }] : []),
  ]

  return (
    <Dialog open={board.settingsOpen} onOpenChange={board.setSettingsOpen}>
      <DialogContent showCloseButton={false} className="glass-panel settings flex h-[min(560px,calc(100vh-48px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Everything stays on this {computer}.</DialogDescription>
        <div className="flex min-h-0 flex-1">
          <nav className="settings-nav" aria-label="Settings">
            <p className="px-3 pt-1 pb-3 text-[15px] font-medium">Settings</p>
            {sections.map(x => (
              <button
                key={x.id}
                type="button"
                aria-current={section === x.id ? 'page' : undefined}
                className={cn('settings-tab', section === x.id && 'is-on')}
                onClick={() => {
                  setSection(x.id)
                  setMsg(null)
                }}
              >
                {x.label}
                {x.dot && <span className="ml-auto size-1.5 rounded-full bg-sky-400" aria-label="Update available" />}
              </button>
            ))}
            <span className="flex-1" />
            <p className="px-3 text-[11.5px] text-muted-foreground">Cockpit {cfg?.version}</p>
          </nav>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <button
              type="button"
              aria-label="Close"
              className="absolute top-3 right-3 grid size-7 place-items-center rounded-md text-muted-foreground transition-[background-color,color] duration-150 hover:bg-ink/[0.08] hover:text-foreground"
              onClick={() => board.setSettingsOpen(false)}
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-4">
              {!cfg ? null : section === 'board' ? (
                <BoardSection cfg={cfg} save={save} />
              ) : section === 'tasks' ? (
                <TasksSection cfg={cfg} save={save} setMsg={setMsg} />
              ) : section === 'notes' ? (
                <NotesSection cfg={cfg} save={save} />
              ) : section === 'claude' ? (
                <ClaudeSection cfg={cfg} save={save} />
              ) : section === 'agents' ? (
                <AgentsSection cfg={cfg} save={save} />
              ) : section === 'extras' ? (
                <ExtrasSection cfg={cfg} save={save} />
              ) : section === 'updates' ? (
                <Updates st={upd} setSt={setUpd} />
              ) : (
                <PrivacySection usage={usage} setUsage={setUsage} setMsg={setMsg} />
              )}
            </div>
            <div className="flex min-h-12 items-center gap-2 px-4 py-2">
              <p className={cn('min-w-0 flex-1 truncate text-[12.5px]', msg?.bad ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
                {msg?.t || `Everything stays on this ${computer}.`}
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
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={board.sendFeedback}>
                <MessageSquare className="size-3.5" strokeWidth={1.75} />
                Send feedback
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type Save = (patch: Record<string, unknown>, done: string) => Promise<void>
type SetMsg = (m: { t: string; bad?: boolean } | null) => void

function Heading({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-4 pr-8">
      <h3 className="text-[15px] font-medium">{children}</h3>
      {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function BoardSection({ cfg, save }: { cfg: Config; save: Save }) {
  return (
    <section className="grid gap-4">
      <Heading>Board</Heading>
      <Row name="Theme">
        <ToggleGroup type="single" variant="outline" size="sm" value={cfg.theme ?? 'system'} onValueChange={v => v && save({ theme: v }, 'Saved.')}>
          {THEMES.map(t => (
            <ToggleGroupItem key={t.value} value={t.value} className="px-3">
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      <Row name="New sticky notes" hint="Each note can still get its own colour">
        <div className="flex gap-2" role="radiogroup" aria-label="New sticky notes">
          {STICKY_COLORS.map(c => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={cfg.stickyColor === c.value}
              aria-label={c.label}
              title={c.label}
              className={cn('sticky-swatch', `paper-${c.value}`, cfg.stickyColor === c.value && 'is-on')}
              onClick={() => save({ stickyColor: c.value }, `New sticky notes are ${c.label.toLowerCase()}.`)}
            />
          ))}
        </div>
      </Row>
      <Row name="Space between cards" hint={`When you tidy (${shortcut('Ctrl+Alt+T')})`}>
        <ToggleGroup type="single" variant="outline" size="sm" value={String(cfg.tidyGap ?? 24)} onValueChange={v => v && save({ tidyGap: Number(v) }, 'Saved.')}>
          {GAPS.map(g => (
            <ToggleGroupItem key={g.value} value={String(g.value)} className="px-3">
              {g.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      <Row name="Open notes in" hint="For “Open in…” on notes and text files">
        <ToggleGroup type="single" variant="outline" size="sm" value={cfg.editor ?? 'notepad'} onValueChange={v => v && save({ editor: v }, 'Saved.')}>
          {EDITORS.map(ed => (
            <ToggleGroupItem key={ed.value} value={ed.value} className="px-3">
              {ed.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      <Row name="Single-letter shortcuts" hint={`N, L, T… Off keeps only the ${mod} ones`}>
        <OnOff on={cfg.singleKeys !== false} onChange={on => save({ singleKeys: on }, on ? 'Single-letter shortcuts on.' : 'Single-letter shortcuts off.')} />
      </Row>
    </section>
  )
}

/** Extras: special things that stay out of the way until turned on here (each adds its shortcut, its entry in the
 * + box and what Claude can do with it only then). */
const EXTRAS: { id: keyof NonNullable<Config['extras']>; name: string; icon: LucideIcon; about: string; how: string }[] = [
  {
    id: 'dictionary',
    name: 'Dictionary',
    icon: BookA,
    about: `Meanings, examples, pronunciation, and words that mean the same or the opposite. 128,000 English words kept on this ${computer}, so it works without the internet.`,
    how: `Press D, or select a word anywhere (in a note, a page, a card) and press ${shortcut('Ctrl+D')} to see it right there.`,
  },
  {
    id: 'tables',
    name: 'Tables',
    icon: Table2,
    about: 'A small grid on the board: type in cells, paste from Excel, copy it back out. Each table is a .csv file in your notes folder, so it opens in Excel too.',
    how: 'Add one from the + box ("Table"). Claude can make one for you, fill it in and read it.',
  },
  {
    id: 'journal',
    name: 'Journal',
    icon: NotebookPen,
    about: 'One page a day for what you did and thought. The card always shows today; earlier days are a click back. Each page is a Markdown file in your notes folder.',
    how: "Press J. A thought typed in the + box goes into today's page, and Claude can add a line to it.",
  },
]

function ExtrasSection({ cfg, save }: { cfg: Config; save: Save }) {
  const on = cfg.extras || { dictionary: false, tables: false, journal: false }
  return (
    <section className="grid gap-3">
      <Heading hint="Special things you can add to Cockpit. Each stays out of the way until you turn it on.">Extras</Heading>
      {EXTRAS.map(x => (
        <div key={x.id} className={cn('extra-row', on[x.id] && 'is-on')}>
          <span className="extra-icon">
            <x.icon className="size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-medium">{x.name}</span>
              <OnOff on={!!on[x.id]} onChange={v => save({ extras: { [x.id]: v } }, `${x.name} ${v ? 'on' : 'off'}.`)} />
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{x.about}</p>
            <p className="mt-1.5 text-[12.5px]">{x.how}</p>
          </div>
        </div>
      ))}
      <p className="text-[11.5px] text-muted-foreground">
        The dictionary's words come from Open English WordNet (CC BY 4.0) and the CMU Pronouncing Dictionary.
      </p>
    </section>
  )
}

function TasksSection({ cfg, save, setMsg }: { cfg: Config; save: Save; setMsg: SetMsg }) {
  const [token, setToken] = useState('')
  const [replacing, setReplacing] = useState(false)
  return (
    <section className="grid gap-3">
      <Heading hint={`The Today card (T) keeps a simple list on this ${computer}. Connect Todoist to use your Todoist tasks there instead.`}>Tasks</Heading>
      {cfg.hasTodoistToken && !replacing ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-[13.5px]">
            <span className="size-2 rounded-full bg-emerald-400" /> Todoist connected
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
          <Button type="button" size="sm" variant="ghost" onClick={() => save({ todoistToken: '' }, `Todoist disconnected: Today uses the list on this ${computer}.`)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            Your Todoist API token is under Settings → Integrations → Developer in Todoist (
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
            <Button disabled={!token.trim()}>Connect</Button>
            {replacing && (
              <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            )}
          </form>
        </>
      )}
    </section>
  )
}

function NotesSection({ cfg, save }: { cfg: Config; save: Save }) {
  const [notesDir, setNotesDir] = useState(cfg.notesDir)
  return (
    <section className="grid gap-3">
      <Heading hint="Sticky notes, the journal and drafts are plain Markdown files in this folder.">Notes</Heading>
      <form
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          save({ notesDir }, 'Notes folder saved.')
        }}
      >
        <Input value={notesDir} onChange={e => setNotesDir(e.target.value)} aria-label="Notes folder" />
        <Button variant="secondary" disabled={notesDir.trim() === cfg.notesDir}>
          Save
        </Button>
      </form>
    </section>
  )
}

/** Claude Code: Outputs come by themselves; trackers too, once a chat works in a folder that has one. */
function ClaudeSection({ cfg, save }: { cfg: Config; save: Save }) {
  const board = useBoard()
  const remove = async (t: Tracker) => {
    try {
      await post('/api/trackers/remove', { file: t.file })
      board.toast(`${t.name} is off the list`)
    } catch (e: any) {
      board.toast(e.message)
    }
  }
  return (
    <section className="grid gap-5">
      <Heading hint="What your Claude Code chats make shows up under Outputs by itself, and Claude can put things on your board.">Claude Code</Heading>
      <ClaudeConnection />
      <div className="grid gap-2">
        <h4 className="text-[13.5px] font-medium">Trackers</h4>
        <p className="text-[12.5px] text-muted-foreground">A tracker a chat works in (from the tracker mod) is added here by itself. Put one on the board from {shortcut('Ctrl+K')}.</p>
        {board.trackers.length > 0 ? (
          <ul className="grid">
            {board.trackers.map(t => (
              <li key={t.file} className="group/row flex items-center gap-3 border-b border-ink/[0.06] py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px]">{t.name}</div>
                  <div className="truncate text-[12px] text-muted-foreground" title={t.file}>
                    {t.ok ? `${t.open.length} open${t.counts.yours ? ` · ${t.counts.yours} for you` : ''}` : t.error} · {placeOf(t.file.replace(/[\\/]\.claude(?=[\\/][^\\/]*$)/, ''))}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" onClick={() => remove(t)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md bg-ink/[0.03] px-3 py-2.5 text-[13px] text-muted-foreground">None yet.</p>
        )}
      </div>
      <Row name="Look for more trackers" hint="In Projects, Desktop and synced OneDrive folders">
        <OnOff on={cfg.scanTrackers} onChange={on => save({ scanTrackers: on }, on ? 'Looking for trackers in your folders.' : 'Only trackers your chats use are listed.')} />
      </Row>
    </section>
  )
}

const ACCESS: { value: AgentAccess; label: string }[] = [
  { value: 'off', label: 'Nothing' },
  { value: 'shared', label: 'What I share' },
  { value: 'all', label: 'Everything' },
]
const AGENT_ROWS: { id: AgentName; name: string }[] = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'other', name: 'Other agents' },
]

/**
 * Agents: what each may see on the board, the fence around Cockpit's files, and what they looked at. The limit is
 * said plainly: an agent that can run commands on this PC could still read files another way.
 */
function AgentsSection({ cfg, save }: { cfg: Config; save: Save }) {
  const board = useBoard()
  const [log, setLog] = useState<AgentLogEntry[] | null>(null)
  const [fence, setFence] = useState<'yes' | 'no' | undefined>()
  const load = () => {
    get<AgentLogEntry[]>('/api/agent/log').then(setLog, () => setLog([]))
    get<ClaudeLink>('/api/claude-link').then(l => setFence(l.fence), () => {})
  }
  useEffect(load, [])
  const access = cfg.agentAccess ?? { 'claude-code': 'shared', other: 'shared' }
  const said: Record<AgentAccess, string> = {
    off: "can't see or use the board.",
    shared: 'sees only cards you share, select, or put in a shared space.',
    all: 'sees every card except private ones.',
  }
  return (
    <section className="grid gap-4">
      <Heading hint="What Claude and other agents can see on your board. Right-click a card, or open the space menu at the top left, to share it with agents or keep it private.">
        Agents
      </Heading>
      {AGENT_ROWS.map(a => (
        <Row key={a.id} name={a.name} hint={a.id === 'other' ? 'Any other agent connected to Cockpit' : undefined}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={access[a.id]}
            onValueChange={v => v && save({ agentAccess: { [a.id]: v } }, `${a.name} ${said[v as AgentAccess]}`)}
          >
            {ACCESS.map(x => (
              <ToggleGroupItem key={x.value} value={x.value} className="px-3">
                {x.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
      ))}
      <p className="rounded-md bg-ink/[0.03] px-3 py-2.5 text-[12.5px] text-muted-foreground">
        What I share: the cards you select, cards you share (right-click: Share with agents), the cards in a shared space, and cards an agent made. A
        private card or space is never shown, whatever is set here.
      </p>
      <Row name="Keep Claude Code out of Cockpit's files" hint="Rules in Claude Code's settings for your notes folder and Cockpit's data">
        <OnOff
          on={cfg.agentFence !== false}
          onChange={on =>
            save({ agentFence: on }, on ? "Claude Code is asked not to read Cockpit's files. Restart open chats." : "Claude Code's rules for Cockpit's files are gone.").then(load)
          }
        />
      </Row>
      <p className="text-[12px] text-muted-foreground">
        {fence === 'yes' ? 'The rules are in place. ' : cfg.agentFence !== false ? "The rules aren't there yet: Connect (under Claude Code) adds them. " : ''}
        They stop Claude Code's own file tools and the common shell commands.{' '}
        {mac
          ? 'A command that reads files another way still could.'
          : "On Windows, Claude Code doesn't sandbox the commands it runs, so a command that reads files another way still could."}{' '}
        It's a fence, not a lock.
      </p>
      <div className="grid gap-2">
        <div className="flex items-center gap-3">
          <h4 className="min-w-0 flex-1 text-[13.5px] font-medium">What agents looked at</h4>
          {!!log?.length && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                post('/api/agent/log/clear').then(
                  () => setLog([]),
                  (e: Error) => board.toast(e.message),
                )
              }
            >
              Clear
            </Button>
          )}
        </div>
        {log && log.length > 0 ? (
          <ul className="grid max-h-56 overflow-y-auto">
            {log.slice(0, 60).map((e, i) => (
              <li key={`${e.at}-${i}`} className="border-b border-ink/[0.06] py-1.5 text-[12.5px] last:border-0">
                <span className="text-muted-foreground">{ago(e.at)} · </span>
                {/* (a ping is the person's Tell Claude: "You told Claude: …", nothing seen) */}
                {e.agent}{' '}
                {e.refused
                  ? `was refused (${e.refused})`
                  : e.tool === 'act'
                  ? `did: ${e.what || 'something'}`
                  : e.tool === 'query'
                  ? e.what || 'looked'
                  : e.tool === 'ping'
                  ? e.what || 'told Claude'
                  : 'looked at the board'}
                {e.saw?.length ? <span className="text-muted-foreground"> · could see {e.saw.length === 1 ? e.saw[0] : `${e.saw.length} cards: ${e.saw.slice(0, 6).join(', ')}${e.saw.length > 6 ? '…' : ''}`}</span> : null}
                {!e.refused && e.tool !== 'act' && e.tool !== 'ping' && !e.saw?.length ? <span className="text-muted-foreground"> · could see no cards</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md bg-ink/[0.03] px-3 py-2.5 text-[13px] text-muted-foreground">Nothing yet.</p>
        )}
      </div>
    </section>
  )
}

/** Whether Outputs and the board tools are connected to Claude Code, and a button that connects them. */
function ClaudeConnection() {
  const board = useBoard()
  const [st, setSt] = useState<ClaudeLink | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    get<ClaudeLink>('/api/claude-link').then(setSt, () => {})
  }, [])
  if (!st) return null
  // outputs coming in another way (an older hook, a mod) count as connected
  const recent = st.lastOutput && Date.now() - st.lastOutput < 7 * 86_400_000
  const outputs = st.hook === 'yes' || recent ? 'yes' : st.hook
  const all = outputs === 'yes' && st.tools === 'yes'
  const connect = async () => {
    setBusy(true)
    try {
      const r = await post<ClaudeLink>('/api/claude-link/connect')
      setSt(r)
      board.toast(r.problems?.length ? r.problems[0] : 'Connected. New Claude Code chats will use it (restart the ones open now).')
    } catch (e: any) {
      board.toast(e.message)
    } finally {
      setBusy(false)
    }
  }
  const word = (s: string) => (s === 'yes' ? 'Connected' : s === 'other' ? 'Connected to another copy of Cockpit' : 'Not connected')
  return (
    <div className="grid gap-2.5 rounded-lg bg-ink/[0.03] p-3">
      <LinkRow on={outputs === 'yes'} name="Outputs" what="What each chat made: files, links, drafts, commands" state={word(outputs)} />
      <LinkRow on={st.tools === 'yes'} name="Board tools" what="Claude can show you things and work on your board" state={word(st.tools)} />
      {!all && (
        <div className="flex items-center gap-3 pt-1">
          <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
            {st.claude ? 'Connect them now: Cockpit adds itself to Claude Code for you.' : `Claude Code's command (claude) isn't on this ${computer}, so only Outputs can be connected from here.`}
          </p>
          <Button size="sm" onClick={connect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      )}
      {st.problems?.map(p => (
        <p key={p} className="text-[12.5px] text-destructive">
          {p}
        </p>
      ))}
    </div>
  )
}

function LinkRow({ on, name, what, state }: { on: boolean; name: string; what: string; state: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn('size-2 shrink-0 rounded-full', on ? 'bg-emerald-400' : 'bg-amber-400')} />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px]">{name}</div>
        <div className="text-[12px] text-muted-foreground">{what}</div>
      </div>
      <span className="shrink-0 text-[12.5px] text-muted-foreground">{state}</span>
    </div>
  )
}

function PrivacySection({ usage, setUsage, setMsg }: { usage: TelemetryStatus | null; setUsage: (u: TelemetryStatus) => void; setMsg: SetMsg }) {
  const [showSent, setShowSent] = useState(false)
  if (!usage) return null
  const choose = async (choice: 'yes' | 'no') => {
    try {
      setUsage(await post<TelemetryStatus>('/api/telemetry', { choice }))
      setMsg({ t: choice === 'yes' ? 'Thanks: usage counts are on.' : 'Usage counts are off, and anything counted is gone.' })
    } catch (e: any) {
      setMsg({ t: e.message, bad: true })
    }
  }
  return (
    <section className="grid gap-3">
      <Heading>Privacy</Heading>
      <Row name="Anonymous usage counts" hint="How often features are used. Never what's on your board">
        <OnOff on={usage.choice === 'yes'} onChange={on => choose(on ? 'yes' : 'no')} />
      </Row>
      <Button variant="ghost" size="sm" className="w-fit px-2 text-muted-foreground" onClick={() => setShowSent(!showSent)}>
        {showSent ? 'Hide' : "See what's sent"}
      </Button>
      {showSent && (
        <pre className="max-h-56 overflow-auto rounded-md bg-ink/[0.03] p-3 font-mono text-[11.5px] text-muted-foreground">
          {usage.preview.length ? JSON.stringify(usage.preview, null, 2) : usage.choice === 'yes' ? 'Nothing waiting. Today is sent tomorrow.' : 'Nothing: usage counts are off.'}
        </pre>
      )}
      {usage.choice === 'yes' && (
        <p className="text-[12.5px] text-muted-foreground">
          {usage.lastSent
            ? `Last sent ${ago(new Date(usage.lastSent.at).toISOString())}: ${usage.lastSent.days.map(d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(', ')}. Once sent, a day is gone from this ${computer}.`
            : 'Nothing sent yet. Each day is sent once it has ended.'}
        </p>
      )}
    </section>
  )
}

/**
 * Updates: whether this copy is the latest, with Update now when it isn't. An installed copy checks about once a
 * day (switchable); a copy run from source is updated with git.
 */
function Updates({ st, setSt }: { st: UpdateStatus | null; setSt: (s: UpdateStatus) => void }) {
  const board = useBoard()
  const [busy, setBusy] = useState('')
  const [updating, setUpdating] = useState('')
  if (!st) return <Heading hint="Couldn't ask Cockpit about updates.">Updates</Heading>
  const checkNow = async () => {
    setBusy('check')
    try {
      setSt(await post<UpdateStatus>('/api/update/check'))
    } finally {
      setBusy('')
    }
  }
  const setAuto = async (on: boolean) => {
    await post('/api/config', { updates: on })
    setSt({ ...st, enabled: on })
  }
  const updateNow = async () => {
    setBusy('update')
    try {
      const r = await post<{ version: string }>('/api/update/apply')
      setUpdating(r.version)
    } catch (e: any) {
      board.toast(e.message)
      setBusy('')
    }
  }
  const checked = st.checkedAt ? `Last checked ${ago(new Date(st.checkedAt).toISOString())}.` : 'Not checked yet.'
  return (
    <section className="grid gap-4">
      <Heading>Updates</Heading>
      <div className="grid gap-3 rounded-lg bg-ink/[0.04] p-4">
        <div>
          <p className="text-[14px] font-medium">{st.available ? `Cockpit ${st.latest?.version} is ready to install` : st.checkedAt ? "You're up to date" : `You have Cockpit ${st.current}`}</p>
          <p className="text-[12.5px] text-muted-foreground">
            {st.available ? `You have ${st.current}. Your notes and board stay as they are.` : st.checkedAt ? `Cockpit ${st.current}. ${checked}` : checked}
          </p>
          {st.error && <p className="mt-1 text-[12.5px] text-destructive">{st.error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {st.available && st.installed && (
            <Button size="sm" onClick={updateNow} disabled={!!busy}>
              {busy === 'update' ? 'Downloading…' : `Install ${st.latest?.version}`}
            </Button>
          )}
          {st.available && st.latest?.page && (
            <Button size="sm" variant="ghost" onClick={() => board.openLink(st.latest!.page)}>
              What's new
            </Button>
          )}
          {!st.available && (
            <Button size="sm" variant="secondary" onClick={checkNow} disabled={!!busy}>
              {busy === 'check' ? 'Checking…' : 'Check for updates'}
            </Button>
          )}
        </div>
        {!st.installed && (
          <p className="text-[12.5px] text-muted-foreground">
            This copy runs from its code folder (a git clone), so it can't install updates itself. To update it, run <code>git pull</code> and{' '}
            <code>npm run build</code> there. A copy installed with Install.cmd installs them with one click.
          </p>
        )}
      </div>
      {st.installed && (
        <Row name="Look for updates every day" hint="A dot on Settings when there's a new version">
          <OnOff on={st.enabled} onChange={setAuto} />
        </Row>
      )}
      {updating && <Updating version={updating} />}
    </section>
  )
}

/** While the installer replaces the app: wait for the new version to answer, then load it. */
function Updating({ version }: { version: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const started = Date.now()
    const t = setInterval(async () => {
      if (Date.now() - started > 180_000) setSlow(true)
      try {
        const c = await get<Config>('/api/config')
        if (c.version === version) location.reload()
      } catch {
        // the server is being replaced
      }
    }, 2000)
    return () => clearInterval(t)
  }, [version])
  return createPortal(
    <div className="updating glass" role="status" aria-live="polite">
      <p className="text-[15px] font-medium">Updating to Cockpit {version}…</p>
      <p className="text-[13px] text-muted-foreground">
        {slow ? "This is taking longer than it should. If Cockpit doesn't come back, run the installer from the release page." : 'Cockpit will reopen in a moment. Your notes and board stay as they are.'}
      </p>
    </div>,
    document.body,
  )
}
