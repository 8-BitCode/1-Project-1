// Every model Campfire uses, all run on the phone through QVAC.
// Model files are fetched peer-to-peer from the QVAC registry (Hypercore blobs) on first use and cached.
import {
  loadModel,
  unloadModel,
  QWEN3_600M_INST_Q4,
  EMBEDDINGGEMMA_300M_Q4_0,
  LAYA_MULTILINGUAL_322M_Q8_0,
  WHISPER_TINY,
} from '@qvac/sdk'
import * as Q from '@qvac/sdk'

export type Role = 'llm' | 'embed' | 'decide' | 'stt'

/** Swap QWEN3_600M for QWEN3_1_7B_INST_Q4 on newer phones for better writing (about 2x slower). */
const SPECS: Record<Role, { src: unknown; modelType?: string; modelConfig?: Record<string, unknown>; label: string }> = {
  llm: { src: QWEN3_600M_INST_Q4, label: 'Qwen3 0.6B (writing, quests, wingman)', modelConfig: { ctx_size: 4096 } },
  embed: { src: EMBEDDINGGEMMA_300M_Q4_0, label: 'EmbeddingGemma 300M (matching)' },
  decide: { src: LAYA_MULTILINGUAL_322M_Q8_0, modelType: 'llamacpp-decision', modelConfig: { device: 'cpu' }, label: 'Laya 322M System One (safety)' },
  stt: { src: WHISPER_TINY, modelType: 'whispercpp-transcription', modelConfig: { language: 'auto', strategy: 'greedy', no_timestamps: true, temperature: 0 }, label: 'Whisper tiny (voice)' },
}

export type Progress = { role: string; label: string; percentage: number }
type Listener = (p: Progress) => void
const listeners = new Set<Listener>()
export function onModelProgress(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
function report(role: string, label: string, percentage: number) { listeners.forEach((l) => l({ role, label, percentage })) }

const loaded = new Map<string, Promise<string>>()
const failed = new Set<string>()

async function load(key: string, label: string, opts: Record<string, unknown>) {
  if (!loaded.has(key)) {
    const p = loadModel({
      ...opts,
      onProgress: (pr: { percentage: number }) => report(key, label, pr.percentage),
    } as never).then((id: string) => { report(key, label, 100); return id })
    p.catch(() => { loaded.delete(key); failed.add(key) })
    loaded.set(key, p)
  }
  return loaded.get(key)!
}

export function model(role: Role): Promise<string> {
  const s = SPECS[role]
  return load(role, s.label, { modelSrc: s.src, modelType: s.modelType, modelConfig: s.modelConfig })
}

// ---- translation: Bergamot pairs, pivoting through English (zh -> en -> es) ----
const PAIRS = new Set(Object.keys(Q).filter((k) => /^BERGAMOT_[A-Z]+_[A-Z]+$/.test(k)))
export const TRANSLATABLE = [...new Set([...PAIRS].map((k) => k.split('_')[1].toLowerCase()))].filter((l) => l !== 'en').sort()

export function translationModel(from: string, to: string): Promise<string> | null {
  const name = `BERGAMOT_${from.toUpperCase()}_${to.toUpperCase()}`
  if (!PAIRS.has(name)) return null
  return load(name, `Bergamot ${from}→${to}`, {
    modelSrc: (Q as Record<string, unknown>)[name],
    modelType: 'nmtcpp-translation',
    modelConfig: { engine: 'Bergamot', from, to },
  })
}

export function modelStatus() {
  return (Object.keys(SPECS) as Role[]).map((r) => ({ role: r, label: SPECS[r].label, loaded: loaded.has(r) && !failed.has(r), failed: failed.has(r) }))
}

/** Warm up the models the demo needs, in the background, so nothing loads live on stage. */
export function warmUp(roles: Role[] = ['decide', 'embed', 'llm']) {
  return Promise.allSettled(roles.map((r) => model(r)))
}

export async function unloadAll() {
  for (const p of loaded.values()) { try { await unloadModel({ modelId: await p }) } catch {} }
  loaded.clear()
}
