export type CardType = 'default' | 'event'

export function normalizeCardType(v: unknown): CardType | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().toLowerCase()
  if (!t) return undefined
  if (t === 'event' || t === 'events') return 'event'
  if (t === 'default' || t === 'card' || t === 'character' || t === 'person') {
    return 'default'
  }
  return undefined
}
