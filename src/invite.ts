// campfire://join?c=<community>&by=<inviter id>
export function parseInvite(data: string): { name: string; invitedBy: string | null } | null {
  const m = /^campfire:\/\/join\?(.*)$/.exec(data.trim())
  if (!m) return null
  const q = Object.fromEntries(m[1].split('&').map((kv) => kv.split('=').map(decodeURIComponent)))
  return q.c ? { name: q.c, invitedBy: q.by || null } : null
}

