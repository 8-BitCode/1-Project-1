// Title screen: "PRESS START".
import React, { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useStore } from '../src/store'
import { onModelProgress } from '../src/ai/models'
import { AvatarView } from '../src/creator/AvatarView'
import { Blink, C, H, Loading, P, Screen } from '../src/ui/ps1'

export default function Title() {
  const { booted, bootError, me } = useStore()
  const [dl, setDl] = useState<{ label: string; percentage: number } | null>(null)
  useEffect(() => onModelProgress((p) => setDl(p.percentage >= 100 ? null : p)), [])

  const go = () => {
    if (!booted) return
    if (!me?.community) router.replace('/welcome')
    else if (!me?.profile?.avatar) router.replace('/prompts')
    else router.replace('/hub')
  }

  return (
    <Screen padded={false}>
      <Pressable style={{ flex: 1 }} onPress={go}>
        <View style={{ flex: 1 }} pointerEvents="none">
          <AvatarView mode="portrait" config={me?.profile?.avatar || { hair: 2, hairColor: 4, extra: 4, shirt: 1, eyes: 1 }} />
        </View>
        <View style={{ position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center' }}>
          <H size={40} style={{ color: C.gold }}>Campfire</H>
          <P dim style={{ marginTop: 6 }}>make friends. no servers. no cloud.</P>
        </View>
        <View style={{ position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center' }}>
          {bootError ? <P style={{ color: C.red, textAlign: 'center', paddingHorizontal: 20 }}>P2P worker failed: {bootError}</P>
            : !booted ? <Loading label="Reading memory card" />
            : <Blink><H size={18}>Press start</H></Blink>}
          {dl ? <Loading label={'Fetching ' + dl.label.split(' (')[0] + ' from peers'} progress={dl.percentage} /> : null}
          <P dim small style={{ marginTop: 14 }}>AI runs on this phone · data shared peer-to-peer</P>
        </View>
      </Pressable>
    </Screen>
  )
}
