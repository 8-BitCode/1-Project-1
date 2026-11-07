// Hosts the PS1 three.js renderer (web/creator.html, inlined with three.js, fully offline) in a WebView.
// Modes: "creator" (full editor), "portrait" (one spinning avatar), "hub" (campfire scene with everyone).
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { View, ViewStyle } from 'react-native'
import { WebView as RNWebView } from 'react-native-webview'

// react-native-webview's class typings don't line up with React 19's JSX types yet.
const WebView: any = RNWebView
import { CREATOR_HTML } from './creatorHtml'

export type AvatarMsg =
  | { type: 'ready'; mode: string }
  | { type: 'avatar'; config: Record<string, number>; png: string }
  | { type: 'tap'; id: string }

export type HubPerson = { id: string; name: string; config: any; me?: boolean; highlight?: boolean }
export type AvatarViewHandle = { send: (msg: object) => void }

type Props = {
  mode: 'creator' | 'portrait' | 'hub'
  config?: Record<string, number> | null
  people?: HubPerson[]
  onMessage?: (m: AvatarMsg) => void
  style?: ViewStyle
}

export const AvatarView = forwardRef<AvatarViewHandle, Props>(function AvatarView({ mode, config, people, onMessage, style }, ref) {
  const web = useRef<any>(null)
  // The init payload is baked in once; later updates go through postMessage-style injection.
  const html = useMemo(() => {
    const init = JSON.stringify({ mode, config: config || undefined, people: people || [] }).replace(/</g, '\\u003c')
    return CREATOR_HTML.replace('<head>', `<head><script>window.CAMPFIRE_INIT=${init};</script>`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useImperativeHandle(ref, () => ({
    send: (msg: object) => {
      const js = `window.campfire && window.campfire.receive(${JSON.stringify(JSON.stringify(msg))}); true;`
      web.current?.injectJavaScript(js)
    },
  }))

  return (
    <View style={[{ flex: 1, backgroundColor: '#000' }, style]}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1, backgroundColor: '#000' }}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        // Fully offline: the page has three.js inlined and makes no network requests.
        onShouldStartLoadWithRequest={(r: { url: string }) => r.url.startsWith('about:') || r.url.startsWith('data:')}
        onMessage={(e: { nativeEvent: { data: string } }) => {
          try { onMessage?.(JSON.parse(e.nativeEvent.data)) } catch {}
        }}
      />
    </View>
  )
})
