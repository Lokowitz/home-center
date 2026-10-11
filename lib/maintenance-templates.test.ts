import { describe, expect, it } from "vitest"
import { firstDue, templatesFor, type TemplateAsset } from "./maintenance-templates"

const EQUIPMENT_CATEGORIES = ["APPLIANCE", "HVAC", "WATER", "ELECTRONICS", "TOOL", "OUTDOOR", "SECURITY", "OTHER"] as const
const PROPERTY_TYPES = ["HOUSE", "CONDO", "TOWNHOUSE", "LOT", "OTHER"] as const

const ALL: TemplateAsset[] = [
  ...PROPERTY_TYPES.map((propertyType) => ({ type: "PROPERTY" as const, propertyType })),
  { type: "VEHICLE", meterUnit: "MILES" },
  { type: "VEHICLE", meterUnit: "HOURS" },
  ...EQUIPMENT_CATEGORIES.map((category) => ({ type: "EQUIPMENT" as const, category })),
]

describe("templatesFor", () => {
  it.each(ALL.map((a) => [JSON.stringify(a), a] as const))("%s: non-empty, unique keys, each has an interval", (_, asset) => {
    const list = templatesFor(asset)
    expect(list.length).toBeGreaterThan(0)
    expect(new Set(list.map((t) => t.key)).size).toBe(list.length)
    for (const t of list) {
      expect(t.title.trim()).not.toBe("")
      expect((t.intervalDays ?? 0) > 0 || (t.intervalMiles ?? 0) > 0).toBe(true)
    }
  })

  it("only vehicles get meter intervals", () => {
    for (const a of ALL.filter((a) => a.type !== "VEHICLE")) {
      expect(templatesFor(a).every((t) => t.intervalMiles === undefined)).toBe(true)
    }
  })

  it("every vehicle template also has a date interval, so it fires without an odometer reading", () => {
    for (const meterUnit of ["MILES", "HOURS"] as const) {
      expect(templatesFor({ type: "VEHICLE", meterUnit }).every((t) => (t.intervalDays ?? 0) > 0)).toBe(true)
    }
  })

  it("hour-tracked vehicles get an hour-sized warning window", () => {
    for (const t of templatesFor({ type: "VEHICLE", meterUnit: "HOURS" })) {
      if (t.intervalMiles) expect(t.reminderMilesBefore).toBeLessThan(t.intervalMiles)
    }
  })

  it("condos skip what the building handles", () => {
    const keys = templatesFor({ type: "PROPERTY", propertyType: "CONDO" }).map((t) => t.key)
    expect(keys).not.toContain("gutters")
    expect(keys).toContain("hvac-filter")
  })
})

describe("firstDue", () => {
  const today = new Date("2026-10-10T12:00:00Z")

  it("puts the date one interval out", () => {
    expect(firstDue({ intervalDays: 90 }, today, null).nextDueDate?.toISOString()).toBe("2027-01-08T12:00:00.000Z")
  })

  it("adds the meter interval to the current reading", () => {
    expect(firstDue({ intervalDays: 180, intervalMiles: 5000 }, today, 42000).nextDueMileage).toBe(47000)
  })

  it("leaves the meter side empty without a reading", () => {
    expect(firstDue({ intervalDays: 180, intervalMiles: 5000 }, today, null)).toEqual({
      nextDueDate: new Date("2027-04-08T12:00:00Z"),
      nextDueMileage: null,
    })
  })

  it("a reading of 0 still counts", () => {
    expect(firstDue({ intervalMiles: 100 }, today, 0)).toEqual({ nextDueDate: null, nextDueMileage: 100 })
  })
})
