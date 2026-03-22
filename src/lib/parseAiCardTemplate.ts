import type { CardThemeColors } from '../types/cardTheme'

export type AiTemplateFields = {
  title?: string
  body?: string
  tag?: string
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
      'Не знайдено JSON (об’єкт або масив). Використайте ```json … ``` з полями title, body, tag або масив карток.',
    )
  }
  if (t[start] === '{') {
    const bal = balancedJsonFrom(t, start)
    if (bal) return bal
  } else {
    const bal = balancedArrayFrom(t, start)
    if (bal) return bal
  }
  throw new Error('Не вдалося виділити коректний JSON з відповіді.')
}

function fieldsFromRecord(o: Record<string, unknown>): AiTemplateFields {
  const title = pickStr(o.title ?? o.heading ?? o.nazva)
  const body = pickStr(
    o.body ?? o.description ?? o.opys ?? o.text ?? o.content,
  )
  const tag = pickStr(o.tag ?? o.badge ?? o.bedzh ?? o.label)

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
    theme,
  }
}

function parseOneCardObject(obj: unknown, indexLabel: string): AiTemplateFields {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`Кожна картка має бути об’єктом { … } (${indexLabel}).`)
  }
  return fieldsFromRecord(obj as Record<string, unknown>)
}

/**
 * Розбирає відповідь чату: один об’єкт картки, або `{ "cards": [ … ] }`, або масив `[ {...}, … ]`.
 * Повертає список карток (мінімум один елемент).
 */
export function parseAiCardTemplate(raw: string): AiTemplateFields[] {
  const jsonStr = extractAiJsonString(raw)
  let root: unknown
  try {
    root = JSON.parse(jsonStr)
  } catch {
    throw new Error('JSON у відповіді ШІ некоректний (синтаксис).')
  }

  if (Array.isArray(root)) {
    if (root.length === 0) {
      throw new Error('Масив карток порожній — потрібен хоча б один об’єкт.')
    }
    return root.map((item, i) => parseOneCardObject(item, `#${i + 1}`))
  }

  if (root === null || typeof root !== 'object') {
    throw new Error('Корінь JSON має бути об’єктом або масивом.')
  }

  const o = root as Record<string, unknown>
  const cardsRaw = o.cards
  if (Array.isArray(cardsRaw)) {
    if (cardsRaw.length === 0) {
      throw new Error('Поле "cards" порожнє — додайте хоча б одну картку.')
    }
    return cardsRaw.map((item, i) => parseOneCardObject(item, `cards[${i}]`))
  }

  return [fieldsFromRecord(o)]
}

/** Промпт для копіювання в ЧатGPT / Claude / інший чат (українською). */
export const AI_CARD_PROMPT_UK = `Ти допомагаєш заповнити шаблон карток для додатку, який експортує їх у Excalidraw.

Поверни ЛИШЕ JSON (без пояснень до і після).

Одна картка — об’єкт:
{
  "title": "коротка назва",
  "body": "опис; абзаци через \\n\\n",
  "tag": "бейдж або \\"\\"",
  "colors": {
    "accent": "#D92323",
    "cardBackground": "#f8f9fa",
    "titleOnAccent": "#FFFFFF",
    "bodyText": "#1e1e1e",
    "tagStroke": "#c92a2a",
    "imagePlaceholder": "#ebfbee"
  }
}

Кілька карток — або масив [ {...}, {...} ], або один об’єкт з полем "cards": [ {...}, ... ].
Спільні "colors" можна задати в першій картці або один раз у корені (якщо один об’єкт).

Правила:
- Кольори — лише #RGB або #RRGGBB.
- "colors" і "tag" опційні; tag може бути "".
- Зображення не вказуй — користувач додасть файли сам.

Тема / список персонажів або карток (встав користувач):`
