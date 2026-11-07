// Talks to the P2P worker (worker/core.js) running in its own Bare worklet thread.
// Newline-delimited JSON over the worklet IPC stream.
// The worker is packed by scripts/build-worker.mjs into worker.bundle.js (like QVAC packs its own worker).
import b4a from 'b4a'
import { Paths } from 'expo-file-system'
import { Worklet } from 'react-native-bare-kit'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WORKER_BUNDLE: string = require('./worker.bundle.js')

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }
type Handler = (data: any) => void

class P2PClient {
  private ipc: any = null
  private seq = 0
  private buf = ''
  private pending = new Map<number, Pending>()
  private handlers = new Map<string, Set<Handler>>()
  private starting: Promise<any> | null = null

  start() {
    if (this.starting) return this.starting
    this.starting = (async () => {
      const worklet = new Worklet()
      worklet.start('/campfire-p2p.bundle', WORKER_BUNDLE)
      const ipc = worklet.IPC
      this.ipc = ipc
      ipc.on('data', (d: unknown) => this.onData(d as Uint8Array))
      const storage = Paths.document.uri.replace(/^file:\/\//, '') + 'campfire-p2p'
      return this.call('init', { storage })
    })()
    return this.starting
  }

  private onData(d: Uint8Array) {
    this.buf += b4a.toString(d)
    let i
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      let msg: any
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.event) this.handlers.get(msg.event)?.forEach((h) => h(msg.data))
      else {
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result)
      }
    }
  }

  call<T = any>(method: string, params?: any): Promise<T> {
    if (!this.ipc) return Promise.reject(new Error('P2P worker not started'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ipc.write(b4a.from(JSON.stringify({ id, method, params }) + '\n'))
    })
  }

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(fn)
    return () => this.handlers.get(event)!.delete(fn)
  }
}

export const p2p = new P2PClient()
