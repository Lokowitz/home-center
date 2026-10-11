import { describe, expect, it } from "vitest"
import { isDue, isStale, lastSlot, nextSlot } from "./schedule"

const daily = { schedule: "DAILY" as const, time: "03:00", weekday: 0 }
const weekly = { schedule: "WEEKLY" as const, time: "03:00", weekday: 0 } // Sunday
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m) // Oct 2026, local; Oct 11 2026 is a Sunday

describe("backup schedule", () => {
  it("daily slot is today's time once passed, else yesterday's", () => {
    expect(lastSlot(daily, at(11, 4))).toEqual(at(11, 3))
    expect(lastSlot(daily, at(11, 2))).toEqual(at(10, 3))
    expect(nextSlot(daily, at(11, 4))).toEqual(at(12, 3))
  })
  it("weekly slot is the last matching weekday", () => {
    expect(lastSlot(weekly, at(14, 9))).toEqual(at(11, 3))
    expect(nextSlot(weekly, at(14, 9))).toEqual(at(18, 3))
  })
  it("off has no slots", () => {
    expect(lastSlot({ ...daily, schedule: "OFF" }, at(11, 4))).toBeNull()
    expect(isDue({ ...daily, schedule: "OFF" }, null, at(11, 4))).toBe(false)
  })
  it("is due once per slot, and catches up after downtime", () => {
    expect(isDue(daily, null, at(11, 4))).toBe(true)
    expect(isDue(daily, at(11, 3, 1), at(11, 4))).toBe(false)
    expect(isDue(daily, at(9, 3, 1), at(11, 10))).toBe(true) // container was down for a day
  })
  it("a failed attempt waits for the next slot rather than retrying every tick", () => {
    expect(isDue(daily, at(11, 3, 0), at(11, 3, 15))).toBe(false)
  })
  it("is stale after twice the interval without a backup", () => {
    expect(isStale(daily, at(9, 3), at(1, 0), at(11, 4))).toBe(true)
    expect(isStale(daily, at(10, 3), at(1, 0), at(11, 4))).toBe(false)
    expect(isStale(daily, null, at(11, 0), at(11, 4))).toBe(false) // just turned on
    expect(isStale(daily, null, at(8, 0), at(11, 4))).toBe(true)
    expect(isStale({ ...daily, schedule: "OFF" }, null, at(1, 0), at(11, 4))).toBe(false)
  })
})
