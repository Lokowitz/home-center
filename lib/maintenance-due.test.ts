import { describe, expect, it } from "vitest"
import { awakeFilter, dueCandidateFilter, isSnoozed, scheduleDue, snoozeEnd } from "./maintenance-due"

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

describe("scheduleDue", () => {
  const now = new Date(2026, 9, 9, 12)
  const base = { assetType: "VEHICLE" as const, assetId: "v1", nextDueDate: null, nextDueMileage: null, reminderDaysBefore: 14, reminderMilesBefore: 500 }
  const miles = (value: number, unit: "MILES" | "HOURS" = "MILES") => new Map([["v1", { value, unit }]])
  const none = new Map()

  it("is overdue after the due date and due soon inside the reminder window", () => {
    expect(scheduleDue({ ...base, nextDueDate: new Date(2026, 9, 1) }, none, now)).toMatchObject({ overdue: true, dueSoon: false, reason: "date" })
    expect(scheduleDue({ ...base, nextDueDate: new Date(2026, 9, 20) }, none, now)).toMatchObject({ overdue: false, dueSoon: true, daysLeft: 11 })
    expect(scheduleDue({ ...base, nextDueDate: new Date(2026, 11, 1) }, none, now)).toMatchObject({ overdue: false, dueSoon: false, reason: null })
  })

  it("uses the reminder's own mileage window", () => {
    const s = { ...base, nextDueMileage: 50000, reminderMilesBefore: 1000 }
    expect(scheduleDue(s, miles(49200), now)).toMatchObject({ dueSoon: true, milesLeft: 800, reason: "mileage", meterUnit: "MILES" })
    expect(scheduleDue(s, miles(48000), now)).toMatchObject({ dueSoon: false, overdue: false })
    expect(scheduleDue(s, miles(50300), now)).toMatchObject({ overdue: true, milesLeft: -300, reason: "mileage" })
  })

  it("prefers mileage as the reason when both sides trigger, and reports hours", () => {
    const s = { ...base, nextDueDate: new Date(2026, 9, 1), nextDueMileage: 100 }
    expect(scheduleDue(s, miles(120, "HOURS"), now)).toMatchObject({ overdue: true, reason: "mileage", meterUnit: "HOURS" })
  })

  it("ignores mileage without a reading, or on anything but a vehicle", () => {
    expect(scheduleDue({ ...base, nextDueMileage: 100 }, none, now)).toMatchObject({ milesLeft: null, overdue: false, meterUnit: null })
    expect(scheduleDue({ ...base, assetType: "PROPERTY", nextDueMileage: 100 }, miles(500), now)).toMatchObject({ milesLeft: null, overdue: false })
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
