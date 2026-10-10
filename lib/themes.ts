// The colour themes, in the order the header's theme navigator steps through
// them. Pure data and helpers; the palettes live in app/globals.css.
//
// The ids are next-themes theme names, written to both the class and the
// data-theme attribute on <html>. "light" and "dark" keep their next-themes
// meaning so "system" can resolve to them: Spruce is the stylesheet's default
// (:root) and Spruce Night is .dark. Every other id selects a
// [data-theme="<id>"] block.

export type ThemeOption = {
  id: string
  label: string
  /** Dark background. Must match the dark list in globals.css (@custom-variant dark). */
  dark: boolean
}

export const THEMES: readonly ThemeOption[] = [
  // Follows the OS light/dark setting, so it is neither until resolved.
  { id: "system", label: "System", dark: false },
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

/** The ThemeProvider `themes` prop: next-themes appends "system" itself. */
export const themeNames: string[] = THEMES.filter((t) => t.id !== "system").map((t) => t.id)

/** Position in THEMES; unknown ids count as System. */
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

/** For a resolved theme (never "system"): does it sit on a dark background? */
export function isDarkTheme(id: string | undefined): boolean {
  return THEMES.some((t) => t.id === id && t.dark)
}
