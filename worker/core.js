/* Campfire P2P core.
 *
 * Runs inside a Bare worklet on the phone (react-native-bare-kit / expo-bare-kit) and also
 * under Node for tests. There is no server anywhere: every phone is a peer.
 *
 * Building blocks (Pears / Holepunch stack):
 *   - Corestore   : storage for every core on this device
 *   - Hypercore   : my public "feed" (profile, waves, invites, reports). Its public key IS my identity.
 *   - Hyperbee    : key/value view over my feed and over my private local data
 *   - Hyperswarm  : finds peers on the community topic (from the QR invite) and on each group topic
 *   - Protomux    : a tiny "campfire/hello" channel on each connection (feed key exchange + wingman messages)
 *   - Autobase    : multi-writer group chat log (messages, quests, meet-up proofs)
 *
 * UI <-> worker protocol: newline-delimited JSON over the worklet IPC stream.
 *   request  { id, method, params }      -> response { id, result } | { id, error }
 *   event    { event, data }             (pushed by the worker)
 */
'use strict'

const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const Hyperbee = require('hyperbee')
const Autobase = require('autobase')
const Protomux = require('protomux')
const c = require('compact-encoding')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const PROTOCOL = 'campfire/hello/v1'
const MAX_GROUP = 4
const REPORT_HIDE_THRESHOLD = 3
const REMOTE = { timeout: 4000 } // remote reads: wait for the block, but never forever

const hex = (buf) => b4a.toString(buf, 'hex')
const unhex = (str) => b4a.from(str, 'hex')
const now = () => Date.now()
const topicFor = (name) => crypto.hash(b4a.from('campfire:community:' + name))

function bee (core) {
  return new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
}

class CampfireCore {
  constructor (opts) {
    this.storage = opts.storage
    this.bootstrap = opts.bootstrap // only used by tests (local DHT testnet)
    this.emit = opts.emit || (() => {})
    this.store = null
    this.swarm = null
    this.feed = null // my public Hyperbee
    this.local = null // my private Hyperbee (never replicated)
    this.me = null // hex id
    this.peers = new Map() // id -> { id, feed (Hyperbee), profile, online, channel }
    this.groups = new Map() // groupKey hex -> { base, name, members }
    this.channels = new Set()
    this.community = null
  }

  async ready () {
    this.store = new Corestore(this.storage)
    await this.store.ready()

    const feedCore = this.store.get({ name: 'public-feed' })
    await feedCore.ready()
    this.feedCore = feedCore
    this.feed = bee(feedCore)
    await this.feed.ready()
    this.me = hex(feedCore.key)
    // Hypercore keys are derived from a manifest, so publish the raw signing key in the (signed) feed.
    // Others use it to check "we met" QR proofs.
    this.signingKey = hex(feedCore.keyPair.publicKey)
    if (!(await this.feed.get('pk'))) await this.feed.put('pk', { key: this.signingKey })

    // The private store is a separate namespace and is never announced or shared with anyone.
    this.local = bee(this.store.namespace('private').get({ name: 'local' }))
    await this.local.ready()

    if (this.bootstrap) {
      // Tests: a local DHT testnet bound to loopback (no internet needed).
      const DHT = require('hyperdht')
      this.swarm = new Hyperswarm({ dht: new DHT({ bootstrap: this.bootstrap, host: '127.0.0.1' }) })
    } else {
      this.swarm = new Hyperswarm()
    }
    this.swarm.on('connection', (conn, info) => this._onConnection(conn, info))

    // Rejoin everything we knew about last time.
    for await (const { value } of this.local.createReadStream({ gt: 'peer/', lt: 'peer/~' })) {
      await this._trackPeer(value.id).catch(() => {})
    }
    for await (const { value } of this.local.createReadStream({ gt: 'group/', lt: 'group/~' })) {
      await this._openGroup(value.key, value).catch((e) => this.emit('log', 'group reopen failed ' + e.message))
    }
    const community = await this._localGet('community')
    if (community) await this.joinCommunity(community)
    return this.getMe()
  }

  // ---------------------------------------------------------------- identity / profile
  async getMe () {
    const profile = await this._feedGet('profile')
    return { id: this.me, profile, community: this.community ? this.community.name : null }
  }

  /** Public profile: avatar, display name, bio, tags, language, embedding. Private prompt answers stay in `local`. */
  async setProfile (profile) {
    const safe = {
      name: String(profile.name || '').slice(0, 24),
      avatar: profile.avatar || null, // avatar config (small JSON)
      png: typeof profile.png === 'string' && profile.png.length < 20000 ? profile.png : null,
      bio: String(profile.bio || '').slice(0, 200),
      tags: (profile.tags || []).slice(0, 8).map((t) => String(t).slice(0, 24)),
      lookingFor: (profile.lookingFor || []).slice(0, 4).map((t) => String(t).slice(0, 40)),
      course: String(profile.course || '').slice(0, 40),
      city: String(profile.city || '').slice(0, 40),
      links: (profile.links || []).slice(0, 3).map((t) => String(t).slice(0, 80)),
      lang: String(profile.lang || 'en').slice(0, 5),
      embedding: Array.isArray(profile.embedding) ? profile.embedding.slice(0, 1024).map((x) => Math.round(x * 1e4) / 1e4) : null,
      invitedBy: profile.invitedBy || (await this._localGet('invitedBy')) || null,
      updatedAt: now()
    }
    await this.feed.put('profile', safe)
    if (profile.private) await this.local.put('private-profile', profile.private)
    return safe
  }

  async getPrivate () {
    return (await this._localGet('private-profile')) || {}
  }

  // ---------------------------------------------------------------- community + discovery
  /** Join the community swarm. `name` comes from the invite QR (e.g. "uom-campfire-2026"). */
  async joinCommunity (opts) {
    const name = typeof opts === 'string' ? opts : opts.name
    if (opts && opts.invitedBy) await this.local.put('invitedBy', opts.invitedBy)
    if (this.community && this.community.name === name) return { name }
    if (this.community) await this.community.discovery.destroy().catch(() => {})
    const topic = topicFor(name)
    const discovery = this.swarm.join(topic, { server: true, client: true })
    this.community = { name, topic, discovery }
    await this.local.put('community', { name })
    discovery.flushed().then(() => this.emit('status', { community: name, flushed: true })).catch(() => {})
    return { name }
  }

  inviteLink () {
    if (!this.community) throw new Error('join a community first')
    return 'campfire://join?c=' + encodeURIComponent(this.community.name) + '&by=' + this.me
  }

  _onConnection (conn, info) {
    conn.on('error', () => {})
    this.store.replicate(conn)
    const mux = Protomux.from(conn)
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      onopen: () => {},
      onclose: () => { this.channels.delete(channel); this._markOffline(channel) }
    })
    if (!channel) return
    channel.remoteId = null
    channel.hello = channel.addMessage({
      encoding: c.json,
      onmessage: (m) => this._onHello(channel, m).catch((e) => this.emit('log', 'hello error ' + e.message))
    })
    channel.wing = channel.addMessage({
      encoding: c.json,
      onmessage: (m) => this._onWing(channel, m)
    })
    channel.open()
    channel.hello.send({ id: this.me, groups: [...this.groups.keys()] })
    this.channels.add(channel)
  }

  async _onHello (channel, m) {
    if (!m || typeof m.id !== 'string' || m.id.length !== 64 || m.id === this.me) return
    channel.remoteId = m.id
    if (await this.isBlocked(m.id)) return
    await this._trackPeer(m.id)
    const p = this.peers.get(m.id)
    if (p) { p.online = true; p.channel = channel; this._emitPeer(p) }
  }

  _markOffline (channel) {
    const p = channel.remoteId && this.peers.get(channel.remoteId)
    if (p && p.channel === channel) { p.online = false; p.channel = null; this._emitPeer(p) }
  }

  async _trackPeer (id) {
    if (this.peers.has(id)) return this.peers.get(id)
    const core = this.store.get({ key: unhex(id) })
    await core.ready()
    const feed = bee(core)
    await feed.ready()
    const peer = { id, feed, core, profile: null, online: false, channel: null }
    this.peers.set(id, peer)
    await this.local.put('peer/' + id, { id, firstSeen: now() })
    const refresh = () => this._refreshPeer(peer).catch((e) => { if (!this.closing) this.emit('log', 'refresh ' + e.message) })
    core.on('append', refresh)
    core.on('peer-add', refresh)
    refresh()
    return peer
  }

  async _refreshPeer (peer) {
    await peer.core.update(REMOTE).catch(() => {})
    const node = await peer.feed.get('profile', REMOTE).catch(() => null)
    if (node) peer.profile = node.value
    this._emitPeer(peer)
    await this._checkInbox(peer)
  }

  _emitPeer (peer) {
    this.emit('peer', this._peerView(peer))
  }

  _peerView (peer) {
    return { id: peer.id, online: peer.online, profile: peer.profile }
  }

  async listPeers () {
    const blocked = new Set(await this._listKeys('block/'))
    const reports = await this.reportCounts()
    const out = []
    for (const p of this.peers.values()) {
      if (!p.profile || blocked.has(p.id)) continue
      if ((reports[p.id] || 0) >= REPORT_HIDE_THRESHOLD) continue
      out.push(this._peerView(p))
    }
    return out
  }

  // ---------------------------------------------------------------- waves -> matches -> groups
  /**
   * A "wave" is written to MY public feed (so it works even if they're offline right now).
   * When both people have waved at each other it's a match; the person with the smaller id
   * creates the group chat and writes an invite to their feed.
   */
  async wave (peerId, note) {
    await this.feed.put('wave/' + peerId, { ts: now(), note: note ? String(note).slice(0, 140) : null })
    const peer = await this._trackPeer(peerId)
    await this._checkInbox(peer)
    return { waved: true }
  }

  async _hasWaved (peer, toId) {
    const n = await peer.feed.get('wave/' + toId, REMOTE).catch(() => null)
    return !!n
  }

  async _checkInbox (peer) {
    if (await this.isBlocked(peer.id)) return
    const iWaved = !!(await this.feed.get('wave/' + peer.id))
    const theyWaved = await this._hasWaved(peer, this.me)
    if (theyWaved && !iWaved) this.emit('waved-at', { from: peer.id, profile: peer.profile })
    if (iWaved && theyWaved) {
      const existing = await this._localGet('match/' + peer.id)
      if (!existing) {
        await this.local.put('match/' + peer.id, { id: peer.id, ts: now() })
        this.emit('match', { id: peer.id, profile: peer.profile })
      }
      if (this.me < peer.id && !(await this.feed.get('dm/' + peer.id))) {
        const g = await this.createGroup({ memberIds: [peer.id], name: 'You + ' + ((peer.profile && peer.profile.name) || 'friend'), kind: 'dm' })
        await this.feed.put('dm/' + peer.id, { key: g.key })
      }
    }
    // Invites addressed to me (group chats someone added me to).
    const invite = await peer.feed.get('invite/' + this.me, REMOTE).catch(() => null)
    if (invite && invite.value) {
      for (const g of invite.value.groups || []) {
        if (!this.groups.has(g.key)) await this.joinGroup(g.key, { name: g.name, kind: g.kind, owner: peer.id })
      }
    }
    // Join requests addressed to groups I own: add their writer key.
    for (const [key, g] of this.groups) {
      if (g.owner !== this.me) continue
      const req = await peer.feed.get('join/' + key, REMOTE).catch(() => null)
      if (req && req.value && g.members.includes(peer.id)) {
        const added = await this._localGet('added/' + key + '/' + req.value.writer)
        if (!added) {
          await g.base.append({ type: 'add-writer', key: req.value.writer, id: peer.id, ts: now() })
          await this.local.put('added/' + key + '/' + req.value.writer, { ts: now() })
        }
      }
    }
  }

  async listMatches () {
    const out = []
    for await (const { value } of this.local.createReadStream({ gt: 'match/', lt: 'match/~' })) {
      const p = this.peers.get(value.id)
      out.push({ id: value.id, ts: value.ts, profile: p ? p.profile : null, online: p ? p.online : false })
    }
    return out
  }

  // ---------------------------------------------------------------- groups (Autobase)
  _baseOpts () {
    return {
      valueEncoding: 'json',
      ackInterval: 1000,
      open: (store) => bee(store.get('view')),
      apply: async (nodes, view, host) => {
        for (const { value } of nodes) {
          if (!value || typeof value !== 'object') continue
          if (value.type === 'add-writer' && typeof value.key === 'string') {
            await host.addWriter(unhex(value.key), { indexer: true })
            await view.put('member/' + value.id, { id: value.id, ts: value.ts })
            continue
          }
          if (value.type === 'msg') await view.put('msg/' + String(value.ts).padStart(15, '0') + '/' + value.from, value)
          else if (value.type === 'quest') await view.put('quest/' + value.questId, value)
          else if (value.type === 'quest-done') {
            const q = await view.get('quest/' + value.questId)
            if (q) await view.put('quest/' + value.questId, Object.assign({}, q.value, { done: true, doneBy: value.from, doneTs: value.ts }))
          } else if (value.type === 'met') await view.put('met/' + [value.a, value.b].sort().join('-'), value)
          else if (value.type === 'meta') await view.put('meta', value)
        }
      }
    }
  }

  async createGroup ({ memberIds, name, kind }) {
    const members = [...new Set(memberIds)].filter((m) => m !== this.me).slice(0, MAX_GROUP - 1)
    const ns = 'group-' + hex(crypto.randomBytes(8))
    const base = new Autobase(this.store.namespace(ns), null, this._baseOpts())
    await base.ready()
    const key = hex(base.key)
    const meta = { key, ns, name: name || 'Campfire group', kind: kind || 'group', owner: this.me, members: [this.me, ...members], ts: now() }
    await base.append({ type: 'meta', name: meta.name, kind: meta.kind, owner: this.me, members: meta.members, ts: meta.ts })
    await this.local.put('group/' + key, meta)
    this._attachGroup(base, meta)
    // Invite each member through my public feed.
    for (const id of members) {
      const prev = await this.feed.get('invite/' + id)
      const groups = (prev ? prev.value.groups : []).filter((g) => g.key !== key)
      groups.push({ key, name: meta.name, kind: meta.kind })
      await this.feed.put('invite/' + id, { groups })
    }
    this.emit('group', this._groupView(key))
    return { key }
  }

  async joinGroup (key, info) {
    if (this.groups.has(key)) return { key }
    const ns = 'group-join-' + key.slice(0, 16)
    const meta = { key, ns, name: (info && info.name) || 'Campfire group', kind: (info && info.kind) || 'group', owner: (info && info.owner) || null, members: [], ts: now() }
    await this.local.put('group/' + key, meta)
    const base = new Autobase(this.store.namespace(ns), unhex(key), this._baseOpts())
    await base.ready()
    this._attachGroup(base, meta)
    // Ask the owner to add my writer key (they read this from my feed).
    await this.feed.put('join/' + key, { writer: hex(base.local.key), ts: now() })
    this.emit('group', this._groupView(key))
    return { key }
  }

  async _openGroup (key, meta) {
    const base = new Autobase(this.store.namespace(meta.ns), meta.owner === this.me ? null : unhex(key), this._baseOpts())
    await base.ready()
    this._attachGroup(base, meta)
  }

  _attachGroup (base, meta) {
    const g = { base, key: meta.key, name: meta.name, kind: meta.kind, owner: meta.owner, members: meta.members || [], discovery: null }
    this.groups.set(meta.key, g)
    g.discovery = this.swarm.join(base.discoveryKey, { server: true, client: true })
    base.on('update', () => this._onGroupUpdate(g).catch(() => {}))
    base.on('error', (e) => this.emit('log', 'autobase ' + e.message))
    this._onGroupUpdate(g).catch(() => {})
  }

  async _onGroupUpdate (g) {
    const metaNode = await g.base.view.get('meta').catch(() => null)
    if (metaNode && metaNode.value) {
      g.name = metaNode.value.name; g.kind = metaNode.value.kind; g.owner = metaNode.value.owner; g.members = metaNode.value.members || g.members
      const stored = await this._localGet('group/' + g.key)
      if (stored && (stored.owner !== g.owner || stored.members.length !== g.members.length)) {
        await this.local.put('group/' + g.key, Object.assign({}, stored, { owner: g.owner, members: g.members, name: g.name, kind: g.kind }))
      }
      for (const id of g.members) if (id !== this.me) this._trackPeer(id).catch(() => {})
    }
    this.emit('group-update', { key: g.key, writable: g.base.writable })
  }

  _groupView (key) {
    const g = this.groups.get(key)
    if (!g) return null
    return { key, name: g.name, kind: g.kind, owner: g.owner, members: g.members, writable: g.base.writable }
  }

  async listGroups () {
    return [...this.groups.keys()].map((k) => this._groupView(k))
  }

  async groupState (key, opts) {
    const g = this._group(key)
    await g.base.update().catch(() => {})
    const limit = (opts && opts.limit) || 100
    const messages = []
    for await (const { value } of g.base.view.createReadStream({ gt: 'msg/', lt: 'msg/~', reverse: true, limit })) messages.unshift(value)
    const quests = []
    for await (const { value } of g.base.view.createReadStream({ gt: 'quest/', lt: 'quest/~' })) quests.push(value)
    const met = []
    for await (const { value } of g.base.view.createReadStream({ gt: 'met/', lt: 'met/~' })) met.push(value)
    return { group: this._groupView(key), messages, quests, met }
  }

  async sendMessage (key, msg) {
    const g = this._group(key)
    if (!g.base.writable) throw new Error('Waiting to be added to this group. Stay online for a moment.')
    const value = {
      type: 'msg', from: this.me, ts: now(),
      text: String(msg.text || '').slice(0, 1000),
      lang: msg.lang || 'en',
      // Optional on-device safety verdict from the sender (receivers run their own filter too).
      safety: msg.safety || null,
      kind: msg.kind || 'text'
    }
    await g.base.append(value)
    return value
  }

  async addQuest (key, quest) {
    const g = this._group(key)
    const value = { type: 'quest', questId: hex(crypto.randomBytes(6)), from: this.me, ts: now(), title: String(quest.title || '').slice(0, 120), detail: String(quest.detail || '').slice(0, 400), where: quest.where || null, when: quest.when || null, done: false }
    await g.base.append(value)
    return value
  }

  async completeQuest (key, questId) {
    const g = this._group(key)
    await g.base.append({ type: 'quest-done', questId, from: this.me, ts: now() })
    return { ok: true }
  }

  _group (key) {
    const g = this.groups.get(key)
    if (!g) throw new Error('unknown group')
    return g
  }

  // ---------------------------------------------------------------- "we actually met" proof (QR tap)
  /** Payload shown as a QR. Signed with my feed's secret key so nobody can fake it. */
  metPayload (key) {
    const ts = now()
    const msg = b4a.from(['campfire-met', key, this.me, ts].join(':'))
    const sig = crypto.sign(msg, this.feedCore.keyPair.secretKey)
    return { k: key, id: this.me, pk: this.signingKey, ts, sig: hex(sig) }
  }

  async verifyMet (payload) {
    if (!payload || !payload.id || !payload.sig || !payload.k) throw new Error('bad payload')
    if (Math.abs(now() - payload.ts) > 10 * 60 * 1000) throw new Error('QR expired, ask them to refresh it')
    const msg = b4a.from(['campfire-met', payload.k, payload.id, payload.ts].join(':'))
    const peer = await this._trackPeer(payload.id)
    const pkNode = await peer.feed.get('pk', REMOTE).catch(() => null)
    if (!pkNode || pkNode.value.key !== payload.pk) throw new Error('signature check failed (unknown key)')
    if (!crypto.verify(msg, unhex(payload.sig), unhex(payload.pk))) throw new Error('signature check failed')
    const g = this._group(payload.k)
    const value = { type: 'met', a: this.me, b: payload.id, ts: now(), proof: payload }
    await g.base.append(value)
    return value
  }

  // ---------------------------------------------------------------- wingman (avatar-to-avatar chat)
  /** Live wingman messages go straight to the other phone over the encrypted connection. */
  sendWing (peerId, payload) {
    const p = this.peers.get(peerId)
    if (!p || !p.channel) return { delivered: false }
    p.channel.wing.send({ from: this.me, to: peerId, turn: payload.turn | 0, text: String(payload.text || '').slice(0, 400), session: payload.session })
    return { delivered: true }
  }

  _onWing (channel, m) {
    if (!m || m.to !== this.me || !channel.remoteId || m.from !== channel.remoteId) return
    this.isBlocked(m.from).then((b) => { if (!b) this.emit('wing', m) })
  }

  // ---------------------------------------------------------------- safety
  async block (id) { await this.local.put('block/' + id, { ts: now() }); return { ok: true } }
  async unblock (id) { await this.local.del('block/' + id); return { ok: true } }
  async isBlocked (id) { return !!(await this._localGet('block/' + id)) }
  async listBlocked () { return this._listKeys('block/') }

  /** Reports are public, signed (they live in the reporter's feed), and counted per distinct reporter. */
  async report (id, reason) {
    await this.feed.put('report/' + id, { reason: String(reason || '').slice(0, 200), ts: now() })
    await this.block(id)
    return { ok: true }
  }

  async reportCounts () {
    const counts = {}
    const feeds = [this.feed, ...[...this.peers.values()].map((p) => p.feed)]
    for (const f of feeds) {
      for await (const { key } of f.createReadStream({ gt: 'report/', lt: 'report/~' }).on('error', () => {})) {
        const target = key.slice('report/'.length)
        counts[target] = (counts[target] || 0) + 1
      }
    }
    return counts
  }

  // ---------------------------------------------------------------- misc
  stats () {
    return {
      id: this.me,
      connections: this.swarm ? this.swarm.connections.size : 0,
      peers: this.peers.size,
      online: [...this.peers.values()].filter((p) => p.online).length,
      groups: this.groups.size,
      community: this.community ? this.community.name : null
    }
  }

  async _feedGet (k) { const n = await this.feed.get(k); return n ? n.value : null }
  async _localGet (k) { const n = await this.local.get(k); return n ? n.value : null }
  async _listKeys (prefix) {
    const out = []
    for await (const { key } of this.local.createReadStream({ gt: prefix, lt: prefix + '~' })) out.push(key.slice(prefix.length))
    return out
  }

  async close () {
    this.closing = true
    for (const g of this.groups.values()) await g.base.close().catch(() => {})
    if (this.swarm) await this.swarm.destroy().catch(() => {})
    if (this.store) await this.store.close().catch(() => {})
  }
}

// -------------------------------------------------------------------- IPC wiring
const METHODS = [
  'getMe', 'setProfile', 'getPrivate', 'joinCommunity', 'inviteLink', 'listPeers', 'wave', 'listMatches',
  'createGroup', 'joinGroup', 'listGroups', 'groupState', 'sendMessage', 'addQuest', 'completeQuest',
  'metPayload', 'verifyMet', 'sendWing', 'block', 'unblock', 'listBlocked', 'report', 'stats'
]

function start (ipc, extra) {
  let core = null
  let buffered = ''
  const write = (obj) => ipc.write(b4a.from(JSON.stringify(obj) + '\n'))
  const emit = (event, data) => write({ event, data })

  async function handle (req) {
    const { id, method, params } = req
    try {
      let result
      if (method === 'init') {
        if (!core) {
          core = new CampfireCore({ storage: params.storage, bootstrap: (extra && extra.bootstrap) || params.bootstrap, emit })
          result = await core.ready()
        } else result = await core.getMe()
      } else if (method === 'close') {
        if (core) await core.close()
        core = null
        result = { ok: true }
      } else {
        if (!core) throw new Error('call init first')
        if (!METHODS.includes(method)) throw new Error('unknown method ' + method)
        const args = Array.isArray(params) ? params : params === undefined ? [] : [params]
        result = await core[method](...args)
      }
      write({ id, result: result === undefined ? null : result })
    } catch (err) {
      write({ id, error: (err && err.message) || String(err) })
    }
  }

  ipc.on('data', (data) => {
    buffered += b4a.toString(data)
    let i
    while ((i = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, i)
      buffered = buffered.slice(i + 1)
      if (!line.trim()) continue
      let req
      try { req = JSON.parse(line) } catch { continue }
      handle(req)
    }
  })
  emit('ready', { pid: typeof Bare !== 'undefined' ? 'bare' : 'node' })
  return { get core () { return core } }
}

module.exports = start
module.exports.start = start
module.exports.CampfireCore = CampfireCore
module.exports.topicFor = topicFor
