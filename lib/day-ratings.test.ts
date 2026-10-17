import { describe, expect, it } from "vitest"
import { dailyRatings, observationRating, ratingSummary } from "./day-ratings"

const d = (s: string) => new Date(s)
const t = (s: string) => d(s).getTime()

describe("observationRating", () => {
  it.each([[null, 1], [undefined, 1], [0, 1], [3, 3], [5, 5], [7, 5], [2.6, 3], [Number.NaN, 1]])("%s rates %i", (s, r) => {
    expect(observationRating(s as number | null | undefined)).toBe(r)
  })
})

describe("dailyRatings", () => {
  it("keeps the worst entry of each day", () => {
    const r = dailyRatings([
      { date: d("2026-09-01"), severity: 1 }, { date: d("2026-09-01"), severity: 1 }, { date: d("2026-09-01"), severity: 1 },
      { date: d("2026-09-02"), severity: 2 }, { date: d("2026-09-02"), severity: 5 },
    ])
    expect([...r]).toEqual([[t("2026-09-01"), 1], [t("2026-09-02"), 5]])
  })
  it("counts an unrated entry as mild, never above a rated one", () => {
    const r = dailyRatings([
      { date: d("2026-09-01") }, { date: d("2026-09-02"), severity: null }, { date: d("2026-09-02"), severity: 3 },
    ])
    expect(r.get(t("2026-09-01"))).toBe(1)
    expect(r.get(t("2026-09-02"))).toBe(3)
  })
  it("buckets by UTC day whatever the time", () => {
    const r = dailyRatings([{ date: d("2026-09-01T23:30:00Z"), severity: 2 }, { date: d("2026-09-01T00:10:00Z"), severity: 4 }])
    expect([...r]).toEqual([[t("2026-09-01"), 4]])
  })
  it("is empty for no observations", () => {
    expect(dailyRatings([]).size).toBe(0)
  })
})

describe("ratingSummary", () => {
  const r = dailyRatings([
    { date: d("2026-08-31"), severity: 5 }, // before the window
    { date: d("2026-09-01"), severity: 5 },
    { date: d("2026-09-03"), severity: 1 },
    { date: d("2026-09-07") }, // last day inside
    { date: d("2026-09-08"), severity: 5 }, // end is exclusive
  ])
  it("averages over every day, quiet days as 0", () => {
    expect(ratingSummary(r, t("2026-09-01"), t("2026-09-08"))).toEqual({ days: 7, avg: 1, sum: 7, rough: 3, severe: 1 })
  })
  it("gives zeros for an empty window", () => {
    expect(ratingSummary(r, t("2026-09-01"), t("2026-09-01"))).toEqual({ days: 0, avg: 0, sum: 0, rough: 0, severe: 0 })
    expect(ratingSummary(new Map(), t("2026-09-01"), t("2026-09-15"))).toEqual({ days: 14, avg: 0, sum: 0, rough: 0, severe: 0 })
  })
})
