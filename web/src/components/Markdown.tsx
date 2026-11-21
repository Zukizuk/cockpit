// Markdown, rendered the way it should read: GitHub-style (tables, task lists), sanitised, code highlighted,
// mermaid diagrams drawn, front matter shown as a small block, relative images and links resolved by the caller.
import { useEffect, useMemo, useRef } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { isLight } from '../theme'
import { notePathOf } from '../noteRefs'
import hljs from 'highlight.js/lib/common'
import powershell from 'highlight.js/lib/languages/powershell'
import dos from 'highlight.js/lib/languages/dos'
import dockerfile from 'highlight.js/lib/languages/dockerfile'

hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('dos', dos)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.configure({ ignoreUnescapedHTML: true })

export { hljs }

const isRelative = (href: string) => !!href && !/^([a-z][a-z0-9+.-]*:|#|\/\/|\/)/i.test(href)

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || ''
    if (!href || href.startsWith('#')) return
    if (isRelative(href)) node.setAttribute('data-local', href)
    else {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  }
})

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function frontMatter(text: string) {
  const m = /^---\r?\n([\s\S]{0,4000}?)\r?\n---\r?\n?/.exec(text)
  if (!m) return text
  return `\`\`\`yaml\n${m[1]}\n\`\`\`\n\n${text.slice(m[0].length)}`
}

export function renderMarkdown(text: string, resolveAsset?: (href: string) => string | null) {
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use({
    renderer: {
      // a link to another note (a journal page referring to a sticky note): opens the note in Cockpit
      link({ href, tokens }) {
        const note = notePathOf(href || '')
        if (!note) return false
        return `<a href="#" class="note-ref" data-note="${escapeAttr(note)}">${this.parser.parseInline(tokens)}</a>`
      },
      image({ href, title, text: alt }) {
        const src = (href && isRelative(href) && resolveAsset?.(href)) || href || ''
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt || '')}"${title ? ` title="${escapeAttr(title)}"` : ''} loading="lazy">`
      },
    },
  })
  const raw = marked.parse(frontMatter(text), { async: false }) as string
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'data-local', 'data-note'] })
}

let mermaidLoad: Promise<any> | null = null
// Cockpit is dark only.
const dark = () => !isLight()

async function drawMermaid(blocks: HTMLElement[]) {
  mermaidLoad ??= import('mermaid').then(m => m.default)
  const mermaid = await mermaidLoad
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark() ? 'dark' : 'default', fontFamily: 'inherit' })
  for (const code of blocks) {
    const pre = code.closest('pre')
    if (!pre || !pre.isConnected) continue
    try {
      const { svg } = await mermaid.render(`m${Math.random().toString(36).slice(2)}`, code.textContent || '')
      const div = document.createElement('div')
      div.className = 'mermaid-diagram'
      div.innerHTML = svg
      pre.replaceWith(div)
    } catch {
      pre.classList.add('mermaid-error')
      pre.title = 'This diagram has an error, so it is shown as text'
    }
  }
}

export function highlightIn(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>('pre code').forEach(block => {
    const lang = [...block.classList].find(c => c.startsWith('language-'))?.slice(9)
    if (lang === 'mermaid') return
    if (lang && !hljs.getLanguage(lang)) {
      block.classList.remove(`language-${lang}`)
      block.classList.add('language-plaintext')
    }
    if ((block.textContent || '').length < 200_000) hljs.highlightElement(block)
  })
  el.querySelectorAll<HTMLElement>('pre').forEach(pre => {
    if (pre.querySelector('.copy-code')) return
    const btn = document.createElement('button')
    btn.className = 'copy-code'
    btn.type = 'button'
    btn.textContent = 'Copy'
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent || '')
        btn.textContent = 'Copied'
        setTimeout(() => (btn.textContent = 'Copy'), 1200)
      } catch {
        btn.textContent = 'Blocked'
      }
    })
    pre.appendChild(btn)
  })
}

interface Props {
  text: string
  resolveAsset?: (href: string) => string | null
  onLocalLink?: (href: string) => void
  /** A link to another note was clicked. */
  onNoteLink?: (path: string) => void
  className?: string
}

export function Markdown({ text, resolveAsset, onLocalLink, onNoteLink, className }: Props) {
  const html = useMemo(() => renderMarkdown(text, resolveAsset), [text, resolveAsset])
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    highlightIn(el)
    const diagrams = [...el.querySelectorAll<HTMLElement>('pre code.language-mermaid')]
    if (diagrams.length) drawMermaid(diagrams)
  }, [html])

  return (
    <article
      ref={ref}
      className={`md ${className || ''}`}
      onClick={e => {
        const ref = (e.target as HTMLElement).closest('a[data-note]') as HTMLAnchorElement | null
        if (ref) {
          e.preventDefault()
          onNoteLink?.(ref.getAttribute('data-note') || '')
          return
        }
        const a = (e.target as HTMLElement).closest('a[data-local]') as HTMLAnchorElement | null
        if (!a || !onLocalLink) return
        e.preventDefault()
        onLocalLink(a.getAttribute('data-local') || '')
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
