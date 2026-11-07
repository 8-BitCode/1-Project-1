// Packs worker/entry.js (the P2P core) into src/p2p/worker.bundle.js, the same way the QVAC SDK packs
// its own worker: bare-pack with --linked addons for every mobile host. The native addons it needs
// (sodium, rocksdb, udx, ...) are the exact versions QVAC already links into react-native-bare-kit.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const barePack = join(dirname(require.resolve('bare-pack/package')), 'bin.js')
const imports = join(dirname(require.resolve('@qvac/sdk/package')), 'bare-imports.json')
const out = join(root, 'src', 'p2p', 'worker.bundle.js')
const hosts = ['android-arm64', 'ios-arm64', 'ios-arm64-simulator', 'ios-x64-simulator']

const args = [barePack, ...hosts.flatMap((h) => ['--host', h]), '--linked', '--imports', imports, '--out', out, join(root, 'worker', 'entry.js')]
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root })
if (r.status !== 0) process.exit(r.status || 1)

// Sanity check: every linked addon the worker needs must also be linked by QVAC (after prebuild).
const src = readFileSync(out, 'utf8')
const needed = [...new Set([...src.matchAll(/linked:(?:lib)?([a-z0-9@_.-]+?)\.(\d+\.\d+\.\d+)\.(?:so|framework)/gi)].map((m) => `${m[1]}.${m[2]}`))]
const linkedDir = join(root, 'node_modules', 'react-native-bare-kit', 'android', 'src', 'main', 'addons', 'arm64-v8a')
if (existsSync(linkedDir) && needed.length) {
  const have = new Set(readdirSync(linkedDir).map((f) => f.replace(/^lib/, '').replace(/\.so$/, '')))
  const missing = needed.filter((n) => !have.has(n))
  if (missing.length) console.warn('⚠ P2P worker needs addons QVAC did not link:', missing.join(', '))
  else console.log(`worker addons OK (${needed.length} shared with QVAC)`)
}
console.log('worker built:', (src.length / 1024).toFixed(0), 'KB')
