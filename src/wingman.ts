// Avatar wingmen: two phones' avatars chat with each other so the humans don't have to break the ice.
// Each phone writes ONLY its own avatar's lines, using its owner's private answers, which never leave the device.
// Lines travel phone-to-phone over the encrypted Hyperswarm connection (worker "wing" channel).
import { p2p } from './p2p/client'
import { useStore, WingLine } from './store'
import { wingmanLine } from './ai/campfireAI'

const TURNS = 4 // total lines in a wingman chat (2 each)
let responderOn = false

function append(peerId: string, session: string, line: WingLine, live: boolean) {
  useStore.setState((st) => {
    const cur = st.wing[peerId]
    const lines = cur && cur.session === session ? [...cur.lines, line] : [line]
    return { wing: { ...st.wing, [peerId]: { session, lines, live } } }
  })
}

async function myLine(peerId: string, turn: number) {
  const st = useStore.getState()
  const mine = st.me?.profile
  const theirs = st.peers[peerId]?.profile
  if (!mine || !theirs) return null
  const priv = await p2p.call('getPrivate').catch(() => ({}))
  const history = (st.wing[peerId]?.lines || []).map((l) => ({ who: l.who, text: l.text }))
  return wingmanLine({ mine, privateAnswers: (priv && priv.answers) || {}, theirs, history, turn })
}

/** Start a wingman chat. Live if they're online; otherwise my phone imagines their side from their PUBLIC profile only. */
export async function startWing(peerId: string) {
  const st = useStore.getState()
  const session = Math.random().toString(36).slice(2, 10)
  const online = !!st.peers[peerId]?.online
  useStore.setState((s) => ({ wing: { ...s.wing, [peerId]: { session, lines: [], live: online } } }))
  const first = await myLine(peerId, 0)
  if (!first) return
  append(peerId, session, { who: 'me', text: first.text, source: first.source }, online)
  if (online) {
    const r = await p2p.call('sendWing', [peerId, { turn: 0, text: first.text, session }])
    if (r.delivered) return
  }
  await simulate(peerId, session)
}

async function simulate(peerId: string, session: string) {
  const st = useStore.getState()
  const mine = st.me?.profile, theirs = st.peers[peerId]?.profile
  if (!mine || !theirs) return
  for (let turn = 1; turn < TURNS; turn++) {
    const history = (useStore.getState().wing[peerId]?.lines || []).map((l) => ({ who: (l.who === 'me' ? 'them' : 'me') as 'me' | 'them', text: l.text }))
    if (turn % 2 === 1) {
      // Their avatar, imagined from public info only.
      const r = await wingmanLine({ mine: theirs, privateAnswers: {}, theirs: mine, history, turn })
      append(peerId, session, { who: 'them', text: r.text, source: r.source + ' · simulated' }, false)
    } else {
      const r = await myLine(peerId, turn)
      if (r) append(peerId, session, { who: 'me', text: r.text, source: r.source }, false)
    }
  }
}

/** Auto-reply when another phone's avatar talks to mine (even if I'm on another screen). */
export function initWingResponder() {
  if (responderOn) return
  responderOn = true
  p2p.on('wing', async (m: { from: string; turn: number; text: string; session: string }) => {
    append(m.from, m.session, { who: 'them', text: m.text, source: 'their phone' }, true)
    const next = m.turn + 1
    if (next >= TURNS) return
    const r = await myLine(m.from, next)
    if (!r) return
    append(m.from, m.session, { who: 'me', text: r.text, source: r.source }, true)
    await p2p.call('sendWing', [m.from, { turn: next, text: r.text, session: m.session }])
  })
}
