// What kind of file something is, how to serve it, and opening it outside the app.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const FORMAT_BY_EXT = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', ico: 'image', avif: 'image',
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  csv: 'csv', tsv: 'csv',
  docx: 'docx', xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', xlsb: 'sheet', ods: 'sheet', pptx: 'slides',
  json: 'json',
  diff: 'diff', patch: 'diff',
  mmd: 'mermaid', mermaid: 'mermaid',
  txt: 'text', log: 'text', text: 'text',
}

const LANGUAGE_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyi: 'python', ipynb: 'json', jsonl: 'json', ndjson: 'json',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  sh: 'bash', bash: 'bash', zsh: 'bash', bat: 'dos', cmd: 'dos',
  sql: 'sql', kql: 'sql', dax: 'plaintext', m: 'plaintext', pq: 'plaintext',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini',
  css: 'css', scss: 'scss', less: 'less', xml: 'xml', xaml: 'xml', csproj: 'xml', vue: 'xml', svelte: 'xml',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', fs: 'plaintext',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', rb: 'ruby', php: 'php', r: 'r', swift: 'swift', lua: 'lua',
  scala: 'scala', dart: 'dart', graphql: 'graphql', gql: 'graphql', tf: 'plaintext', bicep: 'plaintext',
  dockerfile: 'dockerfile', makefile: 'makefile', gitignore: 'plaintext', editorconfig: 'ini', lock: 'plaintext',
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', txt: 'text/plain; charset=utf-8',
}

/** Files a browser can't show; the viewer offers Open, Reveal and VS Code instead. */
const BINARY_EXT = new Set([
  'doc', 'ppt', 'one', 'vsdx', 'msg', 'eml',
  'zip', '7z', 'rar', 'gz', 'tar', 'exe', 'msi', 'dll', 'pbix', 'pbit', 'parquet', 'avro', 'orc', 'db', 'sqlite', 'bin',
])

export function extOf(file) {
  const base = path.basename(file).toLowerCase()
  if (base === 'dockerfile' || base === 'makefile') return base
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(i + 1) : ''
}

export function mimeOf(file) {
  return MIME_BY_EXT[extOf(file)] || 'application/octet-stream'
}

/** True when the first 8 KB holds no NUL byte (so it is very likely text). */
export function looksLikeText(file) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(8192)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      return !buf.subarray(0, n).includes(0)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

/** { format, language? } for a file on disk. */
/** The format from the extension alone (no reading the file): '' when the extension says nothing. */
export function formatByExt(file) {
  const ext = extOf(file)
  if (FORMAT_BY_EXT[ext]) return FORMAT_BY_EXT[ext]
  if (LANGUAGE_BY_EXT[ext]) return 'code'
  if (BINARY_EXT.has(ext)) return 'binary'
  return ''
}

export function detect(file) {
  const ext = extOf(file)
  if (FORMAT_BY_EXT[ext]) return { format: FORMAT_BY_EXT[ext], language: ext === 'json' ? 'json' : undefined }
  if (LANGUAGE_BY_EXT[ext]) return { format: 'code', language: LANGUAGE_BY_EXT[ext] }
  if (BINARY_EXT.has(ext)) return { format: 'binary' }
  return looksLikeText(file) ? { format: 'text' } : { format: 'binary' }
}

/** Formats whose content the viewer receives as text in JSON (the rest load by URL). */
export const TEXT_FORMATS = new Set(['markdown', 'code', 'text', 'csv', 'json', 'diff', 'mermaid', 'article', 'compare'])

/** Content written with the show tool: the file extension it is stored under. */
export const CONTENT_EXT = { article: 'html', markdown: 'md', html: 'html', code: 'txt', text: 'txt', diff: 'diff', json: 'json', csv: 'csv', mermaid: 'mmd' }

function vscodeExe() {
  const cands = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
  ].filter(Boolean)
  return cands.find(c => fs.existsSync(c))
}

/** Opens a web link with the system's default handler (so a browser picker set as default gets to choose). */
export function openUrl(url) {
  const child = process.platform === 'win32'
    ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

/** Opens a file outside the app: with its default program, selected in Explorer, in Notepad or in VS Code. */
export function openOutside(file, how) {
  if (!fs.existsSync(file)) throw Object.assign(new Error('That file is no longer there'), { status: 404 })
  const opts = { detached: true, stdio: 'ignore', windowsHide: false }
  let child
  if (process.platform === 'win32') {
    if (how === 'reveal') child = spawn('explorer.exe', [`/select,${file}`], opts)
    else if (how === 'notepad') child = spawn('notepad.exe', [file], opts)
    else if (how === 'vscode') {
      const exe = vscodeExe()
      child = exe ? spawn(exe, [file], opts) : spawn('cmd.exe', ['/d', '/c', 'code', file], { ...opts, windowsHide: true })
    } else child = spawn('explorer.exe', [file], opts)
  } else {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    if (how === 'vscode') child = spawn('code', [file], opts)
    else child = spawn(opener, [how === 'reveal' ? path.dirname(file) : file], opts)
  }
  child.on('error', () => {})
  child.unref()
}
