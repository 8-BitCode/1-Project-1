// Group / match chat stored in an Autobase shared only between members.
// Every incoming message is (1) safety-checked by the System One model and (2) translated, both ON THIS PHONE.
import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { checkMessage, makeQuest, translateText } from '../../src/ai/campfireAI'
import { p2p } from '../../src/p2p/client'
import { useStore } from '../../src/store'
import { Btn, C, FONT, H, Loading, P, Panel, Screen } from '../../src/ui/ps1'

type Msg = { type: 'msg'; from: string; ts: number; text: string; lang: string }
type Quest = { questId: string; title: string; detail: string; where?: string; when?: string; done: boolean }

const SUPPORT = 'If things feel heavy, you can talk to Samaritans any time on 116 123 (free, UK), or your uni\'s wellbeing service.'

export default function Chat() {
  const { key } = useLocalSearchParams<{ key: string }>()
  const { me, peers, myLang, verdicts, translations, set, showToast } = useStore()
  const [state, setState] = useState<{ group: any; messages: Msg[]; quests: Quest[]; met: any[] } | null>(null)
  const [draft, setDraft] = useState('')
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [original, setOriginal] = useState<Record<string, boolean>>({})
  const [questBusy, setQuestBusy] = useState(false)

  const load = useCallback(() => p2p.call('groupState', key).then(setState).catch(() => {}), [key])
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 1500); return () => clearInterval(t) }, [load]))

  // Safety + translation for messages from other people.
  useEffect(() => {
    if (!state) return
    for (const m of state.messages) {
      if (m.from === me?.id) continue
      const id = m.ts + m.from
      if (!verdicts[id]) {
        set({ verdicts: { ...useStore.getState().verdicts, [id]: { action: 'allow', label: 'checking', confidence: 0, support: false, source: 'fallback' } } })
        checkMessage(m.text).then((v) => set({ verdicts: { ...useStore.getState().verdicts, [id]: v } }))
      }
      if (m.lang && m.lang !== myLang && translations[id] === undefined) {
        set({ translations: { ...useStore.getState().translations, [id]: '' } })
        translateText(m.text, m.lang, myLang).then((r) => set({ translations: { ...useStore.getState().translations, [id]: r ? r.text : '' } }))
      }
    }
  }, [state?.messages.length, myLang])

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try { await p2p.call('sendMessage', [key, { text, lang: myLang }]); load() } catch (e: any) { showToast(e.message); setDraft(text) }
  }

  const newQuest = async () => {
    if (!state || !me?.profile) return
    setQuestBusy(true)
    const people = [me.profile, ...state.group.members.filter((m: string) => m !== me.id).map((m: string) => peers[m]?.profile).filter(Boolean)]
    const q = await makeQuest(people, me.profile.city)
    await p2p.call('addQuest', [key, q]).catch((e) => showToast(e.message))
    setQuestBusy(false); load()
  }

  if (!state) return <Screen><Loading label="Opening chat" /></Screen>
  const g = state.group
  const others = g.members.filter((m: string) => m !== me?.id)
  const title = g.kind === 'dm' ? peers[others[0]]?.profile?.name || 'Chat' : g.name
  const openQuest = state.quests.find((q) => !q.done)

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={40}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Pressable onPress={() => router.back()}><H size={18}>‹ </H></Pressable>
          <H size={16} style={{ flex: 1, color: C.gold }}>{title}</H>
          <Btn small label="We met!" kind="green" onPress={() => router.push({ pathname: '/meet/[key]', params: { key } })} />
        </View>

        {openQuest ? (
          <Panel title="Quest">
            <H size={14} style={{ color: C.cyan }}>{openQuest.title}</H>
            <P style={{ marginTop: 4 }}>{openQuest.detail}</P>
            {openQuest.where || openQuest.when ? <P dim small style={{ marginTop: 4 }}>{[openQuest.where, openQuest.when].filter(Boolean).join(' · ')}</P> : null}
            <Btn small label="Quest complete" kind="fire" style={{ marginTop: 8 }} onPress={() => p2p.call('completeQuest', [key, openQuest.questId]).then(load)} />
          </Panel>
        ) : (
          <Btn small label={questBusy ? 'Inventing a quest...' : 'Generate a quest'} kind="fire" onPress={newQuest} disabled={questBusy} style={{ marginBottom: 10 }} />
        )}
        {state.met.length ? <P small style={{ color: C.green, marginBottom: 6 }}>✓ Met in real life {state.met.length}x · {state.quests.filter((q) => q.done).length} quests done</P> : null}

        <FlatList
          style={{ flex: 1 }}
          data={state.messages}
          keyExtractor={(m) => m.ts + m.from}
          renderItem={({ item: m }) => {
            const mine = m.from === me?.id
            const id = m.ts + m.from
            const v = verdicts[id]
            const tr = translations[id]
            const who = mine ? 'You' : peers[m.from]?.profile?.name || '...'
            if (!mine && v?.action === 'hide' && !shown[id]) {
              return (
                <Pressable onPress={() => setShown({ ...shown, [id]: true })} style={bubble(false, true)}>
                  <P small style={{ color: C.red }}>Hidden by your on-device safety filter ({v.label}, {Math.round(v.confidence * 100)}%). Tap to view anyway.</P>
                </Pressable>
              )
            }
            return (
              <View style={bubble(mine, v?.action === 'warn')}>
                <P small style={{ color: mine ? C.cyan : C.gold }}>{who}{tr && !original[id] ? ` · translated from ${m.lang}` : ''}</P>
                <P>{tr && !original[id] ? tr : m.text}</P>
                {tr ? <Pressable onPress={() => setOriginal({ ...original, [id]: !original[id] })}><P dim small>{original[id] ? 'show translation' : 'show original'}</P></Pressable> : null}
                {v?.action === 'warn' && !v.support ? <P small style={{ color: C.gold }}>⚠ Careful: {v.label} ({Math.round(v.confidence * 100)}% sure). Never share your address or bank details.</P> : null}
                {v?.support ? <P small style={{ color: C.cyan }}>{SUPPORT}</P> : null}
              </View>
            )
          }}
          ListEmptyComponent={<P dim style={{ textAlign: 'center', marginTop: 30 }}>{g.writable ? 'Say hi! Messages go straight to their phone.' : 'Connecting to the group... keep the app open.'}</P>}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <TextInput value={draft} onChangeText={setDraft} placeholder={g.writable ? 'Message' : 'Connecting...'} placeholderTextColor={C.dim} onSubmitEditing={send}
            style={{ flex: 1, fontFamily: FONT, color: C.text, borderWidth: 2, borderColor: C.line, backgroundColor: '#050a26', padding: 10, marginRight: 8 }} />
          <Btn label="Send" kind="fire" onPress={send} disabled={!g.writable} />
        </View>
        <P dim small style={{ marginTop: 6 }}>{`Encrypted P2P · translated + filtered on your phone · ${others.length + 1} people`}</P>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function bubble(mine: boolean, flagged: boolean) {
  return { alignSelf: (mine ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start', maxWidth: '82%' as const, backgroundColor: mine ? C.panel2 : C.panel, borderWidth: 2, borderColor: flagged ? C.gold : C.line, padding: 8, marginBottom: 8 }
}
