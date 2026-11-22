// A card's comments: a count in its header (shown once there is one, or while the card is hovered) that opens the
// thread. The user and Claude both write here; Claude reads them through Cockpit's board tools.
import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Sparkles, X } from 'lucide-react'
import { useBoard } from '../board'
import { ago, onEvent } from '../lib'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function CardComments({ nodeId }: { nodeId: string }) {
  const board = useBoard()
  const list = board.comments[nodeId] || []
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)

  // opened from a card's menu: the menu hands focus back as it closes, which mustn't close this at once
  const openedAt = useRef(0)
  useEffect(
    () =>
      onEvent('comments-open', (d: { id?: string }) => {
        if (d.id !== nodeId) return
        openedAt.current = Date.now()
        setOpen(true)
      }),
    [nodeId],
  )
  const justOpened = (e: Event) => Date.now() - openedAt.current < 600 && e.preventDefault()
  useEffect(() => {
    if (open) requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' }))
  }, [open, list.length])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    await board.addComment(nodeId, t).catch(() => setText(t))
  }
  const fromClaude = list.some(c => c.by === 'Claude')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('comment-pill nodrag', !list.length && 'is-empty', open && 'is-open')}
          aria-label={list.length ? `${list.length} comment${list.length === 1 ? '' : 's'}` : 'Comment'}
          title={list.length ? 'Comments' : 'Comment'}
        >
          <MessageSquare className="size-[13px]" strokeWidth={1.75} />
          {list.length > 0 && <span>{list.length}</span>}
          {fromClaude && <span className="comment-dot" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="comment-pop" onOpenAutoFocus={e => e.preventDefault()} onFocusOutside={justOpened} onInteractOutside={justOpened}>
        <div className="comment-list">
          {!list.length && <p className="px-3 py-3 text-[13px] text-muted-foreground">No comments yet. Leave a note for yourself, or ask Claude about this card.</p>}
          {list.map(c => (
            <div key={c.id} className={cn('comment', c.by === 'Claude' && 'is-claude')}>
              <div className="comment-by">
                {c.by === 'Claude' && <Sparkles className="size-[12px]" strokeWidth={1.75} />}
                {c.by === 'Claude' ? 'Claude' : 'You'}
                <span className="text-muted-foreground"> · {ago(c.at)}</span>
                <button type="button" className="comment-x" aria-label="Delete comment" onClick={() => board.removeComment(c.id)}>
                  <X className="size-[12px]" strokeWidth={1.75} />
                </button>
              </div>
              <p className="comment-text">{c.text}</p>
            </div>
          ))}
          <div ref={end} />
        </div>
        <form
          className="comment-form"
          onSubmit={e => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder="Comment, or ask Claude… (Enter sends)"
            aria-label="New comment"
            className="comment-input"
          />
        </form>
      </PopoverContent>
    </Popover>
  )
}
