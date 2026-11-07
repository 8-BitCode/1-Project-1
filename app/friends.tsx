import React from 'react'
import { Image, Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { Btn, C, H, P, Panel, Screen } from '../src/ui/ps1'

function Face({ png }: { png?: string | null }) {
  return png ? <Image source={{ uri: png }} style={{ width: 44, height: 44, borderWidth: 2, borderColor: C.line, marginRight: 10 }} /> : <View style={{ width: 44, height: 44, borderWidth: 2, borderColor: C.dim, marginRight: 10 }} />
}

export default function Friends() {
  const { peers, groups, wavedAtMe, matches, me } = useStore()
  const matched = new Set(matches.map((m) => m.id))
  const waiting = Object.keys(wavedAtMe).filter((id) => !matched.has(id) && peers[id])

  return (
    <Screen tabs>
      <ScrollView>
        <H size={22} style={{ color: C.gold, marginBottom: 12 }}>Friends</H>

        {waiting.length ? (
          <Panel title="Waved at you">
            {waiting.map((id) => (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Face png={(peers[id].profile as any)?.png} />
                <P style={{ flex: 1 }}>{peers[id].profile?.name}</P>
                <Btn small label="Wave back" kind="fire" onPress={() => p2p.call('wave', id).then(() => useStore.getState().refresh())} />
              </View>
            ))}
          </Panel>
        ) : null}

        <Panel title={`Chats and crews (${groups.length})`}>
          {groups.length ? groups.map((g) => {
            const others = g.members.filter((m) => m !== me?.id).map((m) => peers[m]?.profile?.name || '...')
            const face = peers[g.members.find((m) => m !== me?.id) || '']?.profile as any
            return (
              <Pressable key={g.key} onPress={() => router.push({ pathname: '/chat/[key]', params: { key: g.key } })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.dim }}>
                <Face png={face?.png} />
                <View style={{ flex: 1 }}>
                  <P style={{ color: C.text }}>{g.kind === 'dm' ? others[0] || g.name : g.name}</P>
                  <P dim small>{g.kind === 'dm' ? 'match' : `crew of ${g.members.length}`}{g.writable ? '' : ' · connecting...'}</P>
                </View>
                <P style={{ color: C.gold }}>›</P>
              </Pressable>
            )
          }) : <P dim>No chats yet. Wave at someone at the campfire. When they wave back, a chat opens here.</P>}
        </Panel>
      </ScrollView>
    </Screen>
  )
}
