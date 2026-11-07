// Joining is invite-only: scan a friend's / society's QR (that's how you know everyone is from your uni),
// or light a new campfire for your community.
import React, { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { TRANSLATABLE } from '../src/ai/models'
import { Btn, C, Field, H, P, Panel, Screen, Tag } from '../src/ui/ps1'

const LANG_NAMES: Record<string, string> = { en: 'English', zh: '中文', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', pt: 'Português', ar: 'العربية', hi: 'हिन्दी', ja: '日本語', ko: '한국어', tr: 'Türkçe', pl: 'Polski', ru: 'Русский', uk: 'Українська', vi: 'Tiếng Việt', ms: 'Melayu', id: 'Indonesia', th: 'ไทย', nl: 'Nederlands', el: 'Ελληνικά', ro: 'Română', bn: 'বাংলা', ta: 'தமிழ்', fa: 'فارسی', he: 'עברית' }
const SHOWN = ['en', ...['zh', 'es', 'fr', 'de', 'ar', 'hi', 'ja', 'ko', 'it', 'pt', 'tr', 'pl', 'ms', 'vi', 'ru'].filter((l) => TRANSLATABLE.includes(l))]

export default function Welcome() {
  const { myLang, set } = useStore()
  const [name, setName] = useState('greatunihack-2026')
  const [busy, setBusy] = useState(false)

  const light = async () => {
    setBusy(true)
    try {
      await p2p.call('joinCommunity', { name: name.trim().toLowerCase().replace(/\s+/g, '-') })
      await useStore.getState().refresh()
      router.replace('/prompts')
    } finally { setBusy(false) }
  }

  return (
    <Screen>
      <ScrollView>
        <H size={24} style={{ color: C.gold, marginBottom: 4 }}>New game</H>
        <P dim style={{ marginBottom: 16 }}>No email. No password. Your phone makes its own identity key.</P>

        <Panel title="1. Your language">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {SHOWN.map((l) => <Tag key={l} label={LANG_NAMES[l] || l} on={myLang === l} onPress={() => set({ myLang: l })} />)}
          </View>
          <P dim small>Chats are translated on your phone. Nobody else sees the original or the translation.</P>
        </Panel>

        <Panel title="2. Join your people">
          <Btn label="Scan an invite QR" kind="fire" onPress={() => router.push({ pathname: '/scan', params: { mode: 'invite' } })} />
          <P dim small style={{ marginTop: 8 }}>Get one from a friend, a society stall or your halls. Invites mean everyone here is really from your uni.</P>
        </Panel>

        <Panel title="...or light a new campfire">
          <Field label="Community name" value={name} onChangeText={setName} autoCapitalize="none" />
          <Btn label={busy ? 'Lighting...' : 'Light it'} onPress={light} disabled={busy || !name.trim()} />
        </Panel>
      </ScrollView>
    </Screen>
  )
}
