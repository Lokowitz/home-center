import { describe, expect, it } from "vitest"
import { awakeFilter, dueCandidateFilter, isSnoozed, snoozeEnd } from "./maintenance-due"

describe("snoozeEnd", () => {
  const now = new Date(2026, 9, 9, 8, 30)

  it("adds a day or a week from now", () => {
    expect(snoozeEnd("1d", now)).toEqual(new Date(2026, 9, 10, 8, 30))
    expect(snoozeEnd("1w", now)).toEqual(new Date(2026, 9, 16, 8, 30))
  })

  it("adds a calendar month", () => {
    expect(snoozeEnd("1m", now)).toEqual(new Date(2026, 10, 9, 8, 30))
    expect(snoozeEnd("1m", new Date(2026, 11, 15))).toEqual(new Date(2027, 0, 15))
  })

  it("lands on the last day of a shorter month instead of spilling over", () => {
    expect(snoozeEnd("1m", new Date(2027, 0, 31))).toEqual(new Date(2027, 1, 28))
    expect(snoozeEnd("1m", new Date(2028, 0, 31))).toEqual(new Date(2028, 1, 29))
  })

  it("does not change the date it was given", () => {
    const given = new Date(now)
    snoozeEnd("1m", given)
    expect(given).toEqual(now)
  })
})

describe("isSnoozed", () => {
  const now = new Date(2026, 9, 9)
  it("is snoozed only until the snooze ends", () => {
    expect(isSnoozed({ snoozedUntil: null }, now)).toBe(false)
    expect(isSnoozed({ snoozedUntil: new Date(2026, 9, 10) }, now)).toBe(true)
    expect(isSnoozed({ snoozedUntil: now }, now)).toBe(false)
    expect(isSnoozed({ snoozedUntil: new Date(2026, 9, 8) }, now)).toBe(false)
  })
})

describe("dueCandidateFilter", () => {
  it("leaves out paused and snoozed reminders", () => {
    const now = new Date(2026, 9, 9)
    const where = dueCandidateFilter(30, now)
    expect(where).toMatchObject(awakeFilter(now))
    expect(where.isActive).toBe(true)
    expect(where.OR).toEqual([{ snoozedUntil: null }, { snoozedUntil: { lte: now } }])
    expect(where.AND[0].OR).toEqual([
      { nextDueDate: { lte: new Date(now.getTime() + 30 * 86400000) } },
      { nextDueMileage: { not: null } },
    ])
  })
})
