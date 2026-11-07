// Campfire's AI features. Everything runs on the phone through QVAC: no cloud, no API keys.
//
//   voice -> text ............ transcribe()  Whisper tiny
//   answers -> profile ....... completion()  Qwen3 0.6B with a strict JSON schema
//   profile -> vector ........ embed()       EmbeddingGemma 300M (only the vector is shared, never the answers)
//   "what you have in common"  completion()
//   quests ................... completion()
//   wingman lines ............ completion() + decide() privacy check
//   chat translation ......... translate()   Bergamot NMT, pivoting through English
//   safety filter ............ decide()      Laya System One model: typed answers + calibrated confidence
//
// Every function has an offline fallback so the app never dead-ends if a model is still downloading.
import { completion, decide, embed, transcribe, translate } from '@qvac/sdk'
import { model, translationModel } from './models'
import * as L from './logic'
import type { PublicProfile, Verdict } from './logic'

export type Source = 'qvac' | 'fallback'
const NO_THINK = ' /no_think'

async function json<T>(system: string, user: string, schema: object, name: string, predict = 220): Promise<T> {
  const modelId = await model('llm')
  const run = completion({
    modelId,
    history: [{ role: 'system', content: system + NO_THINK }, { role: 'user', content: user }],
    stream: false,
    responseFormat: { type: 'json_schema', json_schema: { name, schema } },
    generationParams: { temp: 0.7, predict, reasoning_budget: 0 },
  } as never) as unknown as { final: Promise<{ contentText: string }> }
  const out = await run.final
  return JSON.parse(out.contentText.trim()) as T
}

async function text(system: string, user: string, predict = 90): Promise<string> {
  const modelId = await model('llm')
  const run = completion({
    modelId,
    history: [{ role: 'system', content: system + NO_THINK }, { role: 'user', content: user }],
    stream: false,
    generationParams: { temp: 0.8, predict, reasoning_budget: 0 },
  } as never) as unknown as { final: Promise<{ contentText: string }> }
  return (await run.final).contentText.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// ------------------------------------------------------------------ voice
export async function voiceToText(fileUri: string): Promise<{ text: string; source: Source }> {
  try {
    const modelId = await model('stt')
    const path = fileUri.replace(/^file:\/\//, '')
    const out = await transcribe({ modelId, audioChunk: { type: 'filePath', value: path } } as never)
    return { text: String(out).trim(), source: 'qvac' }
  } catch {
    return { text: '', source: 'fallback' }
  }
}

// ------------------------------------------------------------------ onboarding
export type Built = { bio: string; tags: string[]; lookingFor: string[]; avatarHints: Record<string, number>; source: Source }

export async function buildProfile(answers: Record<string, string>): Promise<Built> {
  const all = Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join('\n')
  const hints = L.avatarHints(all)
  try {
    const r = await json<{ bio: string; tags: string[]; lookingFor: string[] }>(
      'You help a shy university student introduce themselves on a friendship app. Write a warm, honest one-sentence bio in first person (max 25 words), ' +
        'pick 3-6 short lowercase interest tags, and 1-3 short things they are looking for (e.g. "gym buddy", "people to cook with"). ' +
        'Never include addresses, phone numbers, health details or anything private.',
      all,
      { type: 'object', properties: { bio: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, lookingFor: { type: 'array', items: { type: 'string' } } }, required: ['bio', 'tags', 'lookingFor'], additionalProperties: false },
      'profile'
    )
    const tags = [...new Set([...(r.tags || []), ...L.fallbackTags(all)].map((t) => t.toLowerCase().trim()).filter(Boolean))].slice(0, 6)
    return { bio: r.bio.slice(0, 200), tags, lookingFor: (r.lookingFor || []).slice(0, 3), avatarHints: hints, source: 'qvac' }
  } catch {
    const tags = L.fallbackTags(all)
    return { bio: tags.length ? `Into ${tags.slice(0, 3).join(', ')}. Say hi!` : 'New here. Say hi!', tags, lookingFor: ['new friends'], avatarHints: hints, source: 'fallback' }
  }
}

/** Embeds the PRIVATE answers + public bio locally. Only the resulting vector is published. */
export async function embedProfile(p: { bio?: string; tags?: string[]; lookingFor?: string[]; answers?: Record<string, string> }): Promise<number[] | null> {
  try {
    const modelId = await model('embed')
    const { embedding } = await embed({ modelId, text: L.profileText(p).slice(0, 2000) })
    return embedding as number[]
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ matching explanations + quests
export async function commonGround(me: PublicProfile, them: PublicProfile): Promise<{ summary: string; starters: string[]; source: Source }> {
  try {
    const r = await json<{ summary: string; starters: string[] }>(
      'You are a friendly matchmaker for new friends (never romance). In one short sentence, say what these two people have in common. Then give 2 easy, specific opening questions. Keep it light.',
      `Person A: ${JSON.stringify(pick(me))}\nPerson B: ${JSON.stringify(pick(them))}`,
      { type: 'object', properties: { summary: { type: 'string' }, starters: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'starters'], additionalProperties: false },
      'common'
    )
    return { summary: r.summary, starters: r.starters.slice(0, 2), source: 'qvac' }
  } catch {
    return { ...L.fallbackCommonGround(me, them), source: 'fallback' }
  }
}

export type Quest = { title: string; detail: string; where?: string; when?: string; source: Source }

export async function makeQuest(people: PublicProfile[], city?: string): Promise<Quest> {
  const shared = people.slice(1).reduce((acc, p) => acc.filter((t) => (p.tags || []).includes(t)), people[0]?.tags || [])
  try {
    const r = await json<{ title: string; detail: string; where: string; when: string }>(
      'Invent ONE small, cheap, safe, real-world quest for a group of new friends to do together this week. It must happen in a public place, take under 2 hours, cost under £5, ' +
        'and give them something to talk about. Title max 8 words. Detail max 30 words. Suggest a type of place (not an exact address) and a time.',
      `City: ${city || 'their university city'}\nPeople: ${JSON.stringify(people.map(pick))}\nShared interests: ${shared.join(', ') || 'none yet'}`,
      { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, where: { type: 'string' }, when: { type: 'string' } }, required: ['title', 'detail', 'where', 'when'], additionalProperties: false },
      'quest'
    )
    return { ...r, source: 'qvac' }
  } catch {
    return { ...L.fallbackQuest(shared), source: 'fallback' }
  }
}

// ------------------------------------------------------------------ wingman (avatar-to-avatar)
/**
 * My avatar speaks for me. It can see my PRIVATE prompt answers (they never leave the phone),
 * but every line is checked by the System One model before it is sent, so nothing sensitive leaks.
 */
export async function wingmanLine(args: { mine: PublicProfile; privateAnswers: Record<string, string>; theirs: PublicProfile; history: { who: 'me' | 'them'; text: string }[]; turn: number }): Promise<{ text: string; source: Source }> {
  const { mine, privateAnswers, theirs, history, turn } = args
  try {
    const line = await text(
      `You are ${mine.name}'s cute PS1-style avatar on a friendship app, chatting with another avatar to see if your humans would be friends. ` +
        'Speak about "my human" in third person, max 22 words, playful and kind, one message only. Share interests and what they are looking for. ' +
        'Never reveal anything sensitive (health, address, family problems, money). ' +
        (turn >= 3 ? 'Wrap up by suggesting the humans meet for a small quest.' : 'Ask a question back.'),
      `About my human (public): ${JSON.stringify(pick(mine))}\nAbout my human (private, use gently): ${JSON.stringify(privateAnswers)}\n` +
        `The other avatar's human: ${JSON.stringify(pick(theirs))}\nConversation so far:\n${history.map((h) => (h.who === 'me' ? 'Me: ' : 'Them: ') + h.text).join('\n') || '(you speak first)'}`
    )
    const clean = line.replace(/^["']|["']$/g, '').split('\n')[0].slice(0, 200)
    const leak = await privacyLeak(clean)
    if (leak) return { text: L.fallbackWingman(mine, theirs, turn), source: 'fallback' }
    return { text: clean, source: 'qvac' }
  } catch {
    return { text: L.fallbackWingman(mine, theirs, turn), source: 'fallback' }
  }
}

async function privacyLeak(line: string): Promise<boolean> {
  try {
    const modelId = await model('decide')
    const r = (await decide({ modelId, state: line, questions: { leak: { type: 'noul', instructions: 'The message reveals sensitive personal information such as an address, phone number, health condition or money problems.' } } } as never)) as { answers: Record<string, { noul: number }> }
    return r.answers.leak.noul > 0.6
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ safety filter (System One)
/** Runs on the RECEIVER's phone for every incoming message. No moderator, no server. */
export async function checkMessage(textIn: string): Promise<Verdict> {
  try {
    const modelId = await model('decide')
    const r = (await decide({
      modelId,
      state: textIn.slice(0, 800),
      questions: {
        kind: { type: 'choice', instructions: 'What best describes this chat message sent to a new friend?', criteria: [...L.SAFETY_LABELS] },
        personal: { type: 'noul', instructions: 'The message asks for private details like a home address, bank details, passwords or photos.' },
      },
    } as never)) as { answers: Record<string, { choice?: string; confidence: number; noul?: number }> }
    const k = r.answers.kind
    return L.verdictFrom(String(k.choice), k.confidence, r.answers.personal.noul ?? 0, 'qvac')
  } catch {
    return L.fallbackSafety(textIn)
  }
}

// ------------------------------------------------------------------ translation
export async function translateText(textIn: string, from: string, to: string): Promise<{ text: string; source: Source } | null> {
  if (!textIn.trim() || from === to) return null
  try {
    const hop = async (t: string, a: string, b: string) => {
      const mp = translationModel(a, b)
      if (!mp) throw new Error(`no ${a}->${b}`)
      const modelId = await mp
      return (await translate({ modelId, text: t, from: a, to: b, modelType: 'nmtcpp-translation', stream: false } as never).text).trim()
    }
    let out = textIn
    if (from !== 'en' && to !== 'en') out = await hop(await hop(out, from, 'en'), 'en', to)
    else out = await hop(out, from, to)
    return { text: out, source: 'qvac' }
  } catch {
    return null
  }
}

function pick(p: PublicProfile) {
  return { name: p.name, bio: p.bio, tags: p.tags, lookingFor: p.lookingFor, course: p.course, city: p.city }
}
