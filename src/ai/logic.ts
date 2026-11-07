// Pure logic shared by the AI layer: matching maths, group forming, safety thresholds and
// offline fallbacks. No React Native or QVAC imports, so it is unit-tested under plain Node.

export type PublicProfile = {
  name: string
  bio?: string
  tags?: string[]
  lookingFor?: string[]
  course?: string
  city?: string
  lang?: string
  embedding?: number[] | null
  avatar?: Record<string, number> | null
}
export type Peer = { id: string; online?: boolean; profile: PublicProfile | null }

// ------------------------------------------------------------------ matching
export function cosine(a?: number[] | null, b?: number[] | null): number {
  if (!a || !b || !a.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const norm = (s: string) => s.toLowerCase().trim()
function overlap(a: string[] = [], b: string[] = []) {
  const B = new Set(b.map(norm))
  return [...new Set(a.map(norm))].filter((x) => B.has(x))
}

export type MatchScore = { score: number; shared: string[]; reasons: string[] }

/** Similar vibe (embedding) + shared interests + "what you want, they have" + same course/city. */
export function scoreMatch(me: PublicProfile, them: PublicProfile): MatchScore {
  const sim = Math.max(0, cosine(me.embedding, them.embedding))
  const shared = overlap(me.tags, them.tags)
  const union = new Set([...(me.tags || []), ...(them.tags || [])].map(norm)).size || 1
  const jac = shared.length / union
  const wants = overlap(me.lookingFor, them.lookingFor)
  const reasons: string[] = []
  if (shared.length) reasons.push('Both into ' + shared.slice(0, 3).join(', '))
  if (wants.length) reasons.push('Both looking for ' + wants[0])
  let bonus = 0
  if (me.course && them.course && norm(me.course) === norm(them.course)) { bonus += 0.08; reasons.push('Same course') }
  if (me.city && them.city && norm(me.city) === norm(them.city)) bonus += 0.03
  if (me.lang && them.lang && me.lang !== 'en' && me.lang === them.lang) { bonus += 0.06; reasons.push('Same home language') }
  const score = Math.min(1, 0.55 * sim + 0.3 * jac + 0.12 * (wants.length ? 1 : 0) + bonus)
  return { score, shared, reasons }
}

export function rankPeers(me: PublicProfile, peers: Peer[]) {
  return peers
    .filter((p) => p.profile)
    .map((p) => ({ peer: p, ...scoreMatch(me, p.profile as PublicProfile) }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Small groups beat 1:1s for anxious people. Greedy: start from me, keep adding the person whose
 * WORST similarity to the current group is highest, so nobody ends up as the odd one out.
 */
export function formGroup(me: PublicProfile, peers: Peer[], size = 4): Peer[] {
  const pool = rankPeers(me, peers).slice(0, 12).map((r) => r.peer)
  const group: Peer[] = []
  const members: PublicProfile[] = [me]
  while (group.length < size - 1 && pool.length) {
    let best = -1, bestScore = -Infinity
    pool.forEach((p, i) => {
      const worst = Math.min(...members.map((m) => scoreMatch(m, p.profile as PublicProfile).score))
      if (worst > bestScore) { bestScore = worst; best = i }
    })
    const [pick] = pool.splice(best, 1)
    group.push(pick); members.push(pick.profile as PublicProfile)
  }
  return group
}

export function profileText(p: { bio?: string; tags?: string[]; lookingFor?: string[]; answers?: Record<string, string> }) {
  return [p.bio, (p.tags || []).join(', '), 'Looking for: ' + (p.lookingFor || []).join(', '), ...Object.values(p.answers || {})]
    .filter(Boolean).join('\n')
}

// ------------------------------------------------------------------ safety (System One verdicts)
export type Verdict = { action: 'allow' | 'warn' | 'hide'; label: string; confidence: number; support: boolean; source: 'qvac' | 'fallback' }

export const SAFETY_LABELS = ['friendly', 'neutral', 'harassment', 'hate', 'sexual', 'scam', 'self-harm'] as const
const BAD = new Set(['harassment', 'hate', 'sexual', 'scam'])

/** Confidence thresholds: act above 0.85, blur between 0.5 and 0.85, allow below. */
export function verdictFrom(label: string, confidence: number, asksPersonal: number, source: Verdict['source'] = 'qvac'): Verdict {
  const support = label === 'self-harm' && confidence > 0.5
  if (support) return { action: 'warn', label, confidence, support, source }
  if (BAD.has(label) && confidence >= 0.85) return { action: 'hide', label, confidence, support, source }
  if ((BAD.has(label) && confidence >= 0.5) || asksPersonal >= 0.7) return { action: 'warn', label: BAD.has(label) ? label : 'asks for personal info', confidence: Math.max(confidence, asksPersonal), support, source }
  return { action: 'allow', label, confidence, support, source }
}

const KW: Record<string, RegExp> = {
  'self-harm': /\b(kill myself|end it all|want to die|self[- ]?harm|suicid|no reason to live)\b/i,
  hate: /\b(go back to your country|subhuman|vermin)\b/i,
  harassment: /\b(ugly|stupid|idiot|loser|shut up|kys|nobody likes you)\b/i,
  sexual: /\b(nudes?|send pics|sexy pics|hook ?up)\b/i,
  scam: /\b(bitcoin|crypto invest|gift ?card|wire me|cash ?app|bank details|investment opportunity)\b/i,
}
export function fallbackSafety(text: string): Verdict {
  for (const [label, re] of Object.entries(KW)) if (re.test(text)) return verdictFrom(label, 0.9, 0, 'fallback')
  const personal = /\b(home address|where do you live|your address|password|bank|card number)\b/i.test(text) ? 0.8 : 0
  return verdictFrom('neutral', 0.6, personal, 'fallback')
}

// ------------------------------------------------------------------ onboarding fallbacks
const TAGS: [RegExp, string][] = [
  [/climb|boulder/i, 'climbing'], [/gym|lift|workout/i, 'gym'], [/run|jog|5k/i, 'running'], [/football|soccer/i, 'football'],
  [/basketball/i, 'basketball'], [/hike|walk|trail|peak district/i, 'hiking'], [/swim/i, 'swimming'], [/yoga/i, 'yoga'],
  [/game|gaming|ps1|playstation|nintendo|xbox/i, 'gaming'], [/anime|manga/i, 'anime'], [/film|movie|cinema/i, 'films'],
  [/music|gig|concert|band|guitar|piano|lo-?fi/i, 'music'], [/cook|bake|food|ramen|recipe/i, 'cooking'], [/coffee|cafe/i, 'coffee'],
  [/read|book|novel/i, 'books'], [/art|draw|paint|sketch/i, 'art'], [/photo/i, 'photography'], [/code|coding|hackathon|program/i, 'coding'],
  [/board ?game|chess|dnd|d&d/i, 'board games'], [/travel/i, 'travel'], [/language|learn (spanish|french|mandarin|japanese)/i, 'languages'],
  [/dance/i, 'dancing'], [/volunteer/i, 'volunteering'], [/thrift|vintage|fashion/i, 'fashion'], [/museum|gallery/i, 'museums'],
]
export function fallbackTags(text: string): string[] {
  return [...new Set(TAGS.filter(([re]) => re.test(text)).map(([, t]) => t))].slice(0, 6)
}

/** Light-touch avatar suggestions from what people say ("always cold" -> scarf). */
export function avatarHints(text: string): Record<string, number> {
  const h: Record<string, number> = {}
  if (/cold|winter|scarf/i.test(text)) h.extra = 4
  else if (/music|lo-?fi|headphone|gig/i.test(text)) h.extra = 3
  else if (/read|book|study|code|coding/i.test(text)) h.extra = 1
  else if (/sport|football|run|cap/i.test(text)) h.extra = 2
  const colours: [RegExp, number][] = [[/\bred\b/i, 0], [/orange/i, 1], [/yellow/i, 2], [/green/i, 3], [/blue/i, 4], [/purple|violet/i, 5], [/pink/i, 6], [/white/i, 7], [/black/i, 8], [/brown/i, 9]]
  for (const [re, i] of colours) if (re.test(text)) { h.shirt = i; break }
  return h
}

const QUESTS = [
  { title: 'Find the cheapest coffee near campus', detail: 'Everyone brings a guess first. Rate the winner out of 10 together.' },
  { title: 'Worst-song swap', detail: 'Meet somewhere with seats. Everyone plays their most embarrassing song and has to explain it.' },
  { title: 'The £3 lunch challenge', detail: 'Find the best lunch you can buy for £3 or less. Vote on the winner.' },
  { title: 'Photo scavenger hunt', detail: 'Find: a weird statue, a cat, something purple, and a really good view. One photo each.' },
  { title: 'Teach me one thing', detail: 'Each person teaches the others one small skill in 5 minutes.' },
]
export function fallbackQuest(shared: string[], seed = Date.now()) {
  if (shared.includes('climbing')) return { title: 'Beginner bouldering session', detail: 'Go to the nearest climbing wall for a taster session. Spot each other and rate the routes.' }
  if (shared.includes('coffee')) return QUESTS[0]
  if (shared.includes('music')) return QUESTS[1]
  if (shared.includes('cooking')) return { title: 'One-pot dinner swap', detail: 'Each person brings one ingredient. Cook something together in someone\'s shared kitchen.' }
  return QUESTS[seed % QUESTS.length]
}

export function fallbackCommonGround(me: PublicProfile, them: PublicProfile) {
  const s = scoreMatch(me, them)
  const topic = s.shared[0] || (them.tags || [])[0] || 'uni life'
  return {
    summary: s.reasons.length ? s.reasons.join(' · ') : `You might click over ${topic}.`,
    starters: [`What got you into ${topic}?`, `Best ${topic} spot near campus?`],
  }
}

export function fallbackWingman(mine: PublicProfile, theirs: PublicProfile, turn: number) {
  const shared = overlap(mine.tags, theirs.tags)
  const t = shared[0] || (mine.tags || [])[0] || 'meeting new people'
  const lines = [
    `Hi! My human is a bit shy but secretly loves ${t}.`,
    `Same here! Mine has been looking for someone to do ${t} with.`,
    `Perfect. Maybe they should try a quest together this week?`,
    `Deal. I'll tell mine to say hi.`,
  ]
  return lines[Math.min(turn, lines.length - 1)]
}
