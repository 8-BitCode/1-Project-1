// Me: avatar, privacy explainer, safety controls, and proof that everything is local.
import React, { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { AvatarView } from '../src/creator/AvatarView'
import { modelStatus } from '../src/ai/models'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { Btn, C, H, P, Panel, Screen, Tag } from '../src/ui/ps1'

export default function Me() {
  const { me, stats, peers } = useStore()
  const [blocked, setBlocked] = useState<string[]>([])
  const [models, setModels] = useState(modelStatus())
  useEffect(() => {
    p2p.call('listBlocked').then(setBlocked)
    const t = setInterval(() => setModels(modelStatus()), 2000); return () => clearInterval(t)
  }, [])
  const p = me?.profile

  return (
    <Screen tabs>
      <ScrollView>
        <View style={{ height: 240, marginBottom: 12, borderWidth: 2, borderColor: C.line }}>
          {p?.avatar ? <AvatarView mode="portrait" config={p.avatar} /> : null}
        </View>
        <H size={22} style={{ color: C.gold }}>{p?.name}</H>
        <P style={{ marginVertical: 6 }}>{p?.bio}</P>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{(p?.tags || []).map((t) => <Tag key={t} label={t} on />)}</View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <Btn style={{ flex: 1 }} small label="Edit avatar" onPress={() => router.push('/creator')} />
          <Btn style={{ flex: 1 }} small label="Redo prompts" onPress={() => router.push('/prompts')} />
        </View>

        <Panel title="Who can see what">
          <P>• Public (shared P2P): avatar, name, bio, tags, an interest vector.</P>
          <P>• Private (never leaves this phone): your prompt answers, voice, blocks, translations, safety checks.</P>
          <P>• Chats: only the people in them, end-to-end encrypted.</P>
        </Panel>

        <Panel title="Your datacenter (this phone)">
          {models.map((m) => <P key={m.role} small>{m.loaded ? '■' : m.failed ? '×' : '□'} {m.label}</P>)}
          <P dim small style={{ marginTop: 6 }}>{stats.connections} live P2P connections · {Object.keys(peers).length} campers known · 0 servers</P>
          <P dim small>ID: {me?.id?.slice(0, 16)}...</P>
        </Panel>

        <Panel title={`Blocked (${blocked.length})`}>
          {blocked.length ? blocked.map((id) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <P style={{ flex: 1 }}>{peers[id]?.profile?.name || id.slice(0, 10)}</P>
              <Btn small kind="ghost" label="Unblock" onPress={() => p2p.call('unblock', id).then(() => p2p.call('listBlocked').then(setBlocked))} />
            </View>
          )) : <P dim>Nobody. Tap someone at the campfire to block or report them.</P>}
          <P dim small style={{ marginTop: 6 }}>Reports are signed and shared. Anyone reported by 3+ different people is hidden for everyone.</P>
        </Panel>
        <View style={{ height: 30 }} />
      </ScrollView>
    </Screen>
  )
}
