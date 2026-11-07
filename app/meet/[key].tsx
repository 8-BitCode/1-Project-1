// "We actually met": show my signed QR, or scan theirs. The proof is written into the group's Autobase.
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { router, useLocalSearchParams } from 'expo-router'
import { p2p } from '../../src/p2p/client'
import { Btn, C, H, P, Panel, Screen } from '../../src/ui/ps1'

export default function Meet() {
  const { key } = useLocalSearchParams<{ key: string }>()
  const [payload, setPayload] = useState<string | null>(null)
  useEffect(() => {
    const make = () => p2p.call('metPayload', key).then((p) => setPayload(JSON.stringify(p)))
    make(); const t = setInterval(make, 5 * 60 * 1000); return () => clearInterval(t)
  }, [key])

  return (
    <Screen>
      <H size={22} style={{ color: C.gold, marginBottom: 6 }}>You met up!</H>
      <P dim style={{ marginBottom: 14 }}>One of you shows this code, the other scans it. It's signed by your phone's key, so it can't be faked from far away.</P>
      <Panel title="Your meet-up code">
        <View style={{ alignItems: 'center', padding: 12, backgroundColor: '#fff' }}>
          {payload ? <QRCode value={payload} size={220} /> : null}
        </View>
      </Panel>
      <Btn label="Scan their code" kind="fire" onPress={() => router.push({ pathname: '/scan', params: { mode: 'met', key } })} />
      <Btn label="Back" kind="ghost" style={{ marginTop: 10 }} onPress={() => router.back()} />
      <P dim small style={{ marginTop: 14 }}>Campfire rewards time together, not time in the app. No streaks, no likes, no feed.</P>
    </Screen>
  )
}
