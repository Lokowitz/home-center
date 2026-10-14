import { describe, expect, it } from "vitest"
import {
  byNewest, filterObservations, formatDuration, summarizeObservations, typeSuggestions, weeklyCounts,
  type ObservationLike,
} from "./observations"

const obs = (date: string, type = "Meltdown", extra: Partial<ObservationLike> = {}): ObservationLike => ({
  date: new Date(date), time: null, type, severity: null, durationMinutes: null, conditionId: null, ...extra,
})
// A Monday.
const now = new Date("2026-06-15T15:00:00Z")

describe("formatting", () => {
  it("formats durations and times", () => {
    expect(formatDuration(45)).toBe("45 min")
    expect(formatDuration(60)).toBe("1 h")
    expect(formatDuration(95)).toBe("1 h 35 min")
    expect(formatDuration(null)).toBe("—")
  })
})

describe("typeSuggestions", () => {
  it("offers past types once each, most used first", () => {
    const rows = [obs("2026-06-01", "Sleep"), obs("2026-06-02", "meltdown"), obs("2026-06-03", "Meltdown ")]
    expect(typeSuggestions(rows)).toEqual(["meltdown", "Sleep"])
  })
})

describe("filterObservations", () => {
  const rows = [
    obs("2026-06-15", "Meltdown", { conditionId: "adhd" }),
    obs("2026-05-17", "Meltdown"),
    obs("2026-05-16", "Sleep"),
    obs("2025-01-01", "Meltdown"),
  ]
  it("filters by type (any case), condition and range including today", () => {
    expect(filterObservations(rows, { type: "meltdown" }, now)).toHaveLength(3)
    expect(filterObservations(rows, { conditionId: "adhd" }, now)).toHaveLength(1)
    // 30 days back from the 15th includes May 17 but not May 16.
    expect(filterObservations(rows, { range: "30" }, now).map((r) => r.type)).toEqual(["Meltdown", "Meltdown"])
    expect(filterObservations(rows, { range: "all" }, now)).toHaveLength(4)
  })
})

describe("weeklyCounts", () => {
  it("buckets by Monday-start week, ending with this week", () => {
    const rows = [
      obs("2026-06-15", "Meltdown", { severity: 4 }),
      obs("2026-06-14", "Meltdown", { severity: 2 }),
      obs("2026-06-08", "Meltdown", { severity: 3 }),
      obs("2026-01-01"),
    ]
    expect(weeklyCounts(rows, 2, now)).toEqual([
      { start: "2026-06-08", count: 2, avgSeverity: 2.5 },
      { start: "2026-06-15", count: 1, avgSeverity: 4 },
    ])
  })
})

describe("summarizeObservations", () => {
  it("counts by type and averages what was recorded", () => {
    const s = summarizeObservations([
      obs("2026-06-01", "Meltdown", { severity: 4, durationMinutes: 20 }),
      obs("2026-06-02", "meltdown", { severity: 3 }),
      obs("2026-06-03", "Sleep"),
    ])
    expect(s).toEqual({ count: 3, byType: [{ type: "Meltdown", count: 2 }, { type: "Sleep", count: 1 }], avgSeverity: 3.5, totalMinutes: 20 })
    expect(summarizeObservations([]).avgSeverity).toBeNull()
  })
})

describe("byNewest", () => {
  it("orders by day then time, untimed last within a day", () => {
    const rows = [obs("2026-06-01"), obs("2026-06-02", "a"), obs("2026-06-02", "b", { time: "08:00" }), obs("2026-06-02", "c", { time: "19:00" })]
    expect([...rows].sort(byNewest).map((r) => r.type)).toEqual(["c", "b", "a", "Meltdown"])
  })
})
