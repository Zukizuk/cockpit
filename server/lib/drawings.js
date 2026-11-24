// Drawings from a chat: the visualize tool's show_widget draws HTML or SVG in the chat, which gives it its colours (CSS
// variables), its icon font and two functions. An output sent with kind "drawing" (its code as text) is kept here as a
// page that gives them too, so it opens in Cockpit looking as it did in the chat, and is listed as a file.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

const DRAWING_STYLE = `
:root{color-scheme:light dark;--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,Consolas,monospace;--font-voice:Georgia,serif;--radius:8px;
--text-primary:#1f1e1d;--text-secondary:#5e5d59;--text-muted:#8a8985;--text-accent:#185fa5;--text-danger:#a32d2d;--text-success:#3b6d11;--text-warning:#854f0b;
--surface-0:#f0eee6;--surface-1:#f7f6f2;--surface-2:#ffffff;--bg-neutral:rgba(0,0,0,.05);--bg-accent:#e6f1fb;--bg-danger:#fcebeb;--bg-success:#eaf3de;--bg-warning:#faeeda;
--border:rgba(0,0,0,.12);--border-strong:rgba(0,0,0,.2);--border-stronger:rgba(0,0,0,.4);--border-accent:#378add}
@media (prefers-color-scheme:dark){:root{--text-primary:#ecebe6;--text-secondary:#b4b2a9;--text-muted:#888780;--text-accent:#85b7eb;--text-danger:#f09595;--text-success:#97c459;--text-warning:#ef9f27;
--surface-0:#1a1a19;--surface-1:#222221;--surface-2:#2a2a29;--bg-neutral:rgba(255,255,255,.06);--bg-accent:#0c447c;--bg-danger:#791f1f;--bg-success:#27500a;--bg-warning:#633806;
--border:rgba(255,255,255,.12);--border-strong:rgba(255,255,255,.2);--border-stronger:rgba(255,255,255,.4)}}
*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.7 var(--font-sans);color:var(--text-primary);background:var(--surface-1)}
h1,h2,h3{font-weight:500;color:var(--text-primary)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
button{font:inherit;font-size:14px;padding:6px 14px;border-radius:var(--radius);border:.5px solid var(--border-strong);background:transparent;color:var(--text-primary);cursor:pointer}
button:hover{background:var(--surface-0)}button:active{transform:scale(.98)}
input,select,textarea{font:inherit;color:inherit;background:var(--surface-2);border:.5px solid var(--border-strong);border-radius:var(--radius);padding:6px 10px}
svg text.t,svg .t{font:14px var(--font-sans);fill:var(--text-primary)}svg .ts{font:12px var(--font-sans);fill:var(--text-secondary)}svg .th{font:500 14px var(--font-sans);fill:var(--text-primary)}
`
// The chat's colour ramps (50, 600, 800 for light; 800, 200, 100 for dark), for a drawing's c-<hue> boxes: the shape
// gets the fill and outline; its text a darker shade for the title (th, t) and a lighter one for the rest (ts), never
// an outline (an outline set on the group would draw round the letters too)
const RAMPS = {
  purple: ['#EEEDFE', '#CECBF6', '#AFA9EC', '#534AB7', '#3C3489', '#26215C'],
  teal: ['#E1F5EE', '#9FE1CB', '#5DCAA5', '#0F6E56', '#085041', '#04342C'],
  coral: ['#FAECE7', '#F5C4B3', '#F0997B', '#993C1D', '#712B13', '#4A1B0C'],
  pink: ['#FBEAF0', '#F4C0D1', '#ED93B1', '#993556', '#72243E', '#4B1528'],
  gray: ['#F1EFE8', '#D3D1C7', '#B4B2A9', '#5F5E5A', '#444441', '#2C2C2A'],
  blue: ['#E6F1FB', '#B5D4F4', '#85B7EB', '#185FA5', '#0C447C', '#042C53'],
  green: ['#EAF3DE', '#C0DD97', '#97C459', '#3B6D11', '#27500A', '#173404'],
  amber: ['#FAEEDA', '#FAC775', '#EF9F27', '#854F0B', '#633806', '#412402'],
  red: ['#FCEBEB', '#F7C1C1', '#F09595', '#A32D2D', '#791F1F', '#501313'],
}
const SHAPES = ['rect', 'circle', 'ellipse', 'polygon']
const rampCss = dark =>
  Object.entries(RAMPS)
    .map(([hue, [s50, s100, s200, s600, s800]]) => {
      const c = `.c-${hue}`
      const shapes = SHAPES.flatMap(t => [`${c} ${t}`, `${t}${c}`]).join(',')
      const [fill, stroke, title, sub] = dark ? [s800, s200, s100, s200] : [s50, s600, s800, s600]
      return `${shapes}{fill:${fill};stroke:${stroke}}${c} .th,${c} .t{fill:${title}}${c} .ts{fill:${sub}}`
    })
    .join('\n')
const RAMP_STYLE = `svg text{stroke:none}
${rampCss(false)}
@media (prefers-color-scheme:dark){
${rampCss(true)}
}`
/** Changes when the page around a drawing changes, so drawings kept before are made again with it. */
const PAGE_VERSION = 2

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
/** A drawing's title ("sticky_note_fold_styles") as words ("Sticky note fold styles"). */
export const drawingTitle = t => {
  const w = String(t || '').replace(/[_-]+/g, ' ').trim()
  return w ? w[0].toUpperCase() + w.slice(1) : 'Drawing'
}
export function drawingPage(title, code) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(drawingTitle(title))}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">
<style>${DRAWING_STYLE}${RAMP_STYLE}
.drawing{max-width:680px;margin:0 auto}</style>
<script>window.sendPrompt = function () {}; window.openLink = function (u) { window.open(u, '_blank') }</script>
</head>
<body>
<div class="drawing">
${code}
</div>
</body>
</html>
`
}

export const drawingsDir = () => path.join(DATA_DIR, 'drawings')

/** Keeps one drawing as a page; returns its path. */
export function saveDrawing(title, code) {
  fs.mkdirSync(drawingsDir(), { recursive: true })
  // named by what's in it: the same drawing sent again (by a hook and a mod, or the turn sent twice) is the same file,
  // so Outputs lists it once
  const slug = String(title || 'drawing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'drawing'
  const hash = crypto.createHash('sha1').update(`${PAGE_VERSION}:${code}`).digest('hex').slice(0, 10)
  const file = path.join(drawingsDir(), `${slug}-${hash}.html`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, drawingPage(title, code))
  return file
}
