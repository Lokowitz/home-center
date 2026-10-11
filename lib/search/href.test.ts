import { describe, expect, it } from "vitest"
import { searchHref, semanticOn } from "./href"

describe("searchHref", () => {
  it("leaves semantic search on by default", () => {
    expect(searchHref("oil change")).toBe("/search?q=oil+change")
    expect(searchHref("oil", true)).toBe("/search?q=oil")
  })

  it("marks it off only when turned off", () => {
    expect(searchHref("oil", false)).toBe("/search?q=oil&semantic=0")
  })
})

describe("semanticOn", () => {
  it("is on unless the URL says 0", () => {
    expect(semanticOn(null)).toBe(true)
    expect(semanticOn(undefined)).toBe(true)
    expect(semanticOn("")).toBe(true)
    expect(semanticOn("1")).toBe(true)
    expect(semanticOn("0")).toBe(false)
  })
})
