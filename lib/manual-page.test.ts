import { describe, expect, it } from "vitest"
import { findManualPage, titleWords } from "./manual-page"

describe("titleWords", () => {
  it("keeps the useful words, folded", () => {
    expect(titleWords("Replace the furnace filters")).toEqual(["replace", "furnace", "filter"])
    expect(titleWords("Do it")).toEqual([])
    expect(titleWords("A/C service")).toEqual(["service"])
  })
})

describe("findManualPage", () => {
  it("returns the page with the most title words", () => {
    expect(findManualPage("Intro\fChanging the air filter\fFurnace filter: step by step", "Replace furnace filter")).toBe(3)
  })

  it("gives ties to the first page", () => {
    expect(findManualPage("filter here\ffilter there", "Filter")).toBe(1)
  })

  it("counts a repeated word once", () => {
    expect(findManualPage("filter filter filter\ffurnace filter", "Furnace filter")).toBe(2)
  })

  it("ignores case, punctuation and plurals", () => {
    expect(findManualPage("Safety\fFURNACE-FILTERS", "Replace furnace filter")).toBe(2)
  })

  it("returns null when nothing matches", () => {
    expect(findManualPage("Safety\fWarranty", "Replace furnace filter")).toBeNull()
    expect(findManualPage("", "Replace furnace filter")).toBeNull()
    expect(findManualPage("Anything at all", "Do it")).toBeNull()
  })
})
