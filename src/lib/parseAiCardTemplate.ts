import type { CardThemeColors } from '../types/cardTheme'
import { normalizeCardType, type CardType } from '../types/cardType'

export type AiTemplateFields = {
  title?: string
  body?: string
  tag?: string
  cardType?: CardType
  theme?: Partial<CardThemeColors>
}

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/

function pickHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return HEX_COLOR.test(t) ? t : undefined
}

function pickStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function parseThemeObject(src: Record<string, unknown>): Partial<CardThemeColors> {
  const theme: Partial<CardThemeColors> = {}
  const a = pickHex(src.accent)
  if (a) theme.accent = a
  const cb = pickHex(src.cardBackground)
  if (cb) theme.cardBackground = cb
  const ta = pickHex(src.titleOnAccent)
  if (ta) theme.titleOnAccent = ta
  const bt = pickHex(src.bodyText)
  if (bt) theme.bodyText = bt
  const ts = pickHex(src.tagStroke)
  if (ts) theme.tagStroke = ts
  const tb = pickHex(src.tagBackground)
  if (tb) theme.tagBackground = tb
  const ip = pickHex(src.imagePlaceholder)
  if (ip) theme.imagePlaceholder = ip
  return theme
}

function walkString(
  s: string,
  start: number,
  open: string,
  close: string,
): string | null {
  if (s[start] !== open) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function balancedJsonFrom(s: string, start: number): string | null {
  return walkString(s, start, '{', '}')
}

function balancedArrayFrom(s: string, start: number): string | null {
  return walkString(s, start, '[', ']')
}

function extractAiJsonString(raw: string): string {
  const t = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```/im.exec(t)
  if (fence) {
    const inner = fence[1].trim()
    if (inner.startsWith('{')) {
      const bal = balancedJsonFrom(inner, 0)
      if (bal) return bal
    }
    if (inner.startsWith('[')) {
      const bal = balancedArrayFrom(inner, 0)
      if (bal) return bal
    }
  }
  if (t.startsWith('{')) {
    const bal = balancedJsonFrom(t, 0)
    if (bal) return bal
  }
  if (t.startsWith('[')) {
    const bal = balancedArrayFrom(t, 0)
    if (bal) return bal
  }
  const objStart = t.indexOf('{')
  const arrStart = t.indexOf('[')
  const start =
    objStart < 0
      ? arrStart
      : arrStart < 0
        ? objStart
        : Math.min(objStart, arrStart)
  if (start < 0) {
    throw new Error(
      'No JSON found (object or array). Use a ```json ... ``` block with title, body, tag fields, or an array of cards.',
    )
  }
  if (t[start] === '{') {
    const bal = balancedJsonFrom(t, start)
    if (bal) return bal
  } else {
    const bal = balancedArrayFrom(t, start)
    if (bal) return bal
  }
  throw new Error('Could not extract valid JSON from the response.')
}

function fieldsFromRecord(o: Record<string, unknown>): AiTemplateFields {
  const title = pickStr(o.title ?? o.heading ?? o.nazva)
  const body = pickStr(
    o.body ?? o.description ?? o.opys ?? o.text ?? o.content,
  )
  const tag = pickStr(o.tag ?? o.badge ?? o.bedzh ?? o.label)
  const cardType = normalizeCardType(o.type ?? o.cardType ?? o.kind ?? o.category)

  const fromFlat = parseThemeObject(o)
  const colors = o.colors
  const fromNested =
    colors !== null && typeof colors === 'object' && !Array.isArray(colors)
      ? parseThemeObject(colors as Record<string, unknown>)
      : {}
  const merged = { ...fromFlat, ...fromNested }
  const theme =
    Object.keys(merged).length > 0 ? merged : undefined

  return {
    title,
    body,
    tag,
    cardType,
    theme,
  }
}

function parseOneCardObject(obj: unknown, indexLabel: string): AiTemplateFields {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`Each card must be an object { ... } (${indexLabel}).`)
  }
  return fieldsFromRecord(obj as Record<string, unknown>)
}

/**
 * Parses chat response: a single card object, `{ "cards": [ ... ] }`, or array `[ {...}, ... ]`.
 * Returns list of cards (at least one element).
 */
export function parseAiCardTemplate(raw: string): AiTemplateFields[] {
  const jsonStr = extractAiJsonString(raw)
  let root: unknown
  try {
    root = JSON.parse(jsonStr)
  } catch {
    throw new Error('AI response JSON is invalid (syntax error).')
  }

  if (Array.isArray(root)) {
    if (root.length === 0) {
      throw new Error('Cards array is empty; provide at least one object.')
    }
    return root.map((item, i) => parseOneCardObject(item, `#${i + 1}`))
  }

  if (root === null || typeof root !== 'object') {
    throw new Error('JSON root must be an object or an array.')
  }

  const o = root as Record<string, unknown>
  const cardsRaw = o.cards
  if (Array.isArray(cardsRaw)) {
    if (cardsRaw.length === 0) {
      throw new Error('"cards" field is empty; add at least one card.')
    }
    return cardsRaw.map((item, i) => parseOneCardObject(item, `cards[${i}]`))
  }

  return [fieldsFromRecord(o)]
}

/** Prompt for copying into ChatGPT / Claude / other chat (English). */
export const AI_CARD_PROMPT_EN = `You are helping fill a card template for an app that exports cards to Excalidraw.

Return ONLY JSON (no explanations before or after).

A single card is an object:
{
  "title": "short title",
  "body": "description; paragraphs separated with \\n\\n",
  "type": "default or event",
  "tag": "badge or \\"\\"",
  "colors": {
    "accent": "#D92323",
    "cardBackground": "#f8f9fa",
    "titleOnAccent": "#FFFFFF",
    "bodyText": "#1e1e1e",
    "tagStroke": "#c92a2a",
    "tagBackground": "#ffffff",
    "imagePlaceholder": "#ebfbee"
  }
}

For multiple cards, return either array [ {...}, {...} ] or one object with "cards": [ {...}, ... ].
Shared "colors" can be defined in the first card or once at root level (for a single object).

Rules:
- Colors must be only #RGB or #RRGGBB.
- "type" is optional; supported values: "default", "event".
- "colors" and "tag" are optional; tag may be "".
- Do not provide image data; user will add image files manually.

Topic / list of characters or cards (to be inserted by user):`
