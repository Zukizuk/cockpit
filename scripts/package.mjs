// Builds the Windows release: release/Cockpit-<version>-win-x64.zip, which holds everything Cockpit needs to run,
// its own Node included, so the person installing it needs nothing else.
//
//   Cockpit/
//     Install.cmd, install.ps1        double-click to install (or update) for this user
//     Uninstall.cmd, uninstall.ps1    copied into the install folder too
//     app/                            the server (bundled: a few files, no node_modules), the built web app, the scripts
//     runtime/node.exe                the Node this was built with
//
// Run it with `npm run package` (which builds the web app first). Windows only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleServer } from './bundle-server.mjs'

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

// the app: the server bundled (see bundle-server.mjs), its data, the built web app
await bundleServer(app)
for (const p of ['server/data', 'web/dist', 'CHANGELOG.md', 'LICENSE', 'README.md', 'package.json']) copy(p)
for (const p of ['open.vbs', 'send-to.vbs', 'start-hidden.vbs', 'install-startup.ps1', 'install-hotkey.ps1', 'claude-setup.mjs', 'hotkey/CockpitHotkey.cs']) copy(`scripts/${p}`)
copy('web/public/icons/cockpit.ico', 'cockpit.ico')

// the bundle carries code from these packages: their licences go along in one file, as node_modules did
const deps = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8', shell: true })
  .split(/\r?\n/)
  .filter(d => d && path.resolve(d) !== root)
const notices = [...new Set(deps)].map(dir => {
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const file = fs.readdirSync(dir).find(f => /^(licen[sc]e|copying)(\.|$)/i.test(f))
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : 'No licence file in the package.'
  return `${p.name} ${p.version} (${p.license || 'see below'})\n\n${text}\n`
})
const rule = `\n${'-'.repeat(72)}\n\n`
fs.writeFileSync(path.join(app, 'THIRD-PARTY-LICENSES.txt'), `Cockpit's server includes code from these packages.\n\n${notices.join(rule)}`)


// its own Node
fs.mkdirSync(path.join(stage, 'runtime'))
fs.copyFileSync(process.execPath, path.join(stage, 'runtime', 'node.exe'))

// the installer
for (const f of ['Install.cmd', 'install.ps1', 'Uninstall.cmd', 'uninstall.ps1']) fs.copyFileSync(path.join(root, 'scripts/package', f), path.join(stage, f))

run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -CompressionLevel Optimal`], root)
fs.rmSync(path.join(out, 'stage'), { recursive: true, force: true })
console.log(`\nBuilt ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB, Node ${process.version})`)

