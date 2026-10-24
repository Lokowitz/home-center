import { describe, expect, it } from "vitest"
import { DEFAULT_FEATURES, isHealthPath, ownedWhere } from "./features"

describe("DEFAULT_FEATURES", () => {
  it("has every optional part on", () => {
    expect(DEFAULT_FEATURES).toEqual({ health: true, rooms: true, equipmentTab: true })
  })
})

describe("ownedWhere", () => {
  it("adds nothing while Health is on", () => {
    expect(ownedWhere({ health: true, rooms: true, equipmentTab: true })).toEqual({})
  })
  it("leaves out people's records while Health is off", () => {
    expect(ownedWhere({ health: false, rooms: true, equipmentTab: true })).toEqual({ assetType: { not: "PERSON" } })
  })
})

describe("isHealthPath", () => {
  it("matches the health pages and their children", () => {
    expect(isHealthPath("/assets/people")).toBe(true)
    expect(isHealthPath("/assets/people/abc?tab=health")).toBe(true)
    expect(isHealthPath("/providers")).toBe(true)
  })
  it("leaves the rest alone", () => {
    expect(isHealthPath("/assets/properties")).toBe(false)
    expect(isHealthPath("/insurance-claims")).toBe(false)
    expect(isHealthPath("/insurance")).toBe(false)
    expect(isHealthPath("/insurance?open=1")).toBe(false)
  })
})
