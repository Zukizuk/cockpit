// Snippets: things to keep at hand to copy (a command, some code, a connection string, credentials for the next few
// days), so they don't get lost when the clipboard moves on. Paste into the box (or select the card and press
// Ctrl+V anywhere, or use the clipboard button), name it, keep it. A click on a row copies it. A secret shows as dots
// until asked for, is encrypted on disk, and goes when deleted or when its time is up. Claude can leave one here too.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import {
  AlignLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  MoreVertical,
  Pencil,
  SquareTerminal,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { get, post, type Snippet, type SnippetKeep } from '../api'
import { useBoard, type CardNode } from '../board'
import { ago, emit, onEvent, useData } from '../lib'
import { Markdown } from '../components/Markdown'
import { CardShell, IconButton } from './CardShell'
import { RowButton } from './OutputsCard'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const KEEPS: { value: SnippetKeep; label: string }[] = [
  { value: 'day', label: '1 day' },
  { value: 'week', label: '1 week' },
  { value: 'month', label: '1 month' },
  { value: 'forever', label: 'Always' },
]

/** The same guess the server makes, so the lock shows before keeping it. */
export function looksSecret(text: string) {
  const t = text.trim()
  if (/^(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abp]|AKIA|eyJ)[A-Za-z0-9_\-.]{8,}/.test(t)) return true
  if (/\b(password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]/i.test(t)) return true
  if (/\s/.test(t) || t.length < 12 || t.length > 400) return false
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(t)).length
  if (t.length >= 20) return kinds >= 3
  const cls = (c: string) => (/[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 1 : /[0-9]/.test(c) ? 2 : 3)
  let switches = 0
  for (let i = 1; i < t.length; i++) if (cls(t[i]) !== cls(t[i - 1])) switches++
  return kinds >= 3 && /[a-z]/.test(t) && /[A-Z]/.test(t) && /[A-Za-z][^A-Za-z]+[A-Za-z]/.test(t) && switches >= (t.length - 1) / 2
}

/** "6d", "5h": how long a snippet has left; nothing when it stays. */
function left(s: Snippet) {
  if (!s.expiresAt) return ''
  const ms = s.expiresAt - Date.now()
  return ms < 3_600_000 ? '<1h' : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 86_400_000)}d`
}

const isCode = (s: Snippet) => !!s.language || s.lines > 1 || /[|;&$`{}()[\]<>=\\/]/.test(s.preview)

/**
 * The page copies it, as any site does; where a window may not use the clipboard (Claude's browser pane), Cockpit's
 * server tries instead (this laptop refuses background programs the clipboard, 17 Nov: hence the page first).
 */
async function copyText(id: string) {
  const { text } = await get<{ text: string }>(`/api/snippets/${id}/text`)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    await post(`/api/snippets/${id}/copy`).catch(() => {
      throw new Error("This window can't use the clipboard: show it and select it instead")
    })
  }
}

type Action = { label: string; icon: LucideIcon; run: () => void; danger?: boolean; gap?: boolean }

function MenuItems({ actions, Item, Sep }: { actions: Action[]; Item: typeof ContextMenuItem | typeof DropdownMenuItem; Sep: typeof ContextMenuSeparator | typeof DropdownMenuSeparator }) {
  return (
    <>
      {actions.map(a => (
        <Fragment key={a.label}>
          {a.gap && <Sep />}
          <Item variant={a.danger ? 'destructive' : 'default'} onSelect={() => a.run()}>
            <a.icon strokeWidth={1.75} />
            {a.label}
          </Item>
        </Fragment>
      ))}
    </>
  )
}

function SnippetRow({ s }: { s: Snippet }) {
  const board = useBoard()
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<string | null>(null) // a revealed secret, or the whole of a long snippet
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const copy = async () => {
    try {
      await copyText(s.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (e: any) {
      board.toast(e.message || 'Could not copy')
    }
  }
  const fetchText = () => get<{ text: string }>(`/api/snippets/${s.id}/text`).then(r => r.text)
  // a secret shown hides itself again after 30 seconds
  const reveal = async () => {
    if (shown !== null) return setShown(null)
    try {
      setShown(await fetchText())
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown(null), 30_000)
    } catch (e: any) {
      board.toast(e.message)
    }
  }
  const expand = async () => {
    if (open) return setOpen(false)
    if (shown === null && s.length > s.preview.length) setShown(await fetchText().catch(() => s.preview))
    setOpen(true)
  }
  const update = (patch: Record<string, unknown>) => post(`/api/snippets/${s.id}`, patch).catch((e: Error) => board.toast(e.message))
  const remove = () => post(`/api/snippets/${s.id}/remove`).catch((e: Error) => board.toast(e.message))

  const code = isCode(s)
  const Icon = s.secret ? Lock : code ? SquareTerminal : AlignLeft
  const many = !s.secret && s.lines > 1
  const actions: Action[] = [
    { label: 'Copy', icon: Copy, run: copy },
    ...(s.secret ? [{ label: shown !== null ? 'Hide' : 'Show', icon: shown !== null ? EyeOff : Eye, run: reveal }] : []),
    ...(many ? [{ label: open ? 'Show less' : 'Show all', icon: open ? ChevronUp : ChevronDown, run: expand }] : []),
    { label: 'Rename', icon: Pencil, run: () => setNaming(true), gap: true },
    { label: s.secret ? 'Make it plain' : 'Make it secret', icon: s.secret ? LockOpen : Lock, run: () => update({ secret: !s.secret }) },
    ...KEEPS.map((k, i) => ({ label: `Keep ${k.value === 'forever' ? 'always' : `for ${k.label}`}`, icon: Timer, run: () => update({ keep: k.value }), gap: i === 0 })),
    { label: 'Delete', icon: Trash2, run: remove, danger: true, gap: true },
  ]
  const from = s.from && s.from !== 'you' ? `From ${s.from.replace(/^Claude · /, 'Claude in ')}, ` : 'Kept '
  const hint = `${from}${ago(s.createdAt)}${s.expiresAt ? `; goes ${new Date(s.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`

  const untitled = !s.secret && s.title === s.preview.trim().split('\n')[0].trim().slice(0, 80)
  let value: ReactNode
  if (copied) value = <span className="text-foreground/80">Copied</span>
  else if (s.secret) value = shown !== null ? <span className="snip-shown">{shown}</span> : <span className="snip-dots">{'•'.repeat(Math.min(18, Math.max(8, s.length)))}</span>
  else value = s.preview.split('\n')[0]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="snip-wrap">
          <div
            role="button"
            tabIndex={0}
            className={cn('snip-row group/row', copied && 'is-copied')}
            title={hint}
            onClick={() => !naming && copy()}
            onKeyDown={e => {
              if (!naming && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                copy()
              }
            }}
          >
            <span className="snip-icon" aria-hidden>
              <Icon className="snip-icon-a" strokeWidth={1.75} />
              <Check className="snip-icon-b" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              {naming ? (
                <input
                  autoFocus
                  defaultValue={s.title}
                  aria-label="Name"
                  className="snip-name"
                  onClick={e => e.stopPropagation()}
                  onFocus={e => e.currentTarget.select()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setNaming(false)
                  }}
                  onBlur={e => {
                    const v = e.currentTarget.value.trim()
                    if (v && v !== s.title) update({ title: v })
                    setNaming(false)
                  }}
                />
              ) : (
                // no name given: the title is just the value again, so the row shows the value once
                !untitled && <span className="snip-title">{s.title}</span>
              )}
              <span className={cn('snip-value', shown !== null && s.secret && 'is-open')}>{value}</span>
            </span>
            {left(s) && <span className="snip-left">{left(s)}</span>}
            <span className="snip-actions" onClick={e => e.stopPropagation()}>
              {s.secret && <RowButton icon={shown !== null ? EyeOff : Eye} label={shown !== null ? 'Hide' : 'Show (hides again in 30 s)'} onClick={reveal} />}
              {many && <RowButton icon={open ? ChevronUp : ChevronDown} label={open ? 'Show less' : 'Show all'} onClick={expand} />}
              <RowButton icon={Trash2} label="Delete" onClick={remove} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="More" className="snip-more">
                    <MoreVertical className="size-[14px]" strokeWidth={1.75} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <MenuItems actions={actions} Item={DropdownMenuItem} Sep={DropdownMenuSeparator} />
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
          {open && many && (
            <div className="snip-full">
              <Markdown text={'```' + (s.language || '') + '\n' + (shown ?? s.preview) + '\n```'} className="md-compact" />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <MenuItems actions={actions} Item={ContextMenuItem} Sep={ContextMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The box at the top: paste (or type), then name it, lock it or not, choose how long, keep. */
function NewSnippet({ onKept }: { onKept: () => void }) {
  const board = useBoard()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [secret, setSecret] = useState<boolean | null>(null) // null: guessed from the text
  const [keep, setKeep] = useState<SnippetKeep | null>(null) // null: a week for a secret, always otherwise
  const field = useRef<HTMLTextAreaElement>(null)
  const name = useRef<HTMLInputElement>(null)
  const isSecret = secret ?? looksSecret(text)
  const keepFor = keep ?? (isSecret ? 'week' : 'forever')

  const reset = () => {
    setText('')
    setTitle('')
    setSecret(null)
    setKeep(null)
  }
  const take = (t: string) => {
    setText(t)
    requestAnimationFrame(() => name.current?.focus())
  }
  const save = async () => {
    if (!text.trim()) return
    try {
      await post('/api/snippets', { text, title: title.trim() || undefined, secret: isSecret, keep: keepFor })
      reset()
      onKept()
    } catch (e: any) {
      board.toast(e.message)
    }
  }
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) take(t)
      else board.toast('The clipboard has no text')
    } catch {
      field.current?.focus()
      board.toast('Press Ctrl+V to paste it here')
    }
  }

  // select the card and press Ctrl+V anywhere on the board, or use the clipboard button in its header
  useEffect(() => onEvent('snippet-paste', (d: { text?: string; fromClipboard?: boolean }) => (d.fromClipboard ? fromClipboard() : d.text && take(d.text))))

  // the box grows with what's pasted by itself (CSS field-sizing): nothing measures it, so folding, hiding or a
  // space switch can never leave it squashed

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') reset()
    if (e.key === 'Enter' && (e.target === name.current || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className={cn('snip-new', text && 'has-text')}>
      <textarea
        data-typeto
        ref={field}
        value={text}
        rows={1}
        spellCheck={false}
        placeholder="Paste to keep…"
        aria-label="Something to keep"
        className={cn('snip-field', text && 'mono', isSecret && text && 'is-secret')}
        onChange={e => setText(e.target.value)}
        onPaste={() => !text && requestAnimationFrame(() => name.current?.focus())}
        onKeyDown={onKey}
      />
      {text && (
        <div className="snip-opts">
          <input ref={name} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={onKey} placeholder="Name" aria-label="Name" className="snip-name" />
          <RowButton icon={isSecret ? Lock : LockOpen} label={isSecret ? 'Secret: hidden, encrypted (click for plain)' : 'Plain (click to make it secret)'} onClick={() => setSecret(!isSecret)} active={isSecret} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="snip-keep" aria-label="How long to keep it">
                {KEEPS.find(k => k.value === keepFor)?.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {KEEPS.map(k => (
                <DropdownMenuItem key={k.value} onSelect={() => setKeep(k.value)}>
                  <Timer strokeWidth={1.75} />
                  {k.label}
                  {k.value === keepFor && <Check className="ml-auto" strokeWidth={2} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="snip-save" onClick={save}>
            Keep
          </button>
        </div>
      )}
    </div>
  )
}

export function SnippetsCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const list = useData(() => get<Snippet[]>('/api/snippets'), [], { refreshOn: ['snippets'], refreshEvery: 300_000 })
  const items = list.data || []
  const secrets = items.filter(s => s.secret).length
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={ClipboardList}
      title="Snippets"
      subtitle={items.length ? `${items.length} kept${secrets ? ` · ${secrets} secret` : ''}` : undefined}
      quick={<IconButton icon={ClipboardPaste} label="Keep what's on the clipboard" onClick={() => emit('snippet-paste', { fromClipboard: true })} />}
      actions={[{ label: 'Remove from board', icon: X, run: () => board.removeCard(id) }]}
      bodyClassName="snip-body"
      autoHeight
    >
      <NewSnippet onKept={list.reload} />
      {items.length > 0 && (
        <div className="snip-list">
          {items.map(s => (
            <SnippetRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </CardShell>
  )
}
