// Fun prompts instead of a form. Answer by typing or by voice (Whisper on-device).
// The raw answers stay private on this phone; only a bio, tags and an embedding vector are published.
import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio'
import { buildProfile } from '../src/ai/campfireAI'
import { draft } from '../src/draft'
import { Btn, C, Field, H, Loading, P, Panel, Screen, Tag } from '../src/ui/ps1'

const PROMPTS = [
  { key: 'sunday', q: 'Your perfect Sunday?', hint: 'lie-in, then bouldering and ramen...' },
  { key: 'try', q: 'Something you want to try this month?', hint: 'a pottery class, a 5k, a new café...' },
  { key: 'comfort', q: 'Your comfort food (and the story)?', hint: "mum's dumplings, I'm always homesick" },
  { key: 'looking', q: 'What kind of friend are you looking for?', hint: 'gym buddy, people to cook with...' },
]

function MicButton({ onText }: { onText: (t: string) => void }) {
  const rec = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [state, setState] = useState<'idle' | 'rec' | 'stt'>('idle')
  const startRec = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync()
    if (!perm.granted) return
    await rec.prepareToRecordAsync(); rec.record(); setState('rec')
  }
  const stopRec = async () => {
    if (state !== 'rec') return
    await rec.stop(); setState('stt')
    const { voiceToText } = await import('../src/ai/campfireAI')
    const r = await voiceToText(rec.uri || '')
    setState('idle')
    if (r.text) onText(r.text)
  }
  return (
    <Pressable onPressIn={startRec} onPressOut={stopRec} style={{ borderWidth: 2, borderColor: state === 'rec' ? C.red : C.dim, padding: 8, marginLeft: 8, backgroundColor: state === 'rec' ? '#3a0a0a' : '#050a26' }}>
      <P small style={{ color: state === 'rec' ? C.red : C.sub }}>{state === 'rec' ? '● REC' : state === 'stt' ? '...' : 'HOLD MIC'}</P>
    </Pressable>
  )
}

export default function Prompts() {
  const [answers, setAnswers] = useState<Record<string, string>>(draft.answers)
  const [name, setName] = useState(draft.name)
  const [course, setCourse] = useState(draft.course)
  const [city, setCity] = useState(draft.city)
  const [busy, setBusy] = useState(false)
  const [built, setBuilt] = useState<null | { bio: string; tags: string[]; lookingFor: string[]; source: string }>(null)
  const [err, setErr] = useState('')

  const answered = PROMPTS.filter((p) => (answers[p.key] || '').trim().length > 2).length

  const build = async () => {
    if (!name.trim()) { setErr('Pick a name your avatar will use'); return }
    if (answered < 2) { setErr('Answer at least 2 prompts so we can find your people'); return }
    setErr(''); setBusy(true)
    const qa: Record<string, string> = {}
    PROMPTS.forEach((p) => { if (answers[p.key]) qa[p.q] = answers[p.key] })
    const r = await buildProfile(qa)
    Object.assign(draft, { name: name.trim(), course, city, answers: qa, bio: r.bio, tags: r.tags, lookingFor: r.lookingFor, avatarHints: r.avatarHints })
    setBuilt(r); setBusy(false)
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <H size={22} style={{ color: C.gold }}>Tell your avatar about you</H>
        <P dim style={{ marginBottom: 14 }}>Type or hold the mic. Your answers never leave this phone.</P>

        <Field label="Avatar name" value={name} onChangeText={setName} placeholder="Wei" maxLength={24} />
        {PROMPTS.map((p) => (
          <View key={p.key} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label={p.q} value={answers[p.key] || ''} onChangeText={(t) => setAnswers({ ...answers, [p.key]: t })} placeholder={p.hint} multiline />
            </View>
            <View style={{ marginBottom: 10 }}><MicButton onText={(t) => setAnswers((a) => ({ ...a, [p.key]: ((a[p.key] || '') + ' ' + t).trim() }))} /></View>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="Course (optional)" value={course} onChangeText={setCourse} placeholder="Computer Science" /></View>
          <View style={{ flex: 1 }}><Field label="City (optional)" value={city} onChangeText={setCity} placeholder="Manchester" /></View>
        </View>
        {err ? <P style={{ color: C.red, marginBottom: 8 }}>{err}</P> : null}

        {!built ? (busy ? <Loading label="Your avatar is thinking" /> : <Btn label="Build my profile" kind="fire" onPress={build} />) : (
          <Panel title={built.source === 'qvac' ? 'Written on-device by QVAC' : 'Quick profile (AI still loading)'}>
            <Field label="Bio (public)" value={draft.bio} onChangeText={(t) => { draft.bio = t; setBuilt({ ...built, bio: t }) }} multiline />
            <P dim small style={{ marginBottom: 6 }}>Interests (tap to remove)</P>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {built.tags.map((t) => <Tag key={t} label={t} on onPress={() => { draft.tags = draft.tags.filter((x) => x !== t); setBuilt({ ...built, tags: draft.tags }) }} />)}
            </View>
            <P dim small style={{ marginVertical: 6 }}>Looking for: {built.lookingFor.join(', ')}</P>
            <Btn label="Next: make your avatar" kind="fire" onPress={() => router.push('/creator')} />
            <Btn label="Rewrite" kind="ghost" style={{ marginTop: 8 }} onPress={() => setBuilt(null)} />
          </Panel>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  )
}
