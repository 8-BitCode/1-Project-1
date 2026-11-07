// Invite QR: the only way in. Scanning it joins the same Hyperswarm topic as everyone at your campfire.
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { router } from 'expo-router'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { Btn, C, H, P, Panel, Screen } from '../src/ui/ps1'

export default function Invite() {
  const me = useStore((s) => s.me)
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => { p2p.call('inviteLink').then(setLink).catch(() => {}) }, [])
  return (
    <Screen>
      <H size={22} style={{ color: C.gold, marginBottom: 6 }}>Invite someone</H>
      <P dim style={{ marginBottom: 14 }}>They scan this in Campfire and their avatar joins your fire. No app store account, no sign-up, no server.</P>
      <Panel title={me?.community || 'campfire'}>
        <View style={{ alignItems: 'center', padding: 12, backgroundColor: '#fff' }}>
          {link ? <QRCode value={link} size={230} /> : null}
        </View>
      </Panel>
      <P dim small style={{ marginBottom: 14 }}>Invites are linked to you, which keeps bots and randoms out.</P>
      <Btn label="Done" kind="ghost" onPress={() => router.back()} />
    </Screen>
  )
}
