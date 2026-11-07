// QR scanner for invites (campfire://join?...) and "we met" proofs.
import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router, useLocalSearchParams } from 'expo-router'
import { p2p } from '../src/p2p/client'
import { useStore } from '../src/store'
import { parseInvite } from '../src/invite'
import { Btn, C, H, P, Screen } from '../src/ui/ps1'

export default function Scan() {
  const { mode, key } = useLocalSearchParams<{ mode: 'invite' | 'met'; key?: string }>()
  const [perm, ask] = useCameraPermissions()
  const [msg, setMsg] = useState<string | null>(null)
  const lock = useRef(false)

  const onScan = async ({ data }: { data: string }) => {
    if (lock.current) return
    lock.current = true
    try {
      if (mode === 'invite') {
        const inv = parseInvite(data)
        if (!inv) throw new Error('That is not a Campfire invite')
        await p2p.call('joinCommunity', inv)
        await useStore.getState().refresh()
        router.replace('/prompts')
      } else {
        const payload = JSON.parse(data)
        await p2p.call('verifyMet', payload)
        useStore.getState().showToast('Meet-up verified! Your avatars levelled up.')
        router.back()
      }
    } catch (e: any) {
      setMsg(e?.message || 'Could not read that code')
      setTimeout(() => { lock.current = false }, 1500)
    }
  }

  if (!perm) return <Screen><P>Checking camera...</P></Screen>
  if (!perm.granted) {
    return (
      <Screen>
        <H style={{ marginBottom: 10 }}>Camera needed</H>
        <P dim style={{ marginBottom: 16 }}>Only to read QR codes. Nothing is recorded or sent anywhere.</P>
        <Btn label="Allow camera" kind="fire" onPress={ask} />
        <Btn label="Back" kind="ghost" style={{ marginTop: 10 }} onPress={() => router.back()} />
      </Screen>
    )
  }
  return (
    <Screen padded={false}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
      <View style={{ position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' }}>
        <H size={16} style={{ color: C.gold }}>{mode === 'invite' ? 'Scan invite' : 'Scan their meet-up code'}</H>
        {msg ? <P style={{ color: C.red, marginTop: 8 }}>{msg}</P> : null}
      </View>
      <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20 }}>
        <Btn label="Cancel" kind="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  )
}
