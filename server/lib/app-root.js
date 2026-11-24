// The folder Cockpit's package.json is in: the repository when run from source, app\ when installed. Installed, the
// server is bundled into a few files and chunks, so a module's own location no longer says where the rest of the app
// is; everything that needs a file of the app's finds it from here.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function find() {
  const start = path.dirname(fileURLToPath(import.meta.url))
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    if (path.dirname(dir) === dir) throw new Error(`Cockpit's package.json is not in any folder above ${start}`)
  }
}

export const APP_ROOT = find()
/** A path inside the app, e.g. appPath('web', 'dist'). */
export const appPath = (...parts) => path.join(APP_ROOT, ...parts)
