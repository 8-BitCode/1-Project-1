// End-to-end test of the P2P core with three "phones" on a local DHT testnet (no internet).
// Run: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')
const start = require('../worker/core.js')

// A fake worklet IPC pair: what the worker writes, the "app" reads, and vice versa.
function makeClient (bootstrap) {
  const toWorker = new EventEmitter()
  const fromWorker = new EventEmitter()
  const ipc = { on: (ev, fn) => toWorker.on(ev, fn), write: (buf) => fromWorker.emit('data', buf) }
  start(ipc, { bootstrap })
  let seq = 0
  let buf = ''
  const pending = new Map()
  const events = new EventEmitter()
  fromWorker.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
      if (msg.event) events.emit(msg.event, msg.data)
      else { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result) }
    }
  })
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject })
    toWorker.emit('data', Buffer.from(JSON.stringify({ id, method, params }) + '\n'))
  })
  return { call, events }
}

async function until (fn, label, ms = 30000) {
  const t = Date.now()
  if (process.env.DEBUG) console.error('… waiting:', label)
  while (Date.now() - t < ms) {
    const v = await fn()
    if (v) { if (process.env.DEBUG) console.error('✓', label, Date.now() - t + 'ms'); return v }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('timed out waiting for ' + label)
}

test('three phones: discover, match, chat, quest, meet, report', { timeout: 120000 }, async () => {
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const phones = ['ana', 'ben', 'cai'].map(() => makeClient(testnet.bootstrap))
  const [A, B, C] = phones
  const ids = []
  for (const [i, p] of phones.entries()) {
    if (process.env.DEBUG) p.events.on('log', (l) => console.error('  log', i, l))
    const me = await p.call('init', { storage: mkdtempSync(join(tmpdir(), 'campfire-')) })
    ids.push(me.id)
    await p.call('setProfile', { name: ['Ana', 'Ben', 'Cai'][i], bio: 'test', tags: ['climbing'], avatar: { hair: i }, embedding: [0.1, 0.2, 0.3], private: { prompt: 'secret answer' } })
    await p.call('joinCommunity', { name: 'test-uni' })
  }
  const [a, b, c] = ids

  // Discovery: everybody sees everybody's public profile; private answers are never in it.
  await until(async () => { const st = await A.call('stats'); if (process.env.DEBUG) console.error('  A stats', JSON.stringify(st)); return (await A.call('listPeers')).filter((p) => p.profile).length === 2 }, 'A sees 2 peers')
  await until(async () => (await B.call('listPeers')).filter((p) => p.profile).length === 2, 'B sees 2 peers')
  const seen = (await A.call('listPeers')).find((p) => p.id === b)
  assert.equal(seen.profile.name, 'Ben')
  assert.equal(JSON.stringify(seen.profile).includes('secret answer'), false)

  // Mutual wave -> match -> DM group created by the lower id, joined by the other.
  await A.call('wave', b)
  await B.call('wave', a)
  await until(async () => (await A.call('listMatches')).some((m) => m.id === b), 'A match')
  await until(async () => (await B.call('listMatches')).some((m) => m.id === a), 'B match')
  const dmKeyA = await until(async () => (await A.call('listGroups')).find((g) => g.kind === 'dm'), 'A has dm')
  await until(async () => (await B.call('listGroups')).find((g) => g.key === dmKeyA.key), 'B joined dm')
  await until(async () => (await A.call('listGroups')).find((g) => g.key === dmKeyA.key).writable &&
    (await B.call('listGroups')).find((g) => g.key === dmKeyA.key).writable, 'both writable')

  await A.call('sendMessage', [dmKeyA.key, { text: 'hey! climbing thursday?', lang: 'en' }])
  await B.call('sendMessage', [dmKeyA.key, { text: '¡sí! 7pm', lang: 'es' }])
  await until(async () => (await A.call('groupState', dmKeyA.key)).messages.length === 2, 'A sees 2 msgs')
  const stB = await until(async () => { const s = await B.call('groupState', dmKeyA.key); return s.messages.length === 2 && s }, 'B sees 2 msgs')
  assert.deepEqual(stB.messages.map((m) => m.text).sort(), ['hey! climbing thursday?', '¡sí! 7pm'].sort())

  // Quest + "we met" proof (signed QR payload verified by the other phone).
  const q = await A.call('addQuest', [dmKeyA.key, { title: 'Find the cheapest coffee near campus', detail: 'Rate it together' }])
  await until(async () => (await B.call('groupState', dmKeyA.key)).quests.length === 1, 'B sees quest')
  await B.call('completeQuest', [dmKeyA.key, q.questId])
  await until(async () => (await A.call('groupState', dmKeyA.key)).quests[0].done, 'quest done synced')
  const payload = await A.call('metPayload', dmKeyA.key)
  await B.call('verifyMet', payload)
  await assert.rejects(B.call('verifyMet', { ...payload, sig: payload.sig.replace(/^../, '00') }), /signature/)
  await until(async () => (await A.call('groupState', dmKeyA.key)).met.length === 1, 'A sees met proof')

  // Group of 3 created by Ana with Ben + Cai.
  const grp = await A.call('createGroup', { memberIds: [b, c], name: 'Climbing crew' })
  await until(async () => (await C.call('listGroups')).some((g) => g.key === grp.key), 'C joined group')
  await until(async () => (await C.call('listGroups')).find((g) => g.key === grp.key).writable, 'C writable')
  await C.call('sendMessage', [grp.key, { text: 'hi crew' }])
  await until(async () => (await B.call('groupState', grp.key)).messages.some((m) => m.text === 'hi crew'), 'B sees C in group')

  // Wingman: live message straight to the other phone.
  const got = new Promise((r) => B.events.once('wing', r))
  const sent = await A.call('sendWing', [b, { turn: 1, text: 'My human is shy but loves climbing', session: 's1' }])
  assert.equal(sent.delivered, true)
  assert.equal((await got).text, 'My human is shy but loves climbing')

  // Report + block: Cai reports Ben -> Cai no longer sees Ben; Ana sees 1 report against Ben.
  await C.call('report', [b, 'spam'])
  assert.equal((await C.call('listPeers')).some((p) => p.id === b), false)

  for (const p of phones) await p.call('close')
  await testnet.destroy()
})
