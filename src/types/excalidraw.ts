export type ExcalidrawClipboard = {
  type: 'excalidraw/clipboard'
  elements: ExcalidrawElement[]
  files: Record<string, ExcalidrawFileData>
}

export type ExcalidrawFileData = {
  mimeType: string
  id: string
  dataURL: string
  /** очікує Excalidraw для BinaryFileData */
  created: number
  /** як у реальному clipboard Excalidraw — без цього вставка зображень може ламатися */
  lastRetrieved: number
}

type BaseElement = {
  id: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  backgroundColor: string
  fillStyle: 'solid' | 'hachure' | 'cross-hatch'
  strokeWidth: number
  strokeStyle: 'solid' | 'dashed' | 'dotted'
  roughness: number
  opacity: number
  groupIds: string[]
  frameId: null
  roundness: { type: 2 | 3 } | null
  seed: number
  version: number
  versionNonce: number
  isDeleted: boolean
  boundElements: unknown[]
  updated: number
  link: null
  locked: boolean
  index: string
}

export type RectangleElement = BaseElement & {
  type: 'rectangle'
}

export type TextElement = BaseElement & {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: number
  textAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  containerId: null
  originalText: string
  autoResize: boolean
  lineHeight: number
}

export type ImageElement = BaseElement & {
  type: 'image'
  status: 'saved' | 'pending'
  fileId: string
  scale: [number, number]
  crop: null
}

export type ExcalidrawElement = RectangleElement | TextElement | ImageElement
