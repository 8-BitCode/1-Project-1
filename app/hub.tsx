// The campfire: everyone nearby in the swarm sits around the fire. Tap someone to see what you have in common.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { AvatarView, AvatarViewHandle, HubPerson } from '../src/creator/AvatarView'
import { commonGround } from '../src/ai/campfireAI'
import { formGroup, rankPeers } from '../src/ai/logic'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { Btn, C, H, Loading, NetBadge, P, Panel, Screen, Tag } from '../src/ui/ps1'

const MAX_AROUND_FIRE = 8

export default function Hub() {
  const { me, peers, matches, wavedAtMe, showToast } = useStore()
  const view = useRef<AvatarViewHandle>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [why, setWhy] = useState<Record<string, { summary: string; starters: string[]; source: string }>>({})
  const [busy, setBusy] = useState(false)

  const ranked = useMemo(() => (me?.profile ? rankPeers(me.profile, Object.values(peers)) : []), [me, peers])
  const matchIds = new Set(matches.map((m) => m.id))
  const people: HubPerson[] = useMemo(() => {
    const list: HubPerson[] = []
    if (me?.profile) list.push({ id: me.id, name: me.profile.name || 'You', config: me.profile.avatar, me: true })
    ranked.slice(0, MAX_AROUND_FIRE - 1).forEach((r) => list.push({ id: r.peer.id, name: r.peer.profile!.name, config: r.peer.profile!.avatar, highlight: matchIds.has(r.peer.id) || !!wavedAtMe[r.peer.id] }))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, me, matches, wavedAtMe])

  useEffect(() => { view.current?.send({ type: 'people', people }) }, [people])

  const selected = sel ? peers[sel] : null
  const selRank = ranked.find((r) => r.peer.id === sel)

  useEffect(() => {
    if (!sel || why[sel] || !me?.profile || !peers[sel]?.profile) return
    commonGround(me.profile, peers[sel].profile!).then((r) => {
      setWhy((w) => ({ ...w, [sel]: r }))
      view.current?.send({ type: 'say', id: sel, text: r.starters[0] || r.summary, ms: 6000 })
    })
  }, [sel, me, peers, why])

  const wave = async (id: string) => {
    await p2p.call('wave', id)
    showToast(wavedAtMe[id] ? 'You both waved! Opening a chat...' : 'Wave sent. If they wave back, a chat opens.')
    useStore.getState().refresh()
  }

  const findGroup = async () => {
    if (!me?.profile) return
    const group = formGroup(me.profile, Object.values(peers).filter((p) => p.online), 4)
    if (group.length < 2) { showToast('Need at least 2 people online nearby. Invite someone!'); return }
    setBusy(true)
    try {
      const shared = group.map((g) => g.profile!.name).join(', ')
      const { key } = await p2p.call('createGroup', { memberIds: group.map((g) => g.id), name: 'Crew: ' + shared.slice(0, 30) })
      showToast('Group made with ' + shared + '. Generate a quest inside!')
      router.push({ pathname: '/chat/[key]', params: { key } })
    } finally { setBusy(false) }
  }

  return (
    <Screen tabs padded={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10 }}>
        <NetBadge />
        <Btn small label="Invite" onPress={() => router.push('/invite')} />
      </View>
      <View style={{ height: '48%' }}>
        <AvatarView ref={view} mode="hub" people={people} onMessage={(m) => { if (m.type === 'tap' && m.id !== me?.id) setSel(m.id) }} />
      </View>
      <ScrollView style={{ flex: 1, padding: 12 }}>
        {!selected ? (
          <>
            <Panel title={ranked.length ? `${ranked.length} campers in the swarm` : 'The fire is lit'}>
              <P dim>{ranked.length ? 'Tap an avatar to see what you have in common.' : 'Nobody here yet. Show your invite QR to someone nearby. Their avatar appears here once their phone finds yours.'}</P>
            </Panel>
            <Btn label={busy ? 'Finding...' : 'Find my group of 3-4'} kind="fire" onPress={findGroup} disabled={busy} />
            <P dim small style={{ marginTop: 8 }}>Small groups feel less like a date. The AI picks people so nobody is the odd one out.</P>
          </>
        ) : (
          <Panel title={selected.profile?.name + (selected.online ? ' · online' : ' · away')}>
            {selRank ? <P style={{ color: C.gold, marginBottom: 6 }}>{Math.round(selRank.score * 100)}% vibe match</P> : null}
            <P style={{ marginBottom: 8 }}>{selected.profile?.bio}</P>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {(selected.profile?.tags || []).map((t) => <Tag key={t} label={t} on={selRank?.shared.includes(t)} />)}
            </View>
            {why[selected.id] ? (
              <View style={{ marginVertical: 8 }}>
                <P style={{ color: C.cyan }}>{why[selected.id].summary}</P>
                {why[selected.id].starters.map((s) => <P key={s} dim small>› {s}</P>)}
              </View>
            ) : <Loading label="Finding common ground" />}
            {wavedAtMe[selected.id] ? <H size={13} style={{ color: C.gold, marginBottom: 8 }}>They waved at you!</H> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn style={{ flex: 1 }} label="Avatars chat" onPress={() => router.push({ pathname: '/wingman/[id]', params: { id: selected.id } })} />
              <Btn style={{ flex: 1 }} label={matchIds.has(selected.id) ? 'Matched' : 'Wave'} kind="fire" onPress={() => wave(selected.id)} disabled={matchIds.has(selected.id)} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Btn small style={{ flex: 1 }} label="Close" kind="ghost" onPress={() => setSel(null)} />
              <Btn small style={{ flex: 1 }} label="Block" kind="ghost" onPress={async () => { await p2p.call('block', selected.id); setSel(null); showToast('Blocked. They can no longer reach you.'); useStore.getState().refresh() }} />
              <Btn small style={{ flex: 1 }} label="Report" kind="red" onPress={async () => { await p2p.call('report', [selected.id, 'reported from campfire']); setSel(null); showToast('Reported and blocked. Thank you for keeping the fire safe.'); useStore.getState().refresh() }} />
            </View>
          </Panel>
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    </Screen>
  )
}
