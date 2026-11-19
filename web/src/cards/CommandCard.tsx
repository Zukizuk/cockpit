// A command Claude wrote, ready to run: see it whole, check the folder and shell, press Run and watch the output
// right here. Anything that asks questions goes to a Windows Terminal tab instead.
import { useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Copy, Play, Square, SquareTerminal, TerminalSquare, X } from 'lucide-react'
import { get, post, type RunInfo, type RunView, type Shell } from '../api'
import { useBoard, type CardNode } from '../board'
import { tidyPath } from '../components/Viewer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { CardShell } from './CardShell'

const secs = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`)

export function CommandCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const [groupId, index] = data.ref.split(':')
  const group = board.outputs.find(g => g.id === groupId)
  const [info, setInfo] = useState<RunInfo | null>(null)
  const [error, setError] = useState('')
  const [cwd, setCwd] = useState('')
  const [shell, setShell] = useState<Shell>('pwsh')
  const [run, setRun] = useState<RunView | null>(null)
  const [out, setOut] = useState('')
  const [now, setNow] = useState(Date.now())
  const outRef = useRef<HTMLPreElement>(null)
  const offset = useRef(0)

  useEffect(() => {
    get<RunInfo>(`/api/run/info?group=${groupId}&index=${encodeURIComponent(index)}`).then(
      i => {
        setInfo(i)
        setCwd(i.cwd)
        setShell(i.shell)
      },
      e => setError(e.message),
    )
  }, [groupId, index])

  // follow a running command's output
  useEffect(() => {
    if (!run || run.status !== 'running') return
    const t = setInterval(async () => {
      try {
        const v = await get<RunView>(`/api/run/${run.id}?from=${offset.current}`)
        offset.current = v.offset
        if (v.out) setOut(o => o + v.out)
        setNow(Date.now())
        if (v.status !== 'running') setRun(v)
      } catch (e: any) {
        setError(e.message)
        setRun(r => (r ? { ...r, status: 'failed' } : r))
      }
    }, 250)
    return () => clearInterval(t)
  }, [run])

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [out])

  const start = async () => {
    setError('')
    setOut('')
    offset.current = 0
    try {
      const v = await post<RunView>('/api/run', { group: groupId, index, shell, cwd })
      offset.current = v.offset
      setOut(v.out)
      setRun(v)
      setNow(Date.now())
    } catch (e: any) {
      setError(e.message)
    }
  }

  const stop = async () => {
    if (run) setRun(await post<RunView>(`/api/run/${run.id}/stop`))
  }

  const terminal = async () => {
    try {
      await post('/api/run/terminal', { group: groupId, index, shell, cwd })
      board.toast('Opened in Windows Terminal')
    } catch (e: any) {
      setError(e.message)
    }
  }

  const running = run?.status === 'running'
  const command = info?.command || ''
  const firstLine = command.split('\n')[0]
  const status = !run
    ? ''
    : run.status === 'running'
      ? `Running · ${secs(now - run.startedAt)}`
      : run.status === 'done'
        ? `Finished · ${secs(run.endedAt - run.startedAt)}`
        : run.status === 'stopped'
          ? 'Stopped'
          : `Failed${run.code !== null ? ` · exit code ${run.code}` : ''} · ${secs((run.endedAt || now) - run.startedAt)}`

  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={SquareTerminal}
      title={firstLine || 'Command'}
      subtitle={group ? `${group.from}` : undefined}
      actions={[
        { label: 'Copy the command', icon: Copy, run: () => board.copy(command, 'Command copied'), hidden: !command },
        { label: 'Open in Windows Terminal', icon: TerminalSquare, run: terminal, hidden: !command },
        { label: 'Remove from board', icon: X, run: () => board.removeCard(id), gap: true },
      ]}
      bodyClassName="flex flex-col gap-3"
    >
      {!info && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {info && (
        <>
          <pre className="cmd-text">{command}</pre>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={cwd} onChange={e => setCwd(e.target.value)} className="h-8 min-w-[180px] flex-1 font-mono text-[12px]" title="Runs in this folder" aria-label="Folder" disabled={running} />
            <ToggleGroup type="single" variant="outline" size="sm" value={shell} onValueChange={v => v && setShell(v as Shell)} disabled={running}>
              <ToggleGroupItem value="pwsh" className="px-2.5 text-[12px]">
                PowerShell
              </ToggleGroupItem>
              <ToggleGroupItem value="bash" className="px-2.5 text-[12px]" disabled={!info.shells.bash}>
                Bash
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <Button size="sm" variant="secondary" onClick={stop} className="active:scale-[0.96] transition-[scale,background-color] duration-150">
                <Square className="size-3.5" strokeWidth={2} /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={start} className="active:scale-[0.96] transition-[scale,background-color] duration-150">
                <Play className="size-3.5" strokeWidth={2} /> {run ? 'Run again' : 'Run'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={terminal} title="For commands that ask questions or need a login">
              <TerminalSquare className="size-3.5" strokeWidth={1.75} /> Terminal
            </Button>
            <span
              className={cn(
                'ml-auto text-[12px] text-muted-foreground',
                run?.status === 'done' && 'text-emerald-300/90',
                run?.status === 'failed' && 'text-red-300/90',
              )}
            >
              {status}
            </span>
          </div>
          {run && (
            <pre ref={outRef} className="cmd-out">
              {out || (running ? '' : '(no output)')}
              {run.truncated && '\n… output cut at 1 MB'}
            </pre>
          )}
          {!run && <p className="text-[12px] text-muted-foreground">Runs in {tidyPath(cwd)} with {shell === 'pwsh' ? 'PowerShell' : 'Git Bash'}. Nothing runs until you press Run.</p>}
        </>
      )}
      {error && <p className="text-[13px] text-destructive">{error}</p>}
    </CardShell>
  )
}
