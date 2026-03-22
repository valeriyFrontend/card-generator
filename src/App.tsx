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
  AI_CARD_PROMPT_UK,
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
        title: 'Брокер',
        body:
          'Професійний торговець антикваріатом та посередником.\n\nКороткий опис персонажа або теми картки.',
        tag: 'торговець',
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

/** Перше зображення з буфера (скріншот, копія з браузера тощо). */
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

function cardsWordUk(n: number): string {
  const m = n % 10
  const h = n % 100
  if (h >= 11 && h <= 14) return 'карток'
  if (m === 1) return 'картка'
  if (m >= 2 && m <= 4) return 'картки'
  return 'карток'
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
      /* залишаємо попередню кількість слотів, поки JSON не валідний */
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
          title: p.title?.trim() || `Картка ${i + 1}`,
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
        `Скопійовано ${n} ${cardsWordUk(n)}. У Excalidraw клацніть по полотну, за потреби Tab, потім Ctrl+V / Cmd+V.`,
      )
      setLastJson(JSON.stringify(payload, null, 2))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Помилка копіювання')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyAiPrompt = async () => {
    setMessage(null)
    try {
      await navigator.clipboard.writeText(AI_CARD_PROMPT_UK)
      setMessage(
        'Промпт для ШІ скопійовано — вставте в чат і допишіть тему або список карток.',
      )
    } catch {
      setMessage('Не вдалося скопіювати промпт. Скопіюйте текст вручну.')
    }
  }

  const copyCardTitle = useCallback(async (title: string) => {
    setMessage(null)
    try {
      await navigator.clipboard.writeText(title)
      setMessage(`Назву скопійовано: «${title}»`)
    } catch {
      setMessage('Не вдалося скопіювати назву в буфер.')
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
      setMessage('JSON збережено.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Помилка збереження')
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
    return `Картка ${index + 1}`
  }

  return (
    <div className="app">
      <header className="app__header">
        <p className="app__eyebrow">Експорт у буфер</p>
        <h1 className="app__title">Картки для Excalidraw</h1>
        <p className="app__lead">
          Усі картки в одному полі — JSON: один об’єкт, масив{' '}
          <code>[...]</code> або <code>{`{ "cards": [...] }`}</code>. Поля:{' '}
          <code>title</code>, <code>body</code>, <code>tag</code>, опційно{' '}
          <code>colors</code>. Зображення — окремо для кожної картки за порядком.
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
                Копіювати промпт для ШІ
              </button>
              {Object.keys(cardTheme).length > 0 ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setCardTheme({})
                    setMessage('Кастомні кольори скинуто до стандартних.')
                  }}
                >
                  Скинути кольори
                </button>
              ) : null}
              <span className="cards-toolbar__meta">
                У буфері буде <strong>{parsedCount}</strong>{' '}
                {cardsWordUk(parsedCount)}
                {jsonInvalid ? (
                  <span className="cards-toolbar__warn">
                    {' '}
                    — JSON зараз некоректний; виправте текст перед копіюванням.
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          <section className="surface surface--editor" aria-label="Редактор JSON карток">
            <label className="field">
              <span className="field__label">Картки (JSON)</span>
              <p className="field__hint">
                Можна вставити відповідь ШІ у блоці <code>```json</code> …{' '}
                <code>```</code>. Кількість карток у масиві визначає кількість
                рядків зображень нижче.
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

          <section className="surface surface--images" aria-label="Зображення для карток">
            <div className="card-images">
              <h2 className="card-images__title">Зображення за порядком карток</h2>
              <p className="field__hint">
                Картка 1 — перший файл у списку, далі за номером. Без файлу
                експортується лише текст і рамка. Зображення з буфера: наведіть
                курсор на зону вставки рядка й натисніть Cmd+V / Ctrl+V, або
                клацніть по зоні (або Tab) і вставте так само.
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
                          aria-label={`Копіювати назву «${rowTitle}» в буфер`}
                        >
                          Копіювати назву
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
                        aria-label={`Зона вставки зображення для «${rowTitle}»`}
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
                          Наведіть курсор або клікніть сюди → Cmd+V / Ctrl+V
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
              {busy ? 'Зачекайте…' : 'Копіювати всі картки в буфер'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void handleDownload()}
            >
              Завантажити JSON
            </button>
          </div>
        </form>

        {message ? <p className="toast" role="status">{message}</p> : null}

        {lastJson ? (
          <details className="json-preview">
            <summary>Переглянути згенерований JSON</summary>
            <pre className="json-preview__pre">{lastJson}</pre>
          </details>
        ) : null}
      </main>

      <footer className="app__footer">
        <p>
          <strong>Як вставити в Excalidraw:</strong> курсор над полотном, клацніть
          по ньому, за потреби <kbd>Tab</kbd>, потім Cmd+V / Ctrl+V.
        </p>
        <p>
          Сторінка — лише <code>localhost</code> або <code>https</code>.
        </p>
        <p>
          У <code>files</code> ключ і <code>id</code> та <code>fileId</code> у
          зображенні мають збігатися.
        </p>
      </footer>
    </div>
  )
}
