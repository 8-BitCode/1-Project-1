// PS1-era UI kit: memory-card blues, chunky white borders, hard drop shadows, monospace caps.
import React, { useEffect, useRef, useState } from 'react'
import { Animated, Platform, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, usePathname } from 'expo-router'
import { useStore } from '../store'

export const C = {
  bg: '#02040f',
  panel: '#0a1440',
  panel2: '#1b2a7a',
  line: '#ffffff',
  dim: '#4a5aa8',
  text: '#e8e8f0',
  sub: '#8f9bd6',
  gold: '#ffe066',
  cyan: '#7cf0ff',
  fire: '#c2410c',
  green: '#3fae4f',
  red: '#d63a3a',
}
export const FONT = Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' })

export function Screen({ children, padded = true, tabs = false }: { children: React.ReactNode; padded?: boolean; tabs?: boolean }) {
  const toast = useStore((s) => s.toast)
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right', ...(tabs ? [] : ['bottom' as const])]}>
      <View style={{ flex: 1, padding: padded ? 14 : 0 }}>{children}</View>
      {tabs && <TabBar />}
      {toast ? <View style={s.toast}><P style={{ color: C.gold }}>{toast}</P></View> : null}
    </SafeAreaView>
  )
}

export function H({ children, style, size = 20 }: { children: React.ReactNode; style?: any; size?: number }) {
  return <Text style={[s.h, { fontSize: size }, style]}>{children}</Text>
}
export function P({ children, style, dim, small }: { children: React.ReactNode; style?: any; dim?: boolean; small?: boolean }) {
  return <Text style={[s.p, dim && { color: C.sub }, small && { fontSize: 11 }, style]}>{children}</Text>
}

export function Panel({ children, style, title }: { children: React.ReactNode; style?: ViewStyle; title?: string }) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      <View style={s.shadow} />
      <View style={s.panel}>
        {title ? <Text style={s.panelTitle}>{title}</Text> : null}
        {children}
      </View>
    </View>
  )
}

export function Btn({ label, onPress, kind = 'blue', disabled, style, small }: { label: string; onPress?: () => void; kind?: 'blue' | 'fire' | 'ghost' | 'red' | 'green'; disabled?: boolean; style?: ViewStyle; small?: boolean }) {
  const bg = { blue: C.panel2, fire: C.fire, ghost: 'transparent', red: C.red, green: '#1f7a3a' }[kind]
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={({ pressed }) => [{ opacity: disabled ? 0.45 : 1, transform: [{ translateX: pressed ? 2 : 0 }, { translateY: pressed ? 2 : 0 }] }, style]}>
      {({ pressed }) => (
        <View>
          {!pressed && kind !== 'ghost' && <View style={[s.shadow, { top: 3, left: 3 }]} />}
          <View style={[s.btn, small && { paddingVertical: 7 }, { backgroundColor: bg }, kind === 'ghost' && { borderColor: C.dim }]}>
            <Text style={[s.btnText, small && { fontSize: 11 }]}>{label}</Text>
          </View>
        </View>
      )}
    </Pressable>
  )
}

export function Tag({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.tag, on && { borderColor: C.gold, backgroundColor: C.panel2 }]}>
      <Text style={[s.tagText, on && { color: C.gold }]}>{label}</Text>
    </Pressable>
  )
}

export function Field(props: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      {props.label ? <P dim small style={{ marginBottom: 4 }}>{props.label}</P> : null}
      <TextInput placeholderTextColor={C.dim} {...props} style={[s.field, props.multiline && { minHeight: 64, textAlignVertical: 'top' }, props.style]} />
    </View>
  )
}

/** "NOW LOADING..." with a blinking cursor, like a PS1 memory card read. */
export function Loading({ label = 'Now loading', progress }: { label?: string; progress?: number }) {
  const [dots, setDots] = useState(0)
  useEffect(() => { const t = setInterval(() => setDots((d) => (d + 1) % 4), 350); return () => clearInterval(t) }, [])
  return (
    <View style={{ alignItems: 'center', padding: 12 }}>
      <Text style={[s.h, { fontSize: 14, color: C.gold }]}>{label}{'.'.repeat(dots)}</Text>
      {typeof progress === 'number' ? (
        <View style={s.barOuter}><View style={[s.barInner, { width: `${Math.max(3, Math.min(100, progress))}%` }]} /></View>
      ) : null}
    </View>
  )
}

export function Blink({ children, style }: { children: React.ReactNode; style?: any }) {
  const v = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 0, duration: 500, useNativeDriver: true }), Animated.timing(v, { toValue: 1, duration: 500, useNativeDriver: true })]))
    a.start(); return () => a.stop()
  }, [v])
  return <Animated.View style={[{ opacity: v }, style]}>{children}</Animated.View>
}

export function NetBadge() {
  const st = useStore((x) => x.stats)
  return (
    <View style={s.net}>
      <View style={[s.dot, { backgroundColor: st.connections ? C.green : C.dim }]} />
      <Text style={s.netText}>{st.connections ? `${st.online} PEERS · P2P` : 'SEARCHING SWARM'}</Text>
    </View>
  )
}

const TABS = [
  { path: '/hub', label: 'Campfire' },
  { path: '/friends', label: 'Friends' },
  { path: '/me', label: 'Me' },
]
function TabBar() {
  const path = usePathname()
  const waved = useStore((x) => Object.keys(x.wavedAtMe).length)
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: C.panel, borderTopWidth: 3, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row' }}>
        {TABS.map((t) => {
          const on = path.startsWith(t.path)
          return (
            <Pressable key={t.path} onPress={() => router.replace(t.path as never)} style={[s.tab, on && { backgroundColor: C.panel2 }]}>
              <Text style={[s.tabText, on && { color: C.gold }]}>{t.label}{t.path === '/friends' && waved ? ` (${waved})` : ''}</Text>
              {on ? <View style={{ height: 3, backgroundColor: C.gold, alignSelf: 'stretch', marginTop: 6 }} /> : null}
            </Pressable>
          )
        })}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  h: { fontFamily: FONT, fontWeight: '700', color: C.text, textTransform: 'uppercase', letterSpacing: 1.5, textShadowColor: '#000', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 },
  p: { fontFamily: FONT, color: C.text, fontSize: 13, lineHeight: 19 },
  panel: { backgroundColor: C.panel, borderWidth: 2, borderColor: C.line, padding: 12 },
  panelTitle: { fontFamily: FONT, fontWeight: '700', color: C.gold, fontSize: 12, letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
  shadow: { position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, backgroundColor: '#000' },
  btn: { borderWidth: 2, borderColor: C.line, paddingVertical: 11, paddingHorizontal: 12, alignItems: 'center' },
  btnText: { fontFamily: FONT, fontWeight: '700', color: '#fff', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' },
  tag: { borderWidth: 2, borderColor: C.dim, paddingVertical: 5, paddingHorizontal: 8, marginRight: 6, marginBottom: 6, backgroundColor: '#050a26' },
  tagText: { fontFamily: FONT, fontWeight: '700', color: C.sub, fontSize: 11, textTransform: 'uppercase' },
  field: { fontFamily: FONT, color: C.text, fontSize: 14, borderWidth: 2, borderColor: C.line, backgroundColor: '#050a26', padding: 10 },
  barOuter: { marginTop: 8, width: 200, height: 12, borderWidth: 2, borderColor: C.line, backgroundColor: '#050a26' },
  barInner: { height: '100%', backgroundColor: C.gold },
  tab: { flex: 1, alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  tabText: { fontFamily: FONT, fontWeight: '700', color: C.sub, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  toast: { position: 'absolute', left: 14, right: 14, top: 60, backgroundColor: C.panel2, borderWidth: 2, borderColor: C.gold, padding: 10 },
  net: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: C.dim, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#050a26' },
  dot: { width: 8, height: 8, marginRight: 6 },
  netText: { fontFamily: FONT, fontWeight: '700', color: C.sub, fontSize: 10, letterSpacing: 1 },
})
