/** Кольори картки Excalidraw; усі поля задаються в JSON від ШІ (опційно). */
export type CardThemeColors = {
  /** Рамка картки та заливка шапки */
  accent: string
  /** Фон тіла картки */
  cardBackground: string
  /** Колір тексту заголовка на шапці */
  titleOnAccent: string
  /** Колір основного тексту опису */
  bodyText: string
  /** Обводка та текст бейджа */
  tagStroke: string
  /** Підкладка під зображення */
  imagePlaceholder: string
}

export const DEFAULT_CARD_THEME: CardThemeColors = {
  accent: '#D92323',
  cardBackground: '#f8f9fa',
  titleOnAccent: '#FFFFFF',
  bodyText: '#1e1e1e',
  tagStroke: '#c92a2a',
  imagePlaceholder: '#ebfbee',
}

export function resolveCardTheme(
  partial?: Partial<CardThemeColors>,
): CardThemeColors {
  return { ...DEFAULT_CARD_THEME, ...partial }
}
