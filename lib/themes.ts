// The colour themes, in the order the header's theme navigator steps through
// them. Pure data and helpers; the palettes live in app/globals.css.
//
// The ids are next-themes theme names, written to both the class and the
// data-theme attribute on <html>. Spruce ("light") is the stylesheet's default
// (:root) and Spruce Night ("dark") is .dark. Every other id selects a
// [data-theme="<id>"] block. There is no "follow the OS" entry: it only ever
// duplicated one of the two Spruce modes.

export type ThemeOption = {
  id: string
  label: string
  /** Dark background. Must match the dark list in globals.css (@custom-variant dark). */
  dark: boolean
}

export const THEMES: readonly ThemeOption[] = [
  { id: "light", label: "Spruce", dark: false },
  { id: "dark", label: "Spruce Night", dark: true },
  { id: "ledger", label: "Ledger", dark: false },
  { id: "frost", label: "Frost", dark: false },
  { id: "observatory", label: "Observatory", dark: true },
  { id: "terminal", label: "Terminal", dark: true },
  { id: "terracotta", label: "Terracotta", dark: false },
  { id: "swiss", label: "Swiss", dark: false },
  { id: "lodge", label: "Lodge", dark: true },
  { id: "blueprint", label: "Blueprint", dark: true },
  { id: "sage", label: "Sage", dark: false },
  { id: "brutal", label: "Brutal", dark: false },
]

/** The ThemeProvider `themes` prop. */
export const themeNames: string[] = THEMES.map((t) => t.id)

/** Position in THEMES; unknown ids (including a stored "system" from before) count as Spruce. */
function indexOf(id: string | undefined): number {
  const i = THEMES.findIndex((t) => t.id === id)
  return i === -1 ? 0 : i
}

export function nextTheme(id: string | undefined): string {
  return THEMES[(indexOf(id) + 1) % THEMES.length].id
}

export function prevTheme(id: string | undefined): string {
  return THEMES[(indexOf(id) - 1 + THEMES.length) % THEMES.length].id
}

export function themeLabel(id: string | undefined): string {
  return THEMES[indexOf(id)].label
}

/** Does this theme sit on a dark background? */
export function isDarkTheme(id: string | undefined): boolean {
  return THEMES.some((t) => t.id === id && t.dark)
}
