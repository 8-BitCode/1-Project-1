import { create } from 'zustand'
import { p2p } from './p2p/client'
import type { PublicProfile, Verdict } from './ai/logic'

export type PeerView = { id: string; online: boolean; profile: PublicProfile | null }
export type Group = { key: string; name: string; kind: 'dm' | 'group'; owner: string; members: string[]; writable: boolean }
export type WingLine = { who: 'me' | 'them'; text: string; source: string }

type State = {
  booted: boolean
  bootError: string | null
  me: { id: string; profile: (PublicProfile & { png?: string | null; avatar?: any }) | null; community: string | null } | null
  peers: Record<string, PeerView>
  matches: { id: string; ts: number }[]
  groups: Group[]
  wavedAtMe: Record<string, boolean>
  wing: Record<string, { session: string; lines: WingLine[]; live: boolean }>
  verdicts: Record<string, Verdict>
  translations: Record<string, string>
  stats: { connections: number; online: number; peers: number }
  myLang: string
  toast: string | null
  set: (p: Partial<State>) => void
  refresh: () => Promise<void>
  showToast: (t: string) => void
}

export const useStore = create<State>((set, get) => ({
  booted: false,
  bootError: null,
  me: null,
  peers: {},
  matches: [],
  groups: [],
  wavedAtMe: {},
  wing: {},
  verdicts: {},
  translations: {},
  stats: { connections: 0, online: 0, peers: 0 },
  myLang: 'en',
  toast: null,
  set: (p) => set(p),
  showToast: (t) => { set({ toast: t }); setTimeout(() => get().toast === t && set({ toast: null }), 3500) },
  refresh: async () => {
    const [me, peers, matches, groups, stats] = await Promise.all([
      p2p.call('getMe'), p2p.call('listPeers'), p2p.call('listMatches'), p2p.call('listGroups'), p2p.call('stats'),
    ])
    const map: Record<string, PeerView> = {}
    for (const p of peers) map[p.id] = p
    set({ me, peers: map, matches, groups, stats, myLang: me?.profile?.lang || get().myLang })
  },
}))

let wired = false
/** Boot the worker once and subscribe to its events. */
export async function bootP2P() {
  const s = useStore.getState()
  if (s.booted) return
  try {
    await p2p.start()
    if (!wired) {
      wired = true
      p2p.on('peer', (p: PeerView) => {
        if (!p.profile) return
        useStore.setState((st) => ({ peers: { ...st.peers, [p.id]: p } }))
      })
      p2p.on('match', (m: { id: string; profile: PublicProfile | null }) => {
        useStore.getState().showToast(`It's a match with ${m.profile?.name || 'someone'}! A chat is opening...`)
        useStore.getState().refresh()
      })
      p2p.on('waved-at', (m: { from: string }) => useStore.setState((st) => ({ wavedAtMe: { ...st.wavedAtMe, [m.from]: true } })))
      p2p.on('group', () => useStore.getState().refresh())
      p2p.on('group-update', () => p2p.call('listGroups').then((groups) => useStore.setState({ groups })))
      setInterval(() => p2p.call('stats').then((stats) => useStore.setState({ stats })).catch(() => {}), 3000)
    }
    await useStore.getState().refresh()
    useStore.setState({ booted: true, bootError: null })
  } catch (e: any) {
    useStore.setState({ bootError: e?.message || String(e) })
  }
}
