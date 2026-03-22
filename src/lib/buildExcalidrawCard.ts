import { generateNKeysBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import type {
  ExcalidrawClipboard,
  ExcalidrawElement,
  ExcalidrawFileData,
} from '../types/excalidraw'
import type { CardThemeColors } from '../types/cardTheme'
import { resolveCardTheme } from '../types/cardTheme'

const CARD_W = 750
const HEADER_H_MIN = 70

function excalId(): string {
  return nanoid(21)
}

async function sha1HexFromDataUrl(dataUrl: string): Promise<string> {
  const comma = dataUrl.indexOf(',')
  const b64 = dataUrl.slice(comma + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function loadImageDimensions(
  dataUrl: string,
): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Не вдалося прочитати зображення'))
    img.src = dataUrl
  })
}

function fitBox(
  nw: number,
  nh: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const r = Math.min(maxW / nw, maxH / nh, 1)
  return { w: nw * r, h: nh * r }
}

/**
 * Excalifont у Excalidraw трохи ширший за типовий system-ui; звужуємо доступну ширину
 * для переносів, щоб висота текстового блоку збігалася без «підрізання» до кліку.
 */
const WRAP_WIDTH_FUDGE = 0.88

/** Резерв, якщо немає canvas (SSR). */
function estimateLinesFallback(text: string, maxWidthPx: number, fontSize: number): number {
  const charsPerLine = Math.max(12, Math.floor(maxWidthPx / (fontSize * 0.48)))
  let lines = 0
  for (const para of text.split('\n')) {
    if (para.length === 0) {
      lines += 1
      continue
    }
    lines += Math.max(1, Math.ceil(para.length / charsPerLine))
  }
  return Math.max(lines, 1)
}

function canvasFont(size: number, weight: number | string = 400): string {
  return `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
}

/** Розбиває текст на рядки так само за логікою word-wrap (як наближено в canvas Excalidraw). */
function wrapTextToLines(
  text: string,
  maxWidthPx: number,
  fontSize: number,
  fontWeight: number | string = 400,
): string[] {
  const w = Math.max(40, maxWidthPx * WRAP_WIDTH_FUDGE)
  if (typeof document === 'undefined') {
    const n = estimateLinesFallback(text, maxWidthPx, fontSize)
    return Array.from({ length: n }, (_, i) => (i === 0 ? text : ''))
  }
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) {
    const n = estimateLinesFallback(text, maxWidthPx, fontSize)
    return Array.from({ length: n }, (_, i) => (i === 0 ? text : ''))
  }
  ctx.font = canvasFont(fontSize, fontWeight)
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width <= w) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      if (ctx.measureText(word).width <= w) {
        line = word
        continue
      }
      let acc = ''
      for (const ch of word) {
        const t = acc + ch
        if (ctx.measureText(t).width <= w) acc = t
        else {
          if (acc) out.push(acc)
          acc = ch
        }
      }
      line = acc
    }
    if (line) out.push(line)
  }
  return out.length > 0 ? out : ['']
}

function textBlockHeight(
  lineCount: number,
  fontSize: number,
  lineHeight: number,
  verticalPad = 12,
): number {
  return Math.max(lineCount, 1) * fontSize * lineHeight + verticalPad
}

export type CardInput = {
  title: string
  body: string
  tag?: string
  /** data URL (наприклад image/png;base64,...) або порожньо */
  imageDataUrl?: string | null
  originX?: number
  originY?: number
  /** Кольори з ШІ або вручну; не задані поля беруться з дефолту */
  theme?: Partial<CardThemeColors>
}

export type { CardThemeColors } from '../types/cardTheme'

export type BuildExcalidrawCardOptions = {
  /** Якщо задано, усі елементи картки отримають цей id у `groupIds` (одна група в Excalidraw). */
  groupId?: string
}

export async function buildExcalidrawCard(
  input: CardInput,
  buildOptions?: BuildExcalidrawCardOptions,
): Promise<ExcalidrawClipboard> {
  const theme = resolveCardTheme(input.theme)
  const gid = buildOptions?.groupId
  const groupIdsForEl = (): string[] => (gid ? [gid] : [])
  const ox = input.originX ?? 100
  const oy = input.originY ?? 100
  const now = Date.now()
  const elements: ExcalidrawElement[] = []
  const files: Record<string, ExcalidrawFileData> = {}

  const IMG_MAX_W = 260
  const IMG_MAX_H = 470
  const PAD_X = 24

  const titleW = CARD_W - 40
  const titleLines = wrapTextToLines(input.title.trim() || ' ', titleW, 32, 400)
  const titleDisplay = titleLines.join('\n')
  const titleLineCount = titleLines.length
  const titleTextH = textBlockHeight(titleLineCount, 32, 1.25, 8)
  const HEADER_H = Math.max(HEADER_H_MIN, Math.round(16 + titleTextH + 18))
  const CONTENT_TOP = oy + HEADER_H + 16

  let imageW = 0
  let imageH = 0
  let fileId: string | null = null

  if (input.imageDataUrl) {
    const { w: nw, h: nh } = await loadImageDimensions(input.imageDataUrl)
    const fitted = fitBox(nw, nh, IMG_MAX_W, IMG_MAX_H)
    imageW = fitted.w
    imageH = fitted.h
    fileId = await sha1HexFromDataUrl(input.imageDataUrl)
    const created = Date.now()
    files[fileId] = {
      mimeType: mimeFromDataUrl(input.imageDataUrl),
      id: fileId,
      dataURL: input.imageDataUrl,
      created,
      lastRetrieved: created,
    }
  }

  const textX = imageW > 0 ? ox + PAD_X + imageW + 20 : ox + PAD_X
  const textY = CONTENT_TOP
  const textAvailableW = imageW > 0 ? CARD_W - (textX - ox) - PAD_X : CARD_W - 2 * PAD_X

  const bodyLines = wrapTextToLines(input.body, textAvailableW, 18, 400)
  const bodyDisplay = bodyLines.join('\n')
  const bodyLineCount = bodyLines.length
  const textH = Math.max(
    textBlockHeight(bodyLineCount, 18, 1.25, 16),
    imageH > 0 ? imageH : 120,
  )

  const tag = input.tag?.trim()
  const tagGap = 12

  let tagY = 0
  let tagX = 0
  let tagW = 0
  if (tag) {
    tagW = Math.min(220, tag.length * 10 + 36)
    if (imageW > 0) {
      tagY = CONTENT_TOP + imageH + tagGap
      const idealX = ox + PAD_X + (imageW - tagW) / 2
      const minX = ox + PAD_X
      const maxX = ox + CARD_W - PAD_X - tagW
      tagX = Math.max(minX, Math.min(idealX, maxX))
    } else {
      tagY = textY + textH + tagGap
      tagX = ox + (CARD_W - tagW) / 2
    }
  }

  const contentBottom = Math.max(
    textY + textH,
    imageW > 0 ? CONTENT_TOP + imageH : textY,
    tag ? tagY + 28 + 8 : 0,
  )

  const bottomPad = tag ? 20 : 24
  const cardH = contentBottom - oy + bottomPad

  const base = {
    angle: 0,
    strokeColor: theme.accent,
    fillStyle: 'solid' as const,
    strokeWidth: 3,
    strokeStyle: 'solid' as const,
    roughness: 1,
    opacity: 100,
    groupIds: groupIdsForEl(),
    frameId: null,
    isDeleted: false,
    boundElements: [],
    updated: now,
    link: null,
    locked: false,
  }

  elements.push({
    ...base,
    id: excalId(),
    type: 'rectangle',
    x: ox,
    y: oy,
    width: CARD_W,
    height: cardH,
    backgroundColor: theme.cardBackground,
    roundness: { type: 3 },
    seed: randSeed(),
    versionNonce: randNonce(),
    index: '',
    version: 1,
  })

  elements.push({
    ...base,
    id: excalId(),
    type: 'rectangle',
    x: ox,
    y: oy,
    width: CARD_W,
    height: HEADER_H,
    backgroundColor: theme.accent,
    roundness: { type: 3 },
    seed: randSeed(),
    versionNonce: randNonce(),
    index: '',
    version: 1,
  })

  elements.push({
    ...base,
    id: excalId(),
    type: 'text',
    x: ox + 20,
    y: oy + 16,
    width: CARD_W - 40,
    height: Math.max(40, Math.round(titleTextH)),
    strokeColor: theme.titleOnAccent,
    backgroundColor: 'transparent',
    strokeWidth: 2,
    roundness: { type: 2 },
    seed: randSeed(),
    versionNonce: randNonce(),
    index: '',
    version: 1,
    text: titleDisplay,
    fontSize: 32,
    fontFamily: 5,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    originalText: titleDisplay,
    autoResize: false,
    lineHeight: 1.25,
  })

  elements.push({
    ...base,
    id: excalId(),
    type: 'text',
    x: textX,
    y: textY,
    width: textAvailableW,
    height: textH,
    strokeColor: theme.bodyText,
    backgroundColor: 'transparent',
    strokeWidth: 2,
    roundness: { type: 2 },
    seed: randSeed(),
    versionNonce: randNonce(),
    index: '',
    version: 1,
    text: bodyDisplay,
    fontSize: 18,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    originalText: bodyDisplay,
    autoResize: false,
    lineHeight: 1.25,
  })

  if (fileId && input.imageDataUrl) {
    elements.push({
      ...base,
      id: excalId(),
      type: 'image',
      x: ox + PAD_X,
      y: CONTENT_TOP,
      width: imageW,
      height: imageH,
      strokeColor: 'transparent',
      backgroundColor: theme.imagePlaceholder,
      strokeWidth: 2,
      roundness: { type: 3 },
      seed: randSeed(),
      versionNonce: randNonce(),
      index: '',
      version: 1,
      status: 'saved',
      fileId,
      scale: [1, 1],
      crop: null,
    })
  }

  if (tag) {
    elements.push({
      ...base,
      id: excalId(),
      type: 'rectangle',
      x: tagX,
      y: tagY,
      width: tagW,
      height: 28,
      strokeColor: theme.tagStroke,
      backgroundColor: 'transparent',
      strokeWidth: 1,
      roundness: { type: 3 },
      seed: randSeed(),
      versionNonce: randNonce(),
      index: '',
      version: 1,
      groupIds: groupIdsForEl(),
    })

    elements.push({
      ...base,
      id: excalId(),
      type: 'text',
      x: tagX + 10,
      y: tagY + 6,
      width: tagW - 20,
      height: 18,
      strokeColor: theme.tagStroke,
      backgroundColor: 'transparent',
      strokeWidth: 1,
      roundness: null,
      seed: randSeed(),
      versionNonce: randNonce(),
      index: '',
      version: 1,
      groupIds: groupIdsForEl(),
      text: tag.toUpperCase(),
      fontSize: 13,
      fontFamily: 5,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: null,
      originalText: tag.toUpperCase(),
      autoResize: false,
      lineHeight: 1.2,
    })
  }

  const orderKeys = generateNKeysBetween(null, null, elements.length)
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    el.index = orderKeys[i]
    el.version = Math.floor(Math.random() * (2 ** 21 - 1)) + 1
  }

  return {
    type: 'excalidraw/clipboard',
    elements,
    files,
  }
}

const STACK_GAP = 48

/**
 * Кілька карток у одному clipboard: вертикальна колона, спільний `files`.
 */
export async function buildStackedExcalidrawCards(
  inputs: CardInput[],
  options?: { originX?: number; startY?: number; gap?: number },
): Promise<ExcalidrawClipboard> {
  if (inputs.length === 0) {
    throw new Error('Додайте хоча б одну картку.')
  }
  const ox = options?.originX ?? 100
  let cursorY = options?.startY ?? 100
  const gap = options?.gap ?? STACK_GAP
  const allElements: ExcalidrawElement[] = []
  const allFiles: Record<string, ExcalidrawFileData> = {}

  for (const input of inputs) {
    const cardGroupId = excalId()
    const clip = await buildExcalidrawCard(
      {
        ...input,
        originX: ox,
        originY: cursorY,
      },
      { groupId: cardGroupId },
    )
    allElements.push(...clip.elements)
    Object.assign(allFiles, clip.files)
    let bottom = cursorY
    for (const el of clip.elements) {
      bottom = Math.max(bottom, el.y + el.height)
    }
    cursorY = bottom + gap
  }

  const keys = generateNKeysBetween(null, null, allElements.length)
  for (let i = 0; i < allElements.length; i++) {
    allElements[i].index = keys[i]
  }

  return {
    type: 'excalidraw/clipboard',
    elements: allElements,
    files: allFiles,
  }
}

function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;]+);/.exec(dataUrl)
  return m?.[1] ?? 'image/png'
}

function randSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

function randNonce(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/**
 * Excalidraw очікує: для кожного елемента `image` існує `files[fileId]`,
 * і `files[fileId].id === fileId`. Інакше вставка картки «мовчки» ламається.
 */
export function assertExcalidrawClipboardValid(payload: ExcalidrawClipboard): void {
  for (const el of payload.elements) {
    if (el.type !== 'image') continue
    const entry = payload.files[el.fileId]
    if (!entry) {
      throw new Error(
        `Некоректний буфер: для зображення немає запису files["${el.fileId}"].`,
      )
    }
    if (entry.id !== el.fileId) {
      throw new Error(
        `Некоректний буфер: files["${el.fileId}"].id має дорівнювати "${el.fileId}", зараз "${entry.id}".`,
      )
    }
  }
}


/** Той самий тип, що й у пакеті Excalidraw (copyToClipboard). */
const MIME_EXCALIDRAW_CLIPBOARD = 'application/vnd.excalidraw.clipboard+json'

/** execCommand часто падає на великому тексті (~150k+), не покладаємось на нього для великих JSON. */
const MAX_EXEC_COMMAND_CHARS = 120_000

function copyViaExecCommand(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

export async function copyCardToClipboard(payload: ExcalidrawClipboard): Promise<void> {
  assertExcalidrawClipboardValid(payload)
  const json = JSON.stringify(payload)
  const plainBlob = () => new Blob([json], { type: 'text/plain' })
  const vendorBlob = () => new Blob([json], { type: MIME_EXCALIDRAW_CLIPBOARD })

  // 1) Як офіційний copyToClipboard: обидва типи в одному ClipboardItem (де підтримується).
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          [MIME_EXCALIDRAW_CLIPBOARD]: vendorBlob(),
          'text/plain': plainBlob(),
        }),
      ])
      return
    } catch {
      /* writeText / спрощений ClipboardItem */
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': plainBlob() }),
      ])
      return
    } catch {
      /* далі */
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(json)
      return
    } catch {
      /* execCommand лише для невеликих даних */
    }
  }

  if (json.length <= MAX_EXEC_COMMAND_CHARS && copyViaExecCommand(json)) return

  throw new Error(
    'Не вдалося скопіювати в буфер. Відкрийте сайт через https або localhost, дозвольте доступ до буфера або скористайтесь «Завантажити JSON».',
  )
}
