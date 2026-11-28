// Questions an agent left instead of stopping to ask. Each shows the agent's best guess in grey where the answer goes:
// the agent carries on with that guess, and the person types over it whenever they like (Enter keeps it), or takes
// the guess as it is. The agent reads the answers when it next looks. Answered ones go below, and can be changed.
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ArrowUp, Check, MessageCircleQuestion, Pencil, Sparkles, X } from 'lucide-react'
import { get, post, type Question } from '../api'
import { useBoard, type CardNode } from '../board'
import { ago, useData } from '../lib'
import { CardShell, IconButton, type CardAction } from './CardShell'
import { TellClaude, useListening } from '../agent/presence'
import { cn } from '@/lib/utils'

export function QuestionsCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const qs = useData(() => get<Question[]>('/api/questions'), [], { refreshOn: ['questions'] })
  const listening = useListening()
  const list = qs.data || []
  const open = list.filter(q => !q.answeredAt)
  const answered = list.filter(q => q.answeredAt).reverse()
  const answer = (q: Question, text: string) => post(`/api/questions/${q.id}`, { answer: text }).then(() => qs.reload(), (e: Error) => board.toast(e.message))
  const remove = (q: Question) => post(`/api/questions/${q.id}/remove`).then(() => qs.reload(), (e: Error) => board.toast(e.message))
  const actions: CardAction[] = [{ label: 'Remove from board', icon: X, run: () => board.removeCard(id), gap: true }]
  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={MessageCircleQuestion}
      title="Questions"
      subtitle={!list.length ? 'From Claude, when it needs you' : open.length ? `${open.length} waiting for you` : 'All answered'}
      actions={actions}
    >
      {!list.length ? (
        <p className="px-1 py-2 text-[13px] leading-relaxed text-muted-foreground">
          When Claude needs something only you know, it asks here with its best guess, in grey, and carries on with that. Type over the grey whenever you like.
        </p>
      ) : (
        <div className="questions">
          {open.map(q =>
            q.kind === 'proposal' ? (
              <ProposalRow key={q.id} q={q} onAnswer={t => answer(q, t)} onRemove={() => remove(q)} />
            ) : (
              <QuestionRow key={q.id} q={q} onAnswer={t => answer(q, t)} onRemove={() => remove(q)} />
            ),
          )}
          {answered.length > 0 && <div className="questions-sep">Answered</div>}
          {answered.map(q =>
            q.kind === 'proposal' ? (
              <ProposalRow key={q.id} q={q} onAnswer={t => answer(q, t)} onRemove={() => remove(q)} />
            ) : (
              <QuestionRow key={q.id} q={q} onAnswer={t => answer(q, t)} onRemove={() => remove(q)} />
            ),
          )}
          {/* a chat listening for the user: one click wakes it to read the answers */}
          {listening.length > 0 && answered.some(q => q.kind !== 'proposal') && (
            <div className="questions-tell">
              <TellClaude who={listening} text="I've answered your questions on the board's Questions card." label="Tell Claude I've answered" />
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}

function QuestionRow({ q, onAnswer, onRemove }: { q: Question; onAnswer: (text: string) => Promise<unknown>; onRemove: () => void }) {
  const done = !!q.answeredAt
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const keep = async () => {
    const t = text.trim()
    if (!t) return
    await onAnswer(t)
    setText('')
    setEditing(false)
  }
  return (
    <div className={cn('question', done && 'is-answered')}>
      <div className="question-head">
        <p className="question-text">{q.question}</p>
        <IconButton icon={X} label="Take this question away" onClick={onRemove} className="question-x" />
      </div>
      <p className="question-meta">
        {q.by} · {ago(q.at)}
        {q.about ? ` · about ${q.about}` : ''}
      </p>
      {done && !editing ? (
        <div className="question-answer">
          <Check className="size-3.5 shrink-0" strokeWidth={2} />
          <span>{q.answer}</span>
          <IconButton
            icon={Pencil}
            label="Change the answer"
            onClick={() => {
              setText(q.answer || '')
              setEditing(true)
            }}
          />
        </div>
      ) : (
        <>
          {/* a few to pick from: one click answers; the agent's guess is marked */}
          {!!q.choices?.length && (
            <div className="question-choices" role="group" aria-label="Choices">
              {q.choices.map(c => (
                <button
                  key={c}
                  type="button"
                  className={cn('question-choice', c === q.guess && 'is-guess', c === q.answer && 'is-picked')}
                  onClick={() => onAnswer(c).then(() => setEditing(false))}
                >
                  {c}
                  {c === q.guess && <span className="question-guess-mark">{q.by === 'Claude' ? "Claude's guess" : 'the guess'}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="question-field">
            <textarea
              className="question-input"
              rows={1}
              value={text}
              placeholder={q.choices?.length ? 'Or write something else' : q.guess || 'Your answer'}
              aria-label={`Answer: ${q.question}`}
              data-typeto
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  keep()
                } else if (e.key === 'Escape' && editing) setEditing(false)
              }}
            />
            <button type="button" className="question-send" aria-label="Save the answer" title="Save the answer (Enter)" disabled={!text.trim()} onClick={keep}>
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          </div>
          <div className="question-foot">
            {q.guess && !done ? (
              <span>
                {q.by} is going with {q.choices?.length ? 'its guess' : 'the grey answer'} until you say otherwise.
              </span>
            ) : (
              <span>Enter, or the arrow, keeps it.</span>
            )}
            {q.guess && !done && !q.choices?.length && (
              <button type="button" className="question-take" onClick={() => onAnswer(q.guess!)}>
                Use the guess
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Approve on the board: a change Claude would make to the board, waiting for the person's Do it or Don't. The answer
 * goes straight to a chat that's listening (no Tell Claude needed); one that isn't reads it when it next looks.
 */
function ProposalRow({ q, onAnswer, onRemove }: { q: Question; onAnswer: (text: string) => Promise<unknown>; onRemove: () => void }) {
  const done = !!q.answeredAt
  const yes = q.answer === 'Do it'
  return (
    <div className={cn('question proposal', done && 'is-answered')}>
      <div className="question-head">
        <p className="proposal-label">
          <Sparkles className="size-3.5" strokeWidth={2} />
          {q.by} wants to
        </p>
        <IconButton icon={X} label="Take this plan away" onClick={onRemove} className="question-x" />
      </div>
      <p className="question-text">{q.question}</p>
      <p className="question-meta">
        {ago(q.at)}
        {q.about ? ` · about ${q.about}` : ''}
      </p>
      {done ? (
        <div className="question-answer">
          {yes ? <Check className="size-3.5 shrink-0" strokeWidth={2} /> : <X className="size-3.5 shrink-0" strokeWidth={2} />}
          <span>{yes ? `You said do it. ${q.by} has been told.` : `You said don't. ${q.by} has been told.`}</span>
        </div>
      ) : (
        <div className="proposal-buttons">
          <button type="button" className="proposal-yes" onClick={() => onAnswer('Do it')}>
            Do it
          </button>
          <button type="button" className="proposal-no" onClick={() => onAnswer("Don't")}>
            Don't
          </button>
        </div>
      )}
    </div>
  )
}
