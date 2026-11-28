// The Mac launcher (scripts/mac): Cockpit.app, starting the server, the login start and npm run setup:mac. Mac only;
// everything runs in a temporary folder, with a stand-in for launchctl, so nothing is added to this Mac's apps or
// login items.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const mac = process.platform === 'darwin'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scripts = path.join(root, 'scripts', 'mac')
// a space in the path, as in "Application Support"
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit mac-'))
after(() => fs.rmSync(T, { recursive: true, force: true }))
const run = (file, args = [], env = {}) =>
  spawnSync('/bin/bash', [file, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 })
const bash = (script, args, env) => run(path.join(scripts, script), args, env)
// what the Dock and login items start with: no Homebrew, nvm or Node on the PATH
const BARE = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/usr/bin/false' }
const plistValue = (plist, key) => spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).stdout.trim()
const freePort = () =>
  new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const health = port => fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json()).catch(() => null)
const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await check()
    if (v || Date.now() > end) return v
    await new Promise(r => setTimeout(r, 150))
  }
}
const fakeLaunchctl = (name, script = 'exit 0') => {
  const calls = path.join(T, `${name} calls`)
  const fake = path.join(T, name)
  fs.writeFileSync(fake, `#!/bin/bash\necho "$*" >> '${calls}'\n${script}\n`, { mode: 0o755 })
  return { fake, calls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []) }
}

test('Cockpit.app: a valid app with the icon and version, which runs the launcher it was made for', { skip: !mac }, () => {
  const marker = path.join(T, 'opened')
  const launcher = path.join(T, 'my open.sh')
  fs.writeFileSync(launcher, `printf '%s' "$COCKPIT_NODE" > '${marker}'\n`)
  const app = path.join(T, 'Applications', 'Cockpit.app')
  fs.mkdirSync(path.dirname(app))

  const made = bash('make-app.sh', [app, launcher, '/opt/my node/bin/node'])
  assert.equal(made.status, 0, made.stderr)
  const plist = path.join(app, 'Contents', 'Info.plist')
  assert.equal(spawnSync('plutil', ['-lint', plist]).status, 0, 'Info.plist is valid')
  assert.equal(plistValue(plist, 'CFBundleExecutable'), 'Cockpit')
  assert.equal(plistValue(plist, 'CFBundleIdentifier'), 'com.zukizuk.cockpit')
  assert.equal(plistValue(plist, 'CFBundleShortVersionString'), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version)
  assert.equal(plistValue(plist, 'LSUIElement'), 'true', 'it opens the window and quits, so it stays out of the Dock and app switcher')
  assert.ok(fs.statSync(path.join(app, 'Contents', 'Resources', 'cockpit.icns')).size > 1000, 'an icon')

  const program = path.join(app, 'Contents', 'MacOS', 'Cockpit')
  assert.ok(fs.statSync(program).mode & 0o111, 'its program can run')
  assert.equal(spawnSync(program, { env: BARE }).status, 0)
  assert.equal(fs.readFileSync(marker, 'utf8'), '/opt/my node/bin/node', 'it ran the launcher (a path with a space) with the Node it was given')

  // made again over the old one: replaced, not nested, and nothing left beside it
  assert.equal(bash('make-app.sh', [app, launcher]).status, 0)
  assert.deepEqual(fs.readdirSync(app), ['Contents'])
  assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Cockpit.app'])
})

test('Cockpit.app: a second copy is an app of its own, and a failed build keeps the old app', { skip: !mac }, () => {
  const dir = path.join(T, 'Apps two')
  fs.mkdirSync(dir)
  const dev = path.join(dir, 'Cockpit (dev).app')
  assert.equal(bash('make-app.sh', [dev, '/x/open.sh']).status, 0)
  const plist = path.join(dev, 'Contents', 'Info.plist')
  assert.equal(spawnSync('plutil', ['-lint', plist]).status, 0)
  assert.equal(plistValue(plist, 'CFBundleDisplayName'), 'Cockpit (dev)')
  assert.equal(plistValue(plist, 'CFBundleIdentifier'), 'com.zukizuk.cockpit.cockpit-dev', 'not the same app twice to macOS')

  // sips fails part-way: the app that was there is untouched, and no half-built one is left
  const bin = path.join(T, 'failing sips')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'sips'), '#!/bin/bash\nexit 3\n', { mode: 0o755 })
  const before = fs.readFileSync(path.join(dev, 'Contents', 'MacOS', 'Cockpit'), 'utf8')
  const failed = bash('make-app.sh', [dev, '/y/open.sh'], { PATH: `${bin}:${process.env.PATH}` })
  assert.notEqual(failed.status, 0)
  assert.equal(fs.readFileSync(path.join(dev, 'Contents', 'MacOS', 'Cockpit'), 'utf8'), before)
  assert.deepEqual(fs.readdirSync(dir), ['Cockpit (dev).app'])

  // only ever an .app is replaced
  const notApp = bash('make-app.sh', [path.join(T, 'Apps two'), '/x/open.sh'])
  assert.notEqual(notApp.status, 0)
  assert.ok(fs.existsSync(dev), 'the folder given was left alone')
})

test('start.sh: starts the server with the Node it was given, though the PATH is bare, and only once', { skip: !mac }, async () => {
  const port = await freePort()
  const home = path.join(T, 'start')
  const data = path.join(home, '.cockpit')
  const env = { ...BARE, COCKPIT_NODE: process.execPath, COCKPIT_PORT: String(port), COCKPIT_HOME: home, COCKPIT_DATA: data }
  try {
    const first = bash('start.sh', [], env)
    assert.equal(first.status, 0, first.stderr)
    const up = await until(() => health(port))
    assert.equal(up?.app, 'cockpit', 'the server answers')

    const second = bash('start.sh', [], env)
    assert.equal(second.status, 0, second.stderr)
    await new Promise(r => setTimeout(r, 1500))
    assert.equal((await health(port))?.pid, up.pid, 'still the first server')
    assert.doesNotMatch(fs.readFileSync(path.join(data, 'server.log'), 'utf8'), /already running/, 'no second copy was started')
  } finally {
    // whatever listens on the port is this test's server, even if the checks above failed
    const pids = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
    for (const pid of pids) process.kill(Number(pid))
  }
})

test('start.sh: with no Node anywhere, it says so and fails', { skip: !mac }, () => {
  const r = bash('start.sh', [], { ...BARE, COCKPIT_NODE: '', COCKPIT_PORT: '9' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /needs Node 20 or later/)
})

test('the login start: a LaunchAgent that runs start.sh --foreground, added and removed with launchctl', { skip: !mac }, () => {
  const home = path.join(T, 'login')
  const launchctl = fakeLaunchctl('launchctl')
  const env = { HOME: home, COCKPIT_LAUNCHCTL: launchctl.fake, COCKPIT_NODE: '/opt/a&b/node' }
  const plist = path.join(home, 'Library', 'LaunchAgents', 'com.zukizuk.cockpit.server.plist')

  const added = bash('install-startup.sh', [], env)
  assert.equal(added.status, 0, added.stderr)
  assert.equal(spawnSync('plutil', ['-lint', plist]).status, 0, 'the LaunchAgent is valid')
  const args = JSON.parse(spawnSync('plutil', ['-extract', 'ProgramArguments', 'json', '-o', '-', plist], { encoding: 'utf8' }).stdout)
  assert.deepEqual(args, ['/bin/bash', path.join(scripts, 'start.sh'), '--foreground'])
  assert.equal(plistValue(plist, 'EnvironmentVariables:COCKPIT_NODE'), '/opt/a&b/node', 'the same Node at login')
  const uid = process.getuid()
  assert.deepEqual(launchctl.calls(), [
    `bootout gui/${uid}/com.zukizuk.cockpit.server`,
    `bootstrap gui/${uid} ${plist}`,
  ], 'an older one is taken out, then this one is started')

  const removed = bash('install-startup.sh', ['--remove'], env)
  assert.equal(removed.status, 0)
  assert.match(removed.stdout, /Removed/)
  assert.ok(!fs.existsSync(plist))
  assert.match(launchctl.calls().at(-1), /^bootout /)
  assert.match(bash('install-startup.sh', ['--remove'], env).stdout, /No Cockpit login start/)
})

test("the login start: when launchctl refuses, it says launchctl's reason", { skip: !mac }, () => {
  const launchctl = fakeLaunchctl('refusing launchctl', '[ "$1" = bootstrap ] && { echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; }; exit 0')
  const r = bash('install-startup.sh', [], { HOME: path.join(T, 'refused'), COCKPIT_LAUNCHCTL: launchctl.fake })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Couldn't add the login start .*Input\/output error/)
  assert.equal(launchctl.calls().filter(c => c.startsWith('bootstrap')).length, 5, 'tried a few times first')
})

test('npm run setup:mac: Cockpit.app for this clone, run again in place; an installed Cockpit.app is left alone', { skip: !mac }, () => {
  // a clone whose path has a space, as ~/My Projects/cockpit would
  const clone = path.join(T, 'my clone')
  for (const f of ['package.json', 'web/public/icons/icon-512.png', ...fs.readdirSync(scripts).map(f => `scripts/mac/${f}`)]) {
    fs.mkdirSync(path.dirname(path.join(clone, f)), { recursive: true })
    fs.copyFileSync(path.join(root, f), path.join(clone, f))
  }
  const home = path.join(T, 'setup home')
  const apps = path.join(home, 'Applications')
  const launchctl = fakeLaunchctl('setup launchctl')
  const setup = () => run(path.join(clone, 'scripts', 'mac', 'setup-dev.sh'), ['--claude', 'no'], { HOME: home, COCKPIT_LAUNCHCTL: launchctl.fake })

  let r = setup()
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(fs.readdirSync(apps), ['Cockpit.app'])
  assert.match(fs.readFileSync(path.join(apps, 'Cockpit.app', 'Contents', 'MacOS', 'Cockpit'), 'utf8'), /my\\ clone\/scripts\/mac\/open\.sh/)
  assert.ok(launchctl.calls().some(c => c.startsWith('bootstrap ')), 'the login start was added')

  r = setup()
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(fs.readdirSync(apps), ['Cockpit.app'], 'run again: the same app, updated')

  // another Cockpit.app (an installed one) is there: this clone's is Cockpit (dev)
  fs.rmSync(path.join(apps, 'Cockpit.app'), { recursive: true })
  assert.equal(bash('make-app.sh', [path.join(apps, 'Cockpit.app'), '/Applications/elsewhere/open.sh']).status, 0)
  const installed = fs.readFileSync(path.join(apps, 'Cockpit.app', 'Contents', 'MacOS', 'Cockpit'), 'utf8')
  r = setup()
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(fs.readdirSync(apps).sort(), ['Cockpit (dev).app', 'Cockpit.app'])
  assert.equal(fs.readFileSync(path.join(apps, 'Cockpit.app', 'Contents', 'MacOS', 'Cockpit'), 'utf8'), installed, 'the installed app is untouched')
})
