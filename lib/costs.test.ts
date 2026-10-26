import { describe, expect, it } from "vitest"
import { CATEGORY_ORDER, bucketed, categoriesFor, categoryColor, dailyTotals, lastYearMonthly, monthsBack, nestedByAsset, rankedRowKey, SERVICE_CATEGORY_VALUES, sum, yearToDate, yearlyBars } from "./costs"
import { localDay } from "./equipment-life"

describe("service categories", () => {
  it("offers medical categories only for people", () => {
    const person = categoriesFor("PERSON").map((c) => c.value)
    const house = categoriesFor("PROPERTY").map((c) => c.value)
    expect(person).toContain("OFFICE_VISIT")
    expect(person).toContain("OTHER")
    expect(person).not.toContain("REPAIR")
    expect(house).toContain("REPAIR")
    expect(house).not.toContain("OFFICE_VISIT")
  })

  it("keeps Other then Uncategorized at the end of the fixed order", () => {
    expect(CATEGORY_ORDER.slice(-2)).toEqual(["OTHER", "UNCATEGORIZED"])
  })

  it("gives every category a colour", () => {
    for (const value of SERVICE_CATEGORY_VALUES) expect(categoryColor(value)).toMatch(/^var\(--cost-/)
  })
})

describe("nestedByAsset", () => {
  const row = (assetType: "PROPERTY" | "EQUIPMENT" | "VEHICLE", assetId: string, cost: number) => ({
    id: `${assetType}-${assetId}-${cost}`,
    assetType,
    assetId,
    cost,
    date: new Date(2026, 0, 1),
    category: null,
    vendor: null,
    title: "t",
    mileageAtService: null,
  })
  const installed = new Map([["furnace", "home"]])

  it("rolls equipment into its property and lists it as a child", () => {
    const { top, children } = nestedByAsset(
      [row("PROPERTY", "home", 100), row("EQUIPMENT", "furnace", 40), row("VEHICLE", "car", 10)],
      installed
    )
    expect(top.get("PROPERTY:home")?.total).toBe(140)
    expect(top.has("EQUIPMENT:furnace")).toBe(false)
    expect(top.get("VEHICLE:car")?.total).toBe(10)
    const kids = children.get("PROPERTY:home")!
    expect(kids.get("PROPERTY:home")?.total).toBe(100)
    expect(kids.get("EQUIPMENT:furnace")?.total).toBe(40)
    expect(children.has("VEHICLE:car")).toBe(false)
  })

  it("leaves equipment with no property as its own entry", () => {
    const { top, children } = nestedByAsset([row("EQUIPMENT", "mower", 25)], installed)
    expect(top.get("EQUIPMENT:mower")?.total).toBe(25)
    expect(children.size).toBe(0)
  })
})

describe("rankedRowKey", () => {
  it("gives a property and its own 'Property itself' row different keys", () => {
    // Both rows carry the property's asset key; sharing a React key made the
    // list keep stale rows and show a property twice after the filter changed.
    const parent = { key: "PROPERTY:p1" }
    const itself = { key: "PROPERTY:p1", depth: 1 }
    expect(rankedRowKey(parent)).not.toBe(rankedRowKey(itself))
  })

  it("is stable for the same row", () => {
    expect(rankedRowKey({ key: "EQUIPMENT:e1", depth: 1 })).toBe(rankedRowKey({ key: "EQUIPMENT:e1", depth: 1 }))
  })
})

describe("tile history", () => {
  const at = (y: number, m: number, cost: number) => ({
    id: `${y}-${m}-${cost}`, assetType: "PROPERTY" as const, assetId: "home", cost, date: new Date(y, m, 10),
    category: null, vendor: null, title: "t", mileageAtService: null,
  })
  const now = new Date(2026, 9, 25)

  describe("lastYearMonthly", () => {
    it("gives twelve months, January to December, of last year only", () => {
      const out = lastYearMonthly([at(2025, 0, 100), at(2025, 0, 50), at(2025, 11, 30), at(2026, 3, 999), at(2024, 5, 999)], now)
      expect(out).toHaveLength(12)
      expect(out[0].total).toBe(150)
      expect(out[11].total).toBe(30)
      expect(out.slice(1, 11).every((p) => p.total === 0)).toBe(true)
      expect(out[0].label).toMatch(/2025/) // names its month and year, for the tooltip
    })

    it("is all zeros when last year has nothing", () => {
      expect(lastYearMonthly([at(2026, 1, 10)], now).map((p) => p.total)).toEqual(Array(12).fill(0))
    })
  })

  describe("yearlyBars", () => {
    it("runs from the first year with data to this year, with gap years at zero", () => {
      const out = yearlyBars([at(2023, 2, 100), at(2025, 6, 40), at(2025, 7, 10), at(2026, 1, 5)], now)
      expect(out.map((b) => b.label)).toEqual(["2023", "2024", "2025", "2026"])
      expect(out.map((b) => b.total)).toEqual([100, 0, 50, 5])
    })

    it("is empty with no rows", () => {
      expect(yearlyBars([], now)).toEqual([])
    })

    it("keeps only the most recent twelve years", () => {
      const rows = Array.from({ length: 15 }, (_, i) => at(2012 + i, 0, 10))
      const out = yearlyBars(rows, now)
      expect(out).toHaveLength(12)
      expect(out[0].label).toBe("2015")
      expect(out[11].label).toBe("2026")
    })
  })
})

describe("dailyTotals", () => {
  const day = (y: number, m: number, d: number, cost: number, h = 12) => ({
    id: `${y}-${m}-${d}-${cost}`, assetType: "PROPERTY" as const, assetId: "home", cost, date: new Date(Date.UTC(y, m, d, h)),
    category: null, vendor: null, title: "t", mileageAtService: null,
  })
  const now = new Date(2026, 9, 25, 15)

  it("gives one entry per day, oldest first, ending today", () => {
    const out = dailyTotals([], now, 60)
    expect(out).toHaveLength(60)
    expect(out[59].date).toEqual(new Date(Date.UTC(2026, 9, 25)))
    expect(out[0].date).toEqual(new Date(Date.UTC(2026, 7, 27)))
  })

  it("adds up the costs of one day, whatever the time of day", () => {
    const out = dailyTotals([day(2026, 9, 25, 40, 1), day(2026, 9, 25, 10, 23), day(2026, 9, 24, 5)], now, 60)
    expect(out[59].total).toBe(50)
    expect(out[58].total).toBe(5)
  })

  it("leaves out days before the window and after today", () => {
    const out = dailyTotals([day(2026, 7, 26, 99), day(2026, 7, 27, 7), day(2026, 9, 26, 99)], now, 60)
    expect(out[0].total).toBe(7)
    expect(out.reduce((s, d) => s + d.total, 0)).toBe(7)
  })

  it("crosses a month and year boundary", () => {
    const out = dailyTotals([day(2025, 11, 31, 3)], new Date(2026, 0, 2), 5)
    expect(out.map((d) => d.date.getUTCDate())).toEqual([29, 30, 31, 1, 2])
    expect(out[2].total).toBe(3)
  })
})

// Records are stored as UTC midnight. A record on the first or last day of a
// period must land in that period whatever the server's time zone is.
describe("period edges", () => {
  const rec = (iso: string, cost: number) => ({
    id: iso, assetType: "PROPERTY" as const, assetId: "home", cost, date: new Date(iso + "T00:00:00Z"),
    category: null, vendor: null, title: "t", mileageAtService: null,
  })
  const now = new Date(2026, 9, 25, 20)

  it("counts 1 January in its own year to date, and keeps 31 December out of the earlier window", () => {
    const rows = [rec("2026-01-01", 1), rec("2025-12-31", 10), rec("2025-01-01", 100)]
    expect(sum(yearToDate(rows, now))).toBe(1)
    expect(sum(yearToDate(rows, now, 2025))).toBe(100)
  })

  it("counts a record dated today on today's bar", () => {
    const out = dailyTotals([rec("2026-10-25", 5), rec("2026-10-24", 3)], now, 3)
    expect(out.map((d) => d.total)).toEqual([0, 3, 5])
  })

  it("buckets the first and last day of a month into that month", () => {
    const range = { start: monthsBack(now, 2), end: localDay(now) }
    const out = bucketed([rec("2026-09-01", 1), rec("2026-09-30", 10), rec("2026-10-01", 100)], "month", range)
    expect(out.map((p) => p.total)).toEqual([11, 100])
  })

  it("keeps the current month's bucket when the evening has already passed midnight UTC", () => {
    const lastEvening = new Date(2026, 9, 31, 22)
    const range = { start: monthsBack(lastEvening, 2), end: localDay(lastEvening) }
    expect(bucketed([], "month", range)).toHaveLength(2)
  })
})
