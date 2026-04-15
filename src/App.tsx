import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react'
import { nanoid } from 'nanoid'
import {
  buildStackedExcalidrawCards,
  copyCardToClipboard,
  type CardInput,
} from './lib/buildExcalidrawCard'
import {
  AI_CARD_PROMPT_EN,
  parseAiCardTemplate,
} from './lib/parseAiCardTemplate'
import type { ExcalidrawClipboard } from './types/excalidraw'
import type { CardThemeColors } from './types/cardTheme'
import './App.css'

type ImageSlot = {
  id: string
  imageFile: File | null
  previewUrl: string | null
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function initialCardsJsonText(): string {
  return JSON.stringify(
    [
      {
        title: 'Broker',
        body:
          'A professional antique trader and intermediary.\n\nA short description of the character or card theme.',
        tag: 'trader',
      },
    ],
    null,
    2,
  )
}

function alignImageSlots(prev: ImageSlot[], n: number): ImageSlot[] {
  if (prev.length === n) return prev
  if (prev.length > n) {
    prev.slice(n).forEach((s) => {
      if (s.previewUrl) URL.revokeObjectURL(s.previewUrl)
    })
    return prev.slice(0, n)
  }
  return [
    ...prev,
    ...Array.from({ length: n - prev.length }, () => ({
      id: nanoid(),
      imageFile: null,
      previewUrl: null,
    })),
  ]
}

function newImageSlot(): ImageSlot {
  return {
    id: nanoid(),
    imageFile: null,
    previewUrl: null,
  }
}

/** First image from clipboard (screenshot, copied from browser, etc.). */
function imageFileFromClipboardData(dt: DataTransfer | null): File | null {
  if (!dt) return null
  const { files } = dt
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f.type.startsWith('image/')) return f
    }
  }
  const { items } = dt
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) return f
      }
    }
  }
  return null
}

function imageFileFromClipboardEvent(e: ClipboardEvent): File | null {
  return imageFileFromClipboardData(e.clipboardData)
}

function cardsWordEn(n: number): string {
  return n === 1 ? 'card' : 'cards'
}

export default function App() {
  const formId = useId()
  const [cardsJsonText, setCardsJsonText] = useState(initialCardsJsonText)
  const [imageSlots, setImageSlots] = useState<ImageSlot[]>(() => [
    newImageSlot(),
  ])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [lastJson, setLastJson] = useState<string | null>(null)
  const [cardTheme, setCardTheme] = useState<Partial<CardThemeColors>>({})
  const [hoverPasteSlotId, setHoverPasteSlotId] = useState<string | null>(null)
  const hoverPasteLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const onPasteZonePointerEnter = useCallback((slotId: string) => {
    if (hoverPasteLeaveTimerRef.current) {
      clearTimeout(hoverPasteLeaveTimerRef.current)
      hoverPasteLeaveTimerRef.current = null
    }
    setHoverPasteSlotId(slotId)
  }, [])

  const onPasteZonePointerLeave = useCallback(() => {
    if (hoverPasteLeaveTimerRef.current) {
      clearTimeout(hoverPasteLeaveTimerRef.current)
    }
    hoverPasteLeaveTimerRef.current = window.setTimeout(() => {
      setHoverPasteSlotId(null)
      hoverPasteLeaveTimerRef.current = null
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (hoverPasteLeaveTimerRef.current) {
        clearTimeout(hoverPasteLeaveTimerRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    try {
      const parsed = parseAiCardTemplate(cardsJsonText)
      const n = parsed.length
      setImageSlots((prev) => alignImageSlots(prev, n))
    } catch {
      /* keep previous number of slots until JSON becomes valid */
    }
  }, [cardsJsonText])

  const onPickImageForSlot = useCallback((slotId: string, f: File | null) => {
    setImageSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl)
        return {
          ...s,
          imageFile: f,
          previewUrl: f ? URL.createObjectURL(f) : null,
        }
      }),
    )
  }, [])

  useEffect(() => {
    if (!hoverPasteSlotId) return
    const onDocPaste = (e: globalThis.ClipboardEvent) => {
      const file = imageFileFromClipboardData(e.clipboardData)
      if (!file) return
      e.preventDefault()
      e.stopPropagation()
      onPickImageForSlot(hoverPasteSlotId, file)
    }
    window.addEventListener('paste', onDocPaste, true)
    return () => window.removeEventListener('paste', onDocPaste, true)
  }, [hoverPasteSlotId, onPickImageForSlot])

  const buildPayload = useCallback(async (): Promise<ExcalidrawClipboard> => {
    const parsed = parseAiCardTemplate(cardsJsonText)
    const baseTheme =
      Object.keys(cardTheme).length > 0 ? cardTheme : undefined

    const inputs: CardInput[] = await Promise.all(
      parsed.map(async (p, i) => {
        let imageDataUrl: string | null = null
        const slot = imageSlots[i]
        if (slot?.imageFile) imageDataUrl = await fileToDataUrl(slot.imageFile)
        const perCardTheme =
          p.theme && Object.keys(p.theme).length > 0 ? p.theme : undefined
        const mergedTheme = {
          ...(perCardTheme ?? {}),
          ...(baseTheme ?? {}),
        }
        const theme =
          Object.keys(mergedTheme).length > 0 ? mergedTheme : undefined
        return {
          title: p.title?.trim() || `Card ${i + 1}`,
          body: p.body?.trim() || ' ',
          tag: p.tag !== undefined ? p.tag.trim() || undefined : undefined,
          imageDataUrl,
          theme,
        }
      }),
    )
    return buildStackedExcalidrawCards(inputs)
  }, [cardsJsonText, imageSlots, cardTheme])

  const handleCopy = async () => {
    setMessage(null)
    setBusy(true)
    try {
      const payload = await buildPayload()
      const n = parseAiCardTemplate(cardsJsonText).length
      await copyCardToClipboard(payload)
      setMessage(
        `Copied ${n} ${cardsWordEn(n)}. In Excalidraw, click the canvas, press Tab if needed, then Ctrl+V / Cmd+V.`,
      )
      setLastJson(JSON.stringify(payload, null, 2))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Copy failed')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyAiPrompt = async () => {
    setMessage(null)
    try {
      await navigator.clipboard.writeText(AI_CARD_PROMPT_EN)
      setMessage(
        'AI prompt copied. Paste it into chat and add your topic or card list.',
      )
    } catch {
      setMessage('Could not copy the prompt. Please copy it manually.')
    }
  }

  const copyCardTitle = useCallback(async (title: string) => {
    setMessage(null)
    try {
      await navigator.clipboard.writeText(title)
      setMessage(`Title copied: "${title}"`)
    } catch {
      setMessage('Could not copy title to clipboard.')
    }
  }, [])

  const handleDownload = async () => {
    setMessage(null)
    setBusy(true)
    try {
      const payload = await buildPayload()
      const blob = new Blob([JSON.stringify(payload)], {
        type: 'application/json',
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `excalidraw-cards-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      setLastJson(JSON.stringify(payload, null, 2))
      setMessage('JSON saved.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  let parsedCards: ReturnType<typeof parseAiCardTemplate> | null = null
  try {
    parsedCards = parseAiCardTemplate(cardsJsonText)
  } catch {
    parsedCards = null
  }

  const parsedCount =
    parsedCards?.length ?? Math.max(1, imageSlots.length)
  const jsonInvalid = parsedCards === null

  const cardTitleAt = (index: number): string => {
    const p = parsedCards?.[index]
    const t = p?.title?.trim()
    if (t) return t
    return `Card ${index + 1}`
  }

  return (
    <div className="app">
      <header className="app__header">
        <p className="app__eyebrow">Clipboard export</p>
        <h1 className="app__title">Cards for Excalidraw</h1>
        <p className="app__lead">
          Put all cards into one JSON field: a single object, an array{' '}
          <code>[...]</code>, or <code>{`{ "cards": [...] }`}</code>. Fields:{' '}
          <code>title</code>, <code>body</code>, <code>tag</code>, optional{' '}
          <code>colors</code>. Images are attached separately for each card in order.
        </p>
      </header>

      <main className="app__main">
        <form
          className="card-form"
          id={formId}
          onSubmit={(e) => {
            e.preventDefault()
            void handleCopy()
          }}
        >
          <div className="card-form__toolbar">
            <div className="cards-toolbar">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void handleCopyAiPrompt()}
              >
                Copy AI prompt
              </button>
              {Object.keys(cardTheme).length > 0 ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setCardTheme({})
                    setMessage('Custom colors reset to defaults.')
                  }}
                >
                  Reset colors
                </button>
              ) : null}
              <span className="cards-toolbar__meta">
                Clipboard will contain <strong>{parsedCount}</strong>{' '}
                {cardsWordEn(parsedCount)}
                {jsonInvalid ? (
                  <span className="cards-toolbar__warn">
                    {' '}
                    - JSON is currently invalid; fix it before copying.
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          <section className="surface surface--editor" aria-label="Cards JSON editor">
            <label className="field">
              <span className="field__label">Cards (JSON)</span>
              <p className="field__hint">
                You can paste an AI response wrapped in <code>```json</code> ...{' '}
                <code>```</code>. The number of cards in the array defines the number
                of image rows below.
              </p>
              <textarea
                className="field__textarea cards-json-textarea"
                value={cardsJsonText}
                onChange={(e) => setCardsJsonText(e.target.value)}
                rows={16}
                spellCheck={false}
              />
            </label>
          </section>

          <section className="surface surface--images" aria-label="Card images">
            <div className="card-images">
              <h2 className="card-images__title">Images in card order</h2>
              <p className="field__hint">
                Card 1 uses the first file, then by index. Without an image file,
                only text and frame are exported. To paste from clipboard, hover
                the row's paste zone and press Cmd+V / Ctrl+V, or focus the zone
                (click or Tab) and paste the same way.
              </p>
              {imageSlots.slice(0, parsedCount).map((slot, index) => {
                const rowTitle = cardTitleAt(index)
                return (
                  <div key={slot.id} className="card-images__row">
                    <span className="card-images__idx">{index + 1}</span>
                    <div className="card-images__col">
                      <div className="card-images__heading">
                        <span
                          className="card-images__name"
                          title={rowTitle}
                        >
                          {rowTitle}
                        </span>
                        <button
                          type="button"
                          className="btn btn--ghost card-images__copy-title"
                          onClick={() => void copyCardTitle(rowTitle)}
                          aria-label={`Copy title "${rowTitle}" to clipboard`}
                        >
                          Copy title
                        </button>
                      </div>
                      <div
                        className={
                          'card-images__paste-zone' +
                          (hoverPasteSlotId === slot.id
                            ? ' card-images__paste-zone--hover-paste'
                            : '')
                        }
                        tabIndex={0}
                        role="group"
                        aria-label={`Image paste zone for "${rowTitle}"`}
                        onPointerEnter={() =>
                          onPasteZonePointerEnter(slot.id)
                        }
                        onPointerLeave={onPasteZonePointerLeave}
                        onPaste={(e) => {
                          const file = imageFileFromClipboardEvent(e)
                          if (!file) return
                          e.preventDefault()
                          e.stopPropagation()
                          onPickImageForSlot(slot.id, file)
                        }}
                      >
                        <div className="card-images__inputs">
                          <input
                            className="field__file"
                            type="file"
                            accept="image/*"
                            onChange={(e) =>
                              onPickImageForSlot(
                                slot.id,
                                e.target.files?.[0] ?? null,
                              )
                            }
                          />
                          {slot.previewUrl ? (
                            <img
                              className="field__preview"
                              src={slot.previewUrl}
                              alt=""
                            />
                          ) : null}
                        </div>
                        <p className="card-images__paste-hint">
                          Hover or click here -&gt; Cmd+V / Ctrl+V
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <div className="actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? 'Please wait...' : 'Copy all cards to clipboard'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void handleDownload()}
            >
              Download JSON
            </button>
          </div>
        </form>

        {message ? <p className="toast" role="status">{message}</p> : null}

        {lastJson ? (
          <details className="json-preview">
            <summary>View generated JSON</summary>
            <pre className="json-preview__pre">{lastJson}</pre>
          </details>
        ) : null}
      </main>

      <footer className="app__footer">
        <p>
          <strong>How to paste into Excalidraw:</strong> place the cursor over the
          canvas, click it, press <kbd>Tab</kbd> if needed, then Cmd+V / Ctrl+V.
        </p>
        <p>
          Page must be served from <code>localhost</code> or <code>https</code>.
        </p>
        <p>
          In <code>files</code>, the key and <code>id</code> must match, and
          image <code>fileId</code> must reference that same value.
        </p>
      </footer>
    </div>
  )
}
