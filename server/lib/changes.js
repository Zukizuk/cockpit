// What changed in a file Claude touched, the way GitHub shows it: uncommitted changes against the last commit, or
// the whole file when git doesn't track it yet, or (when it's already committed) the last commit that touched it.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { UserError } from './config.js'
import { outputTarget } from './outputs.js'

const cache = new Map() // file|mtime -> result

function git(args, cwd) {
  return new Promise(resolve => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') }),
    )
  })
}

export function countDiff(diff) {
  let added = 0
  let removed = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue
    if (l.startsWith('+')) added++
    else if (l.startsWith('-')) removed++
  }
  return { added, removed }
}

export async function changesForFile(file) {
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return { repo: false, source: 'none', label: 'The file is no longer there', diff: '', added: 0, removed: 0 }
  }
  const key = `${file.toLowerCase()}|${st.mtimeMs}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.value
  // git runs in the file's own folder with just its name: no root-relative paths, which go wrong when Windows and
  // git spell the same folder differently (the short USER~1 form against the full name)
  const dir = path.dirname(file)
  const rel = path.basename(file)
  const root = await git(['rev-parse', '--show-toplevel'], dir)
  let value
  if (!root.ok) {
    value = { repo: false, source: 'none', label: 'Not in a git repository, so there is nothing to compare with', diff: '', added: 0, removed: 0 }
  } else {
    const work = await git(['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel], dir)
    if (work.ok && work.out.trim()) {
      value = { repo: true, source: 'working', label: 'Not committed yet, against the last commit', diff: work.out, ...countDiff(work.out) }
    } else {
      const tracked = await git(['ls-files', '--error-unmatch', '--', rel], dir)
      if (!tracked.ok) {
        const text = fs.readFileSync(file, 'utf8')
        const lines = text.replace(/\n$/, '').split('\n')
        const diff = `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`
        value = { repo: true, source: 'untracked', label: 'A new file (git does not track it yet)', diff, added: lines.length, removed: 0 }
      } else {
        const last = await git(['log', '-1', '--no-color', '--format=%h %s', '-p', '--', rel], dir)
        const [head, ...rest] = last.out.split('\n')
        const diff = rest.join('\n').replace(/^\s*\n/, '')
        value = diff.trim()
          ? { repo: true, source: 'commit', label: `Already committed: ${head.trim()}`, diff, ...countDiff(diff) }
          : { repo: true, source: 'none', label: 'No changes', diff: '', added: 0, removed: 0 }
      }
    }
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

export async function changesFor(groupId, index) {
  const item = outputTarget(groupId, index)
  if (item.kind !== 'file') throw new UserError('Only files have changes')
  return changesForFile(item.target)
}
