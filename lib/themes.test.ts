import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { THEMES, isDarkTheme, nextTheme, prevTheme, themeLabel, themeNames } from "./themes"

describe("THEMES", () => {
  it("starts with the two Spruce modes and has no System entry", () => {
    expect(THEMES.slice(0, 2).map((t) => t.id)).toEqual(["light", "dark"])
    expect(THEMES.map((t) => t.id)).not.toContain("system")
  })
  it("lists every design once, in order", () => {
    expect(THEMES.map((t) => t.label)).toEqual([
      "Spruce",
      "Spruce Night",
      "Ledger",
      "Frost",
      "Observatory",
      "Terminal",
      "Terracotta",
      "Swiss",
      "Lodge",
      "Blueprint",
      "Sage",
      "Brutal",
    ])
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
  })
  it("marks the dark-background designs dark", () => {
    expect(THEMES.filter((t) => t.dark).map((t) => t.id)).toEqual(["dark", "observatory", "terminal", "lodge", "blueprint"])
  })
})

describe("themeNames", () => {
  it("is every theme id", () => {
    expect(themeNames).toEqual(THEMES.map((t) => t.id))
  })
})

describe("nextTheme / prevTheme", () => {
  it("steps through the list", () => {
    expect(nextTheme("light")).toBe("dark")
    expect(prevTheme("dark")).toBe("light")
  })
  it("wraps at both ends", () => {
    expect(nextTheme("brutal")).toBe("light")
    expect(prevTheme("light")).toBe("brutal")
  })
  it("treats an unknown, missing or old \"system\" id as Spruce", () => {
    expect(nextTheme("nope")).toBe("dark")
    expect(prevTheme("nope")).toBe("brutal")
    expect(nextTheme(undefined)).toBe("dark")
    expect(nextTheme("")).toBe("dark")
    expect(nextTheme("system")).toBe("dark")
  })
  it("visits every theme once in a full lap", () => {
    const seen: string[] = []
    let id = "light"
    for (let i = 0; i < THEMES.length; i++) {
      seen.push(id)
      id = nextTheme(id)
    }
    expect(id).toBe("light")
    expect(seen).toEqual(THEMES.map((t) => t.id))
  })
})

describe("themeLabel", () => {
  it("names known themes", () => {
    expect(themeLabel("dark")).toBe("Spruce Night")
    expect(themeLabel("observatory")).toBe("Observatory")
  })
  it("falls back to Spruce", () => {
    expect(themeLabel("nope")).toBe("Spruce")
    expect(themeLabel(undefined)).toBe("Spruce")
    expect(themeLabel("system")).toBe("Spruce")
  })
})

describe("globals.css agrees with THEMES", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8")
  const named = THEMES.filter((t) => t.id !== "light" && t.id !== "dark")

  it("has a palette block for every named theme", () => {
    for (const t of named) expect(css).toContain(`[data-theme="${t.id}"] {`)
  })
  it("puts exactly the dark themes in the dark: variant", () => {
    const variant = css.match(/@custom-variant dark \((.*)\);/)?.[1] ?? ""
    const inVariant = [...variant.matchAll(/\[data-theme="([\w-]+)"\]/g)].map((m) => m[1])
    expect(inVariant).toEqual(named.filter((t) => t.dark).map((t) => t.id))
    expect(variant).toContain(".dark *")
  })
})

describe("isDarkTheme", () => {
  it("is true only for dark designs", () => {
    expect(isDarkTheme("dark")).toBe(true)
    expect(isDarkTheme("terminal")).toBe(true)
    expect(isDarkTheme("light")).toBe(false)
    expect(isDarkTheme("ledger")).toBe(false)
    expect(isDarkTheme(undefined)).toBe(false)
  })
})
