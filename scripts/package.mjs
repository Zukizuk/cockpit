// Builds the Windows release: release/Cockpit-<version>-win-x64.zip, which holds everything Cockpit needs to run,
// its own Node included, so the person installing it needs nothing else.
//
//   Cockpit/
//     Install.cmd, install.ps1        double-click to install (or update) for this user
//     Uninstall.cmd, uninstall.ps1    copied into the install folder too
//     app/                            the server, the built web app, the scripts, production node_modules
//     runtime/node.exe                the Node this was built with
//
// Run it with `npm run package` (which builds the web app first). Windows only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const out = path.join(root, 'release')
const stage = path.join(out, 'stage', 'Cockpit')
const app = path.join(stage, 'app')
const zip = path.join(out, `Cockpit-${pkg.version}-win-x64.zip`)

if (process.platform !== 'win32') throw new Error('The release is built on Windows (it bundles node.exe)')
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) throw new Error('Build the web app first: npm run build')

const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(app, to), { recursive: true })
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })

fs.rmSync(path.join(out, 'stage'), { recursive: true, force: true })
fs.rmSync(zip, { force: true })
fs.mkdirSync(app, { recursive: true })

// the app
for (const p of ['server', 'web/dist', 'CHANGELOG.md', 'LICENSE', 'README.md', 'package.json', 'package-lock.json']) copy(p)
for (const p of ['open.vbs', 'start-hidden.vbs', 'install-startup.ps1', 'install-hotkey.ps1', 'claude-setup.mjs', 'hotkey/CockpitHotkey.cs']) copy(`scripts/${p}`)
copy('web/public/icons/cockpit.ico', 'cockpit.ico')

// only what the server needs at run time (the web app is already bundled)
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], app)
// what's only there for developers (source maps, type definitions, readmes): smaller, and shorter deepest paths
const prune = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) prune(full)
    else if (/\.(map|d\.ts|d\.mts|d\.cts|md|markdown)$/i.test(e.name) && !/^license/i.test(e.name)) fs.rmSync(full)
  }
}
prune(path.join(app, 'node_modules'))
// npm leaves an empty folder for each scope it skipped (@codemirror, @radix-ui...)
for (const d of fs.readdirSync(path.join(app, 'node_modules'))) {
  const full = path.join(app, 'node_modules', d)
  if (d.startsWith('@') && fs.readdirSync(full).length === 0) fs.rmdirSync(full)
}

// its own Node
fs.mkdirSync(path.join(stage, 'runtime'))
fs.copyFileSync(process.execPath, path.join(stage, 'runtime', 'node.exe'))

// the installer
for (const f of ['Install.cmd', 'install.ps1', 'Uninstall.cmd', 'uninstall.ps1']) fs.copyFileSync(path.join(root, 'scripts/package', f), path.join(stage, f))

run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -CompressionLevel Optimal`], root)
fs.rmSync(path.join(out, 'stage'), { recursive: true, force: true })
console.log(`\nBuilt ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB, Node ${process.version})`)

