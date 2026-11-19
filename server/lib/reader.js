// Turns a web link into a clean, readable article (Mozilla's Readability, the engine behind Firefox's Reader
// View) and keeps a copy, so a saved link stays readable if the page changes or disappears.
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { UserError } from './config.js'

const MAX_BYTES = 6 * 1024 * 1024

export function checkUrl(raw) {
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    throw new UserError('Not a link')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserError('Only http and https links can be read')
  return url
}

/** Makes relative links and images absolute, against the page's address. */
function absolutize(doc, base) {
  for (const [sel, attr] of [['a[href]', 'href'], ['img[src]', 'src'], ['source[src]', 'src'], ['video[src]', 'src']]) {
    for (const el of doc.querySelectorAll(sel)) {
      try {
        el.setAttribute(attr, new URL(el.getAttribute(attr), base).href)
      } catch {
        // leave it as it was
      }
    }
  }
  for (const el of doc.querySelectorAll('img[srcset], source[srcset]')) {
    const fixed = el
      .getAttribute('srcset')
      .split(',')
      .map(part => {
        const [u, ...rest] = part.trim().split(/\s+/)
        try {
          return [new URL(u, base).href, ...rest].join(' ')
        } catch {
          return ''
        }
      })
      .filter(Boolean)
      .join(', ')
    el.setAttribute('srcset', fixed)
  }
  for (const img of doc.querySelectorAll('img[data-src]')) {
    if (!img.getAttribute('src')) {
      try {
        img.setAttribute('src', new URL(img.getAttribute('data-src'), base).href)
      } catch {
        // ignore
      }
    }
  }
}

/** Fetches a page and returns { title, byline, siteName, excerpt, html, words } or throws a readable error. */
export async function readArticle(raw, fetchImpl = fetch) {
  const url = checkUrl(raw)
  let res
  try {
    res = await fetchImpl(url.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
  } catch (e) {
    throw new UserError(`Could not reach ${url.host}${e?.name === 'TimeoutError' ? ' (took too long)' : ''}`, 502)
  }
  if (!res.ok) throw new UserError(`${url.host} answered ${res.status}`, 502)
  const type = res.headers.get('content-type') || ''
  if (!/html|xml/i.test(type)) throw new UserError(`That link is a ${type.split(';')[0] || 'file'}, not a web page`, 415)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new UserError('That page is too large to read here', 413)
  const finalUrl = res.url || url.href
  const { document } = parseHTML(buf.toString('utf8'))
  absolutize(document, finalUrl)
  const pageTitle = document.querySelector('title')?.textContent?.trim() || url.host
  const site = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || url.host.replace(/^www\./, '')
  const image = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''
  const article = new Readability(document, { charThreshold: 300 }).parse()
  if (!article || !article.content || (article.textContent || '').trim().length < 200) {
    throw new UserError('This page has no readable article (it may need a login or run on scripts). Open it in the browser instead.', 422)
  }
  const words = (article.textContent || '').trim().split(/\s+/).length
  return {
    url: finalUrl,
    title: (article.title || pageTitle).trim(),
    byline: (article.byline || '').trim(),
    siteName: (article.siteName || site || '').trim(),
    excerpt: (article.excerpt || '').trim().slice(0, 400),
    image,
    html: article.content,
    words,
  }
}
