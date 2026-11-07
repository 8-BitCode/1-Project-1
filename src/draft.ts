// Onboarding draft passed between the prompts screen and the avatar creator.
export type Draft = {
  name: string
  course: string
  city: string
  answers: Record<string, string>
  bio: string
  tags: string[]
  lookingFor: string[]
  avatarHints: Record<string, number>
}
export const draft: Draft = { name: '', course: '', city: '', answers: {}, bio: '', tags: [], lookingFor: [], avatarHints: {} }
