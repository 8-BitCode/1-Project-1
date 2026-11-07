import React, { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { bootP2P } from '../src/store'
import { warmUp } from '../src/ai/models'
import { initWingResponder } from '../src/wingman'
import { C } from '../src/ui/ps1'

export default function Root() {
  useEffect(() => {
    bootP2P().then(initWingResponder)
    // Load the small models in the background so nothing loads live during the demo.
    warmUp(['decide', 'embed', 'llm']).catch(() => {})
  }, [])
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }} />
    </SafeAreaProvider>
  )
}
