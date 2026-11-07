// Watch your avatar and theirs chat by the fire. If it clicks, wave and take over.
import React, { useEffect, useMemo, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { AvatarView, AvatarViewHandle } from '../../src/creator/AvatarView'
import { startWing } from '../../src/wingman'
import { p2p } from '../../src/p2p/client'
import { useStore } from '../../src/store'
import { Btn, C, H, Loading, P, Panel, Screen } from '../../src/ui/ps1'

export default function Wingman() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { me, peers, wing, showToast } = useStore()
  const view = useRef<AvatarViewHandle>(null)
  const them = peers[id]
  const chat = wing[id]
  const started = useRef(false)

  const people = useMemo(() => [
    { id: me!.id, name: me?.profile?.name || 'You', config: me?.profile?.avatar, me: true },
    { id, name: them?.profile?.name || '???', config: them?.profile?.avatar },
  ], [me, them, id])

  useEffect(() => { view.current?.send({ type: 'people', people }) }, [people])
  useEffect(() => {
    if (!started.current && (!chat || !chat.lines.length)) { started.current = true; startWing(id) }
  }, [id, chat])
  useEffect(() => {
    const last = chat?.lines[chat.lines.length - 1]
    if (last) view.current?.send({ type: 'say', id: last.who === 'me' ? me!.id : id, text: last.text, ms: 7000 })
  }, [chat?.lines.length])

  if (!them?.profile) return <Screen><P>They left the campfire.</P></Screen>
  const done = (chat?.lines.length || 0) >= 4

  return (
    <Screen padded={false}>
      <View style={{ height: '42%' }}><AvatarView ref={view} mode="hub" people={people} /></View>
      <ScrollView style={{ flex: 1, padding: 12 }}>
        <H size={14} style={{ color: C.gold, marginBottom: 4 }}>Avatars are chatting</H>
        <P dim small style={{ marginBottom: 10 }}>
          {chat?.live ? 'Live: each phone writes its own avatar\'s lines. Private answers never leave either phone.' : 'They\'re away, so your phone is imagining their side from their public profile.'}
        </P>
        {(chat?.lines || []).map((l, i) => (
          <Panel key={i} style={{ marginLeft: l.who === 'me' ? 0 : 30, marginRight: l.who === 'me' ? 30 : 0 }}>
            <P small style={{ color: l.who === 'me' ? C.cyan : C.gold }}>{l.who === 'me' ? me?.profile?.name : them.profile?.name}'s avatar · {l.source}</P>
            <P>{l.text}</P>
          </Panel>
        ))}
        {!done ? <Loading label="Thinking" /> : (
          <>
            <Btn label={`Wave at ${them.profile.name}`} kind="fire" onPress={async () => { await p2p.call('wave', id); showToast('Wave sent!'); router.back() }} />
            <Btn label="Not feeling it" kind="ghost" style={{ marginTop: 8 }} onPress={() => router.back()} />
          </>
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    </Screen>
  )
}
