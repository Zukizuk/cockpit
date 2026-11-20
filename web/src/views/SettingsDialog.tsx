// Settings, as a small dialog: how the board behaves, Todoist, the notes folder, extra trackers, and What's new.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ago } from '../lib'
import { MessageSquare, Sparkles } from 'lucide-react'
import { EDITORS, get, post, type Config, type TelemetryStatus, type TodoState, type UpdateStatus } from '../api'
import { useBoard } from '../board'
import { STICKY_COLORS } from '../cards/CardShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const THEMES = [
  { value: 'system', label: 'Like Windows' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

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
  const [usage, setUsage] = useState<TelemetryStatus | null>(null)
  const [showSent, setShowSent] = useState(false)
  const chooseUsage = async (choice: 'yes' | 'no') => {
    try {
      setUsage(await post<TelemetryStatus>('/api/telemetry', { choice }))
      setMsg({ t: choice === 'yes' ? 'Thanks: usage counts are on.' : 'Usage counts are off, and anything counted is gone.' })
    } catch (e: any) {
      setMsg({ t: e.message, bad: true })
    }
  }

  useEffect(() => {
    if (!board.settingsOpen) return
    setMsg(null)
    setShowSent(false)
    get<TelemetryStatus>('/api/telemetry').then(setUsage, () => setUsage(null))
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
            <Row name="Theme">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={cfg?.theme ?? 'system'}
                onValueChange={v => v && save({ theme: v }, 'Saved.')}
              >
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
          <Updates />
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
          {/* trackers come from the tracker mod for Claude Code: shown once there is one, or one is listed */}
          {(board.trackers.length > 0 || trackers.trim()) && (
          <section className="grid gap-2">
            <h3 className="text-[14px] font-medium">Trackers</h3>
            <p className="text-[13px] text-muted-foreground">More tracker.json files (or folders holding one), one per line.</p>
            <textarea
              className="min-h-24 rounded-md border border-input bg-ink/[0.03] px-3 py-2 font-mono text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={trackers}
              onChange={e => setTrackers(e.target.value)}
            />
            <Button variant="secondary" className="w-fit" onClick={() => save({ trackers: trackers.split('\n').map(s => s.trim()).filter(Boolean) }, 'Trackers saved.')}>
              Save
            </Button>
          </section>
          )}
          {usage?.available && (
            <section className="grid gap-3">
              <h3 className="text-[14px] font-medium">Privacy</h3>
              <Row name="Anonymous usage counts" hint="How often features are used. Never what's on your board">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={usage.choice === 'yes' ? 'on' : 'off'}
                  onValueChange={v => v && chooseUsage(v === 'on' ? 'yes' : 'no')}
                >
                  <ToggleGroupItem value="on" className="px-3">
                    On
                  </ToggleGroupItem>
                  <ToggleGroupItem value="off" className="px-3">
                    Off
                  </ToggleGroupItem>
                </ToggleGroup>
              </Row>
              <Button variant="ghost" size="sm" className="w-fit px-2 text-muted-foreground" onClick={() => setShowSent(!showSent)}>
                {showSent ? 'Hide' : "See what's sent"}
              </Button>
              {showSent && (
                <pre className="max-h-56 overflow-auto rounded-md bg-ink/[0.03] p-3 font-mono text-[11.5px] text-muted-foreground">
                  {usage.preview.length ? JSON.stringify(usage.preview, null, 2) : usage.choice === 'yes' ? 'Nothing yet. Each day is sent the day after.' : 'Nothing: usage counts are off.'}
                </pre>
              )}
            </section>
          )}
          {msg && <p className={msg.bad ? 'text-[13px] text-destructive' : 'text-[13px] text-muted-foreground'}>{msg.t}</p>}
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">Cockpit {cfg?.version}</p>
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
      </DialogContent>
    </Dialog>
  )
}

/**
 * Updates: whether this copy is the latest, with Update now when it isn't. An installed copy checks about once a
 * day (switchable); a copy run from source is updated with git.
 */
function Updates() {
  const board = useBoard()
  const [st, setSt] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [updating, setUpdating] = useState('')
  useEffect(() => {
    get<UpdateStatus>('/api/update').then(setSt, () => setSt(null))
  }, [])
  if (!st) return null
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
  return (
    <section className="grid gap-3">
      <h3 className="text-[14px] font-medium">Updates</h3>
      {!st.installed ? (
        <p className="text-[13px] text-muted-foreground">Running from source: update with git pull, then npm run build.</p>
      ) : (
        <>
          <Row name="Check for updates" hint="About once a day, from GitHub">
            <ToggleGroup type="single" variant="outline" size="sm" value={st.enabled ? 'on' : 'off'} onValueChange={v => v && setAuto(v === 'on')}>
              <ToggleGroupItem value="on" className="px-3">
                On
              </ToggleGroupItem>
              <ToggleGroupItem value="off" className="px-3">
                Off
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
              {st.available
                ? `Cockpit ${st.latest?.version} is available (you have ${st.current}).`
                : st.error || `Cockpit ${st.current} is the latest${st.checkedAt ? `, checked ${ago(new Date(st.checkedAt).toISOString())}` : ''}.`}
            </p>
            {st.available ? (
              <>
                {st.latest?.page && (
                  <Button size="sm" variant="ghost" onClick={() => board.openLink(st.latest!.page)}>
                    What's new
                  </Button>
                )}
                <Button size="sm" onClick={updateNow} disabled={!!busy}>
                  {busy === 'update' ? 'Downloading…' : 'Update now'}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={checkNow} disabled={!!busy}>
                {busy === 'check' ? 'Checking…' : 'Check now'}
              </Button>
            )}
          </div>
        </>
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
