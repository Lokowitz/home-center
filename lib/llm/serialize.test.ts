import { describe, expect, it } from "vitest"
import { compact, serializeRow, serializeValue, toDay, toToolContent } from "./serialize"

describe("serializeValue", () => {
  it("prints stored days as YYYY-MM-DD and timestamps as ISO", () => {
    expect(toDay(new Date("2025-03-01T00:00:00Z"))).toBe("2025-03-01")
    expect(serializeValue(new Date("2025-03-01T00:00:00Z"))).toBe("2025-03-01")
    expect(serializeValue(new Date("2025-03-01T14:30:05.123Z"))).toBe("2025-03-01T14:30:05Z")
    expect(serializeValue(12)).toBe(12)
  })
})

describe("compact", () => {
  it("drops empties and serializes dates", () => {
    expect(compact({ a: null, b: undefined, c: 0, d: "", e: new Date("2025-01-02T00:00:00Z") })).toEqual({ c: 0, d: "", e: "2025-01-02" })
  })
})

describe("serializeRow", () => {
  it("formats a row and links it", () => {
    expect(
      serializeRow("vehicle", { id: "v1", name: "Civic", vin: null, purchaseDate: new Date("2020-05-01T00:00:00Z") })
    ).toEqual({ id: "v1", name: "Civic", purchaseDate: "2020-05-01", href: "/assets/vehicles/v1" })
  })

  it("recurses into relations with their own links", () => {
    const row = serializeRow("person", {
      id: "p1",
      name: "Anna",
      medications: [{ id: "m1", name: "Lisinopril", personId: "p1", endDate: null }],
      primaryProvider: { id: "d1", name: "Dr. Lee" },
    })
    expect(row).toEqual({
      id: "p1",
      name: "Anna",
      medications: [{ id: "m1", name: "Lisinopril", personId: "p1", href: "/assets/people/p1" }],
      primaryProvider: { id: "d1", name: "Dr. Lee", href: "/providers" },
      href: "/assets/people/p1",
    })
  })

  it("formats a stored day as YYYY-MM-DD even with a non-midnight time", () => {
    expect(
      serializeRow("medication", { id: "m1", name: "X", personId: "p1", nextRefillDate: new Date("2026-09-30T14:00:00Z") })
    ).toEqual({ id: "m1", name: "X", personId: "p1", nextRefillDate: "2026-09-30", href: "/assets/people/p1" })
  })

  it("gives equipment the location the UI shows: its room's name, else the free text", () => {
    expect(serializeRow("equipment", { id: "e1", name: "Fridge", location: null, roomId: "r1", room: { name: "Kitchen" } })).toEqual({
      id: "e1", name: "Fridge", location: "Kitchen", roomId: "r1", href: "/assets/equipment/e1",
    })
    expect(serializeRow("equipment", { id: "e1", name: "Fridge", location: "Garage", room: null })).toEqual({
      id: "e1", name: "Fridge", location: "Garage", href: "/assets/equipment/e1",
    })
    expect(serializeRow("equipment", { id: "e1", name: "Fridge", location: null, room: null })).toEqual({
      id: "e1", name: "Fridge", href: "/assets/equipment/e1",
    })
    // An included room (with its id) stays as a related record.
    expect(serializeRow("equipment", { id: "e1", name: "Fridge", location: null, room: { id: "r1", name: "Kitchen" } })).toMatchObject({
      location: "Kitchen", room: { id: "r1", name: "Kitchen" },
    })
  })

  it("keeps an attached asset ref as-is", () => {
    const asset = { type: "VEHICLE", id: "v1", name: "Civic", href: "/assets/vehicles/v1" }
    expect(serializeRow("serviceRecord", { id: "s1", title: "Oil", assetType: "VEHICLE", assetId: "v1", asset })).toEqual({
      id: "s1", title: "Oil", assetType: "VEHICLE", assetId: "v1", asset, href: "/assets/vehicles/v1",
    })
  })
})

describe("toToolContent", () => {
  it("returns plain JSON when it fits", () => {
    expect(toToolContent({ rows: [1, 2] })).toBe('{"rows":[1,2]}')
  })

  it("drops rows until it fits and says so", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, text: "x".repeat(100) }))
    const out = toToolContent({ entity: "vehicle", rows }, 5000)
    expect(out.length).toBeLessThanOrEqual(5000)
    const parsed = JSON.parse(out)
    expect(parsed.truncated).toBe(true)
    expect(parsed.rows.length).toBeLessThan(200)
    expect(parsed.note).toMatch(/Showing \d+ of 200 rows/)
  })

  it("cuts anything else at the budget", () => {
    const out = toToolContent({ blob: "y".repeat(10_000) }, 1000)
    expect(out.length).toBeLessThan(1100)
    expect(out).toMatch(/\[truncated/)
  })
})
