// A file or link on the board, drawn in place. Expand for full screen; everything else is one click away.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { Bookmark, Brush, Check, Code2, Copy, ExternalLink, PenLine, FolderOpen, Globe, Maximize2, Pin, RefreshCw, Undo2, X } from 'lucide-react'
import { get, openOutside, post, type ShownEntry, type ShownRead } from '../api'
import { ago, emit, onEvent } from '../lib'
import { editImage } from '../views/ImageEditor'
import { SIZES, useBoard, type CardNode } from '../board'
import { Viewer, basename, iconFor, kindLabel, placeOf } from '../components/Viewer'
import { Skeleton } from '@/components/ui/skeleton'
import { CardShell, IconButton, type CardAction } from './CardShell'
import { editorLabel } from '../api'

/** Open, show-in-folder and copy for one item: used by the card and by the full-screen reader. */
export function useItemActions(read: ShownRead | null, reload: () => void) {
  const board = useBoard()
  const e = read?.entry
  const native = useCallback(
    async (how: 'default' | 'reveal' | 'editor' = 'default') => {
      if (!e) return
      if (e.kind === 'link') {
        board.openLink(e.url || '')
        return
      }
      try {
        await openOutside({ kind: 'shown', id: e.id, how })
        board.toast(how === 'editor' ? `${editorLabel(board.prefs.editor).replace('Open', 'Opening')}…` : how === 'reveal' ? 'Showing it in its folder…' : `Opening ${basename(e.path)}…`)
      } catch (err: any) {
        board.toast(err.message)
      }
    },
    [e, board],
  )
  const readAgain = useCallback(async () => {
    if (!e) return
    board.toast('Reading the page again…')
    try {
      await post(`/api/shown/${e.id}/refresh`)
      reload()
      board.toast('Updated')
    } catch (err: any) {
      board.toast(err.message)
    }
  }, [e, board, reload])
  // drawn on (here or by Claude) or put back to the original: the picture again
  useEffect(() => onEvent('image-edited', (d: { id?: string }) => d.id && d.id === e?.id && reload()), [e?.id, reload])
  const backToOriginal = useCallback(async () => {
    if (!e) return
    try {
      await post(`/api/shown/${e.id}/original`)
      emit('image-edited', { id: e.id })
      board.toast('Back to the original')
    } catch (err: any) {
      board.toast(err.message)
    }
  }, [e, board])
  const textual = !!e && ['markdown', 'code', 'text', 'json', 'csv', 'diff', 'html', 'mermaid'].includes(e.format)
  const canCopyText = !!e && !!read?.text && (e.kind === 'content' || textual)
  const actions: CardAction[] = e
    ? [
        // an image: draw on it (arrows, boxes, text, blur, crop); and, once drawn on, back to how it was
        // on the card's strip too (draw, open): those are under More in its menu; the rest are in the menu itself
        { label: 'Draw on it', icon: Brush, run: () => editImage(e.id), hidden: e.format !== 'image', more: true },
        { label: e.kind === 'link' ? 'Open in the browser' : 'Open in its own program', icon: ExternalLink, run: () => native('default'), more: e.kind !== 'content' },
        { label: 'Back to the original', icon: Undo2, run: backToOriginal, hidden: e.format !== 'image' || !e.original },
        { label: 'Show in folder', icon: FolderOpen, run: () => native('reveal'), hidden: e.kind === 'link' },
        {
          label: editorLabel(board.prefs.editor),
          icon: board.prefs.editor === 'vscode' ? Code2 : PenLine,
          run: () => native('editor'),
          hidden: !textual || e.kind !== 'file' || board.prefs.editor === 'default',
        },
        { label: 'Read the page again', icon: RefreshCw, run: readAgain, hidden: e.kind !== 'link' },
        // Later is a list of the same kept things: the card stays on the board either way
        {
          label: 'Keep on Later',
          icon: Bookmark,
          run: () => board.setLater(e.id, 'reading').then(() => (reload(), board.toast('On Later, under Reading'))),
          hidden: (e.kind !== 'link' && e.kind !== 'file') || (!!e.later && e.later !== 'done'),
        },
        { label: 'Done reading', icon: Check, run: () => board.setLater(e.id, 'done').then(() => (reload(), board.toast('Done, on Later'))), hidden: !e.later || e.later === 'done' },
        { label: 'Pin to Quick access', icon: Pin, run: () => board.pin(e.kind === 'link' ? { url: e.url, title: e.title } : { path: e.path, title: e.title }), hidden: e.kind !== 'link' && e.kind !== 'file' },
        { label: e.kind === 'link' ? 'Copy link' : 'Copy path', icon: Copy, run: () => board.copy(e.kind === 'link' ? e.url || '' : e.path, e.kind === 'link' ? 'Link copied' : 'Path copied'), gap: true, hidden: e.kind === 'content', more: e.kind !== 'link' },
        // written content (a draft Claude made, a note kept): its words are what you came for
        { label: 'Copy the text', icon: Copy, run: () => board.copy(read?.text || '', 'Copied'), gap: e.kind === 'content', hidden: !canCopyText },
      ]
    : []
  return { native, readAgain, actions, canCopyText }
}

export function ItemCard({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard()
  const rf = useReactFlow<CardNode>()
  const [read, setRead] = useState<ShownRead | null>(null)
  const [error, setError] = useState('')
  const version = board.versions[data.ref]
  const lastVersion = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const r = await get<ShownRead>(`/api/shown/${data.ref}`)
      setRead(r)
      setError('')
      if (!r.entry.seen) post(`/api/shown/${data.ref}`, { seen: true }).catch(() => {})
    } catch (e: any) {
      setError(e.message)
    }
  }, [data.ref])

  useEffect(() => {
    load()
  }, [load])

  // the file changed on disk: draw it again
  useEffect(() => {
    if (version === undefined) return
    if (lastVersion.current !== undefined && lastVersion.current !== version) load()
    lastVersion.current = version
  }, [version, load])

  // An image card takes the image's shape, so a wide screenshot isn't a strip in a tall empty card. Only while the
  // card still has the size it was put on the board with: once it has been resized by hand, that size stays.
  const fitImage = useCallback(
    (img: HTMLImageElement) => {
      const node = rf.getNode(id)
      const box = img.closest('.image-view') as HTMLElement | null
      if (!node || !box || !img.naturalWidth || !img.naturalHeight) return
      const w = node.width ?? node.measured?.width ?? 0
      const h = node.height ?? node.measured?.height ?? 0
      if (w !== SIZES.item.w || h !== SIZES.item.h) return
      const chromeW = w - box.clientWidth
      const chromeH = h - box.clientHeight
      const scale = Math.min(1, 880 / img.naturalWidth, 640 / img.naturalHeight)
      const width = Math.round(Math.max(320, img.naturalWidth * scale) + chromeW)
      const height = Math.round(Math.max(160, img.naturalHeight * scale) + chromeH)
      if (width === w && height === h) return
      // keep the card's centre where it was
      rf.updateNode(id, { width, height, position: { x: node.position.x + (w - width) / 2, y: node.position.y + (h - height) / 2 } })
      board.persist()
    },
    [rf, id, board],
  )

  const { native, readAgain, actions, canCopyText } = useItemActions(read, load)
  const e = read?.entry
  // The viewer is drawn again only when the item changes. Every card follows the board's shared state (a toast, a
  // note saved elsewhere, a list refreshed), and a long document or a wide sheet is slow to draw for nothing.
  const latest = useRef({ native, readAgain, fitImage, near: (n: ShownEntry) => board.addCard('item', n.id, { near: id }) })
  latest.current = { native, readAgain, fitImage, near: (n: ShownEntry) => board.addCard('item', n.id, { near: id }) }
  const viewer = useMemo(
    () =>
      read && (
        <Viewer
          read={read}
          compact
          onOpenNative={() => latest.current.native('default')}
          onOpenPath={n => latest.current.near(n)}
          onReadAgain={() => latest.current.readAgain()}
          onImageLoad={img => latest.current.fitImage(img)}
        />
      ),
    [read],
  )
  const all: CardAction[] = [
    { label: 'Open full screen', icon: Maximize2, run: () => board.expand({ type: 'item', ref: data.ref }), more: true },
    ...actions,
    { label: 'Remove from board', icon: X, run: () => board.removeCard(id), gap: true },
  ]
  const sub = e ? [kindLabel(e), e.kind === 'link' ? e.siteName : e.kind === 'file' ? placeOf(e.path) : e.from, ago(e.shownAt || e.createdAt)].filter(Boolean).join(' · ') : ''

  return (
    <CardShell
      selected={!!selected}
      pulse={data.pulse}
      born={data.born}
      icon={e ? iconFor(e) : Globe}
      title={e?.title || (error ? 'Not found' : 'Loading…')}
      subtitle={sub}
      actions={all}
      onExpand={() => board.expand({ type: 'item', ref: data.ref })}
      quick={
        e && (
          <>
            {e.kind === 'content' && canCopyText ? (
              <IconButton icon={Copy} label="Copy the text" onClick={() => board.copy(read?.text || '', 'Copied')} />
            ) : (
              <IconButton icon={ExternalLink} label={e.kind === 'link' ? 'Open in the browser' : 'Open in its own program'} onClick={() => native('default')} />
            )}
            {e.format === 'image' && <IconButton icon={Brush} label="Draw on it" onClick={() => editImage(e.id)} />}
            <IconButton icon={Maximize2} label="Open full screen" onClick={() => board.expand({ type: 'item', ref: data.ref })} />
          </>
        )
      }
      bodyClassName={e && ['pdf', 'html', 'image', 'sheet', 'csv'].includes(e.format) ? 'flush' : undefined}
    >
      {error ? (
        <p className="text-[13px] text-muted-foreground">{error}</p>
      ) : !read ? (
        <div className="grid gap-2.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : (
        viewer
      )}
    </CardShell>
  )
}
