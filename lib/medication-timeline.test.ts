import { describe, expect, it } from "vitest"
import {
  axisTicks, buildTimeline, formatSpan, parseDose, sortChronologically, weeklyObservationCounts,
  type TimelineMedication,
} from "./medication-timeline"

const d = (s: string) => new Date(s)
const med = (over: Partial<TimelineMedication> & { name: string }): TimelineMedication => ({
  id: over.name + (over.startDate?.toISOString() ?? ""),
  dosage: null, frequency: null, startDate: null, endDate: null, notes: null, ...over,
})

describe("sortChronologically", () => {
  it("orders by start date, undated last, then end date and name", () => {
    const rows = [
      { name: "B", startDate: d("2025-03-01"), endDate: null },
      { name: "None", startDate: null, endDate: null },
      { name: "A", startDate: d("2024-01-01"), endDate: d("2024-06-01") },
      { name: "C", startDate: d("2024-01-01"), endDate: d("2024-02-01") },
    ]
    expect(sortChronologically(rows).map((r) => r.name)).toEqual(["C", "A", "B", "None"])
  })
  it("puts the most recent first in desc order, undated still last", () => {
    const rows = [
      { name: "B", startDate: d("2025-03-01"), endDate: null },
      { name: "None", startDate: null, endDate: null },
      { name: "A", startDate: d("2024-01-01"), endDate: d("2024-06-01") },
      { name: "C", startDate: d("2024-01-01"), endDate: d("2024-02-01") },
    ]
    expect(sortChronologically(rows, "desc").map((r) => r.name)).toEqual(["B", "A", "C", "None"])
  })
  it("does not mutate its input", () => {
    const rows = [{ name: "B", startDate: d("2025-01-01"), endDate: null }, { name: "A", startDate: d("2024-01-01"), endDate: null }]
    sortChronologically(rows)
    expect(rows[0].name).toBe("B")
  })
})

describe("parseDose", () => {
  it.each([
    ["150 mg", 150, "mg"],
    ["0.05mg", 0.05, "mg"],
    ["1/2 pill", 0.5, "pill"],
    ["1.5 pills", 1.5, "pill"],
    ["300 mg (later 400 mg)", 300, "mg"],
    ["2.5 mg tab", 2.5, "mg"],
    ["3000 IU", 3000, "iu"],
    ["1000", 1000, ""],
  ])("reads %s", (text, value, unit) => {
    expect(parseDose(text)).toEqual({ value, unit })
  })
  it.each([null, "", "as needed", "0 mg"])("gives null for %s", (text) => {
    expect(parseDose(text)).toBeNull()
  })
})

describe("buildTimeline", () => {
  const now = d("2026-10-16T12:00:00Z")
  const meds = [
    med({ name: "Qelbree", dosage: "100 mg", startDate: d("2025-06-06"), endDate: d("2025-07-09") }),
    med({ name: "Qelbree", dosage: "200 mg", startDate: d("2025-07-09"), endDate: d("2025-08-05") }),
    med({ name: "qelbree ", dosage: "150 mg", startDate: d("2025-08-05"), endDate: d("2025-09-01") }),
    med({ name: "Qelbree", dosage: "150 mg", startDate: d("2026-05-22"), endDate: null }),
    med({ name: "Focalin", dosage: "2.5 mg", startDate: d("2024-08-17"), endDate: d("2024-08-31") }),
    med({ name: "Eye drops", startDate: d("2023-03-18"), endDate: d("2023-03-18") }),
    med({ name: "Undated", dosage: "5 mg" }),
  ]
  const lanes = buildTimeline(meds, now)
  const q = lanes.find((l) => l.key === "qelbree")!

  it("makes one lane per drug, case- and space-insensitive, ordered by first start", () => {
    expect(lanes.map((l) => l.key)).toEqual(["eye drops", "focalin", "qelbree"])
    expect(q.segments).toHaveLength(4)
  })
  it("skips rows without a start date", () => {
    expect(lanes.some((l) => l.key === "undated")).toBe(false)
  })
  it("works out the direction of each change and restarts after a gap", () => {
    expect(q.segments.map((s) => s.change)).toEqual(["start", "up", "down", "restart"])
    expect(q.segments[1].previousDosage).toBe("100 mg")
    expect(q.segments[3].previousDosage).toBeNull()
  })
  it("scales intensity against the lane's largest dose", () => {
    expect(q.segments.map((s) => s.intensity)).toEqual([0.5, 1, 0.75, 0.75])
  })
  it("reads a bare number in the lane's only unit", () => {
    const [vit] = buildTimeline([
      med({ name: "Vitamin D3", dosage: "3000 IU", startDate: d("2026-08-29"), endDate: d("2026-10-09") }),
      med({ name: "Vitamin D3", dosage: "1000", startDate: d("2026-10-10") }),
    ], now)
    expect(vit.segments.map((s) => s.intensity)).toEqual([1, 1 / 3])
    expect(vit.segments[1].change).toBe("down")
  })
  it("runs an open-ended row to now and marks the lane active", () => {
    const last = q.segments[3]
    expect(last.ongoing).toBe(true)
    expect(last.end).toBe(now.getTime())
    expect(q.active).toBe(true)
    expect(q.current).toBe(last)
  })
  it("draws a stopped row through its end day", () => {
    const f = lanes.find((l) => l.key === "focalin")!.segments[0]
    expect(f.end).toBe(d("2024-09-01").getTime())
    expect(f.ongoing).toBe(false)
  })
  it("treats a same-day start and stop as a point", () => {
    const e = lanes.find((l) => l.key === "eye drops")!.segments[0]
    expect(e.point).toBe(true)
    expect(e.intensity).toBeNull()
  })
})

describe("axisTicks", () => {
  it("labels only years across a long span", () => {
    const t = axisTicks(d("2022-11-15").getTime(), d("2026-10-16").getTime())
    expect(t.map((x) => x.label)).toEqual(["2023", "2024", "2025", "2026"])
    expect(t.every((x) => x.major)).toBe(true)
  })
  it("labels quarters across a medium span", () => {
    const t = axisTicks(d("2025-10-16").getTime(), d("2027-01-01").getTime())
    expect(t.map((x) => x.label)).toEqual(["2026", "Apr", "Jul", "Oct"])
  })
  it("labels every month across a short span", () => {
    const t = axisTicks(d("2026-04-16").getTime(), d("2026-07-02").getTime())
    expect(t.map((x) => x.label)).toEqual(["May", "Jun", "Jul"])
  })
})

describe("weeklyObservationCounts", () => {
  it("buckets dates into Monday-start weeks inside the range", () => {
    const from = d("2026-09-02").getTime() // a Wednesday
    const to = d("2026-09-21").getTime()
    const w = weeklyObservationCounts([d("2026-08-31"), d("2026-09-06"), d("2026-09-07"), d("2026-10-01")], from, to)
    expect(w.map((x) => new Date(x.start).toISOString().slice(0, 10))).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"])
    expect(w.map((x) => x.count)).toEqual([2, 1, 0])
  })
})

describe("formatSpan", () => {
  it.each([[1, "1 day"], [10, "10 days"], [21, "3 weeks"], [180, "6 months"], [730, "2 years"]])("%i days reads %s", (n, s) => {
    expect(formatSpan(n)).toBe(s)
  })
})
