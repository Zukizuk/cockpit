// Bundles the server for the release: a few files and chunks instead of node_modules' thousands, so the zip unzips
// and installs in seconds. Each entry keeps its path (Claude Code's settings point at server/mcp.js and
// server/claude/outputs-hook.js, and the installer and shortcuts at server/index.js); mammoth, xlsx and jszip stay
// in chunks of their own, loaded only when an Office file is opened.
//
//   node scripts/bundle-server.mjs <out dir>     (scripts/package.mjs runs it into the release's app folder)
import path from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function bundleServer(outDir) {
  const entries = ['server/index.js', 'server/mcp.js', 'server/claude/outputs-hook.js', 'server/lib/office-worker.js']
  await build({
    cwd: root,
    input: Object.fromEntries(entries.map(e => [e.replace(/\.js$/, ''), path.join(root, e)])),
    platform: 'node',
    external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)],
    logLevel: 'warn',
    output: {
      dir: outDir,
      format: 'esm',
      entryFileNames: '[name].js',
      chunkFileNames: 'server/chunks/[name]-[hash].js',
      minify: false,
      sourcemap: false,
    },
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] || path.join(root, 'release', 'bundle'))
  await bundleServer(out)
  console.log(`Bundled the server into ${out}`)
}
