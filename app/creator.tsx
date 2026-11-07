// The PS1 character creator. On DONE we embed the private answers locally and publish the public profile P2P.
import React, { useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { AvatarView } from '../src/creator/AvatarView'
import { embedProfile } from '../src/ai/campfireAI'
import { draft } from '../src/draft'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { Loading, Screen } from '../src/ui/ps1'

export default function Creator() {
  const me = useStore((s) => s.me)
  const myLang = useStore((s) => s.myLang)
  const [saving, setSaving] = useState(false)
  const start = me?.profile?.avatar || { hair: 1, eyes: 1, mouth: 0, shirt: 4, ...draft.avatarHints }

  const onDone = async (config: Record<string, number>, png: string) => {
    setSaving(true)
    const old = me?.profile || ({} as any)
    const pub = {
      name: draft.name || old.name || 'Camper',
      bio: draft.bio || old.bio || '',
      tags: draft.tags.length ? draft.tags : old.tags || [],
      lookingFor: draft.lookingFor.length ? draft.lookingFor : old.lookingFor || [],
      course: draft.course || old.course || '',
      city: draft.city || old.city || '',
      lang: myLang,
    }
    const embedding = Object.keys(draft.answers).length ? await embedProfile({ ...pub, answers: draft.answers }) : old.embedding || null
    await p2p.call('setProfile', { ...pub, avatar: config, png, embedding, private: Object.keys(draft.answers).length ? { answers: draft.answers } : undefined })
    await useStore.getState().refresh()
    router.replace('/hub')
  }

  return (
    <Screen padded={false}>
      <View style={{ flex: 1 }}>
        <AvatarView mode="creator" config={start} onMessage={(m) => { if (m.type === 'avatar' && !saving) onDone(m.config, m.png) }} />
        {saving ? <View style={{ position: 'absolute', top: '25%', left: 0, right: 0 }}><Loading label="Saving to memory card" /></View> : null}
      </View>
    </Screen>
  )
}
