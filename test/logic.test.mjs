// Unit tests for matching, grouping and safety logic. Uses Node's built-in TypeScript type stripping.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as L from '../src/ai/logic.ts'

const me = { name: 'Wei', tags: ['climbing', 'music', 'cooking'], lookingFor: ['gym buddy'], embedding: [1, 0, 0.2], course: 'CS', lang: 'zh' }
const peers = [
  { id: 'a', profile: { name: 'Ana', tags: ['climbing', 'music'], lookingFor: ['gym buddy'], embedding: [0.9, 0.1, 0.2], course: 'CS' } },
  { id: 'b', profile: { name: 'Ben', tags: ['football'], embedding: [0, 1, 0] } },
  { id: 'c', profile: { name: 'Cai', tags: ['cooking', 'climbing'], embedding: [0.8, 0.2, 0.3], lang: 'zh' } },
  { id: 'd', profile: { name: 'Dee', tags: ['music'], embedding: [0.7, 0.3, 0.1] } },
  { id: 'e', profile: null },
]

test('cosine', () => {
  assert.equal(L.cosine([1, 0], [1, 0]), 1)
  assert.equal(L.cosine([1, 0], [0, 1]), 0)
  assert.equal(L.cosine(null, [1]), 0)
})

test('ranking prefers shared interests and vibe', () => {
  const r = L.rankPeers(me, peers)
  assert.equal(r.length, 4)
  assert.equal(r[0].peer.id, 'a')
  assert.equal(r[r.length - 1].peer.id, 'b')
  assert.ok(r[0].reasons.some((x) => x.includes('climbing')))
})

test('groups of 4 avoid the odd one out', () => {
  const g = L.formGroup(me, peers, 4)
  assert.equal(g.length, 3)
  assert.ok(!g.some((p) => p.id === 'b' && g.length < 3))
  assert.ok(g.some((p) => p.id === 'a'))
})

test('safety thresholds', () => {
  assert.equal(L.verdictFrom('harassment', 0.95, 0).action, 'hide')
  assert.equal(L.verdictFrom('harassment', 0.6, 0).action, 'warn')
  assert.equal(L.verdictFrom('friendly', 0.99, 0).action, 'allow')
  assert.equal(L.verdictFrom('neutral', 0.9, 0.8).action, 'warn')
  const sh = L.verdictFrom('self-harm', 0.7, 0)
  assert.equal(sh.support, true)
  assert.equal(L.fallbackSafety('send me your bank details').action, 'hide')
  assert.equal(L.fallbackSafety('fancy climbing thursday?').action, 'allow')
  assert.equal(L.fallbackSafety('i want to die').support, true)
})

test('onboarding fallbacks', () => {
  assert.deepEqual(L.fallbackTags('I love bouldering and lo-fi music, always cooking ramen'), ['climbing', 'music', 'cooking'])
  assert.equal(L.avatarHints("I'm always cold, fav colour green").extra, 4)
  assert.equal(L.avatarHints("I'm always cold, fav colour green").shirt, 3)
  assert.equal(L.fallbackQuest(['climbing']).title, 'Beginner bouldering session')
})
