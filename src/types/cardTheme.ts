/** Excalidraw card colors; all fields may be set in AI JSON (optional). */
export type CardThemeColors = {
  /** Card border and header fill */
  accent: string
  /** Card body background */
  cardBackground: string
  /** Header title text color */
  titleOnAccent: string
  /** Main body text color */
  bodyText: string
  /** Badge border and text color */
  tagStroke: string
  /** Badge fill */
  tagBackground: string
  /** Image placeholder fill */
  imagePlaceholder: string
}

export const DEFAULT_CARD_THEME: CardThemeColors = {
  accent: '#D92323',
  cardBackground: '#f8f9fa',
  titleOnAccent: '#FFFFFF',
  bodyText: '#1e1e1e',
  tagStroke: '#c92a2a',
  tagBackground: '#ffffff',
  imagePlaceholder: '#ebfbee',
}

export function resolveCardTheme(
  partial?: Partial<CardThemeColors>,
): CardThemeColors {
  return { ...DEFAULT_CARD_THEME, ...partial }
}
