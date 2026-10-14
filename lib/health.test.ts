import { describe, expect, it } from "vitest"
import {
  ageFrom, daysUntil, immunizationDue, insuranceExpiring, isMedicationActive,
  isSupersededImmunization, labelFor, nextRefillFrom, refillDue, RELATIONSHIPS, toDateInput,
} from "./health"

const d = (s: string) => new Date(s)

describe("ageFrom", () => {
  it("counts completed years", () => {
    expect(ageFrom(d("1980-06-15"), d("2026-06-14T12:00:00Z"))).toBe(45)
    expect(ageFrom(d("1980-06-15"), d("2026-06-15T12:00:00Z"))).toBe(46)
  })
  it("handles a leap-day birthday in a non-leap year", () => {
    expect(ageFrom(d("2000-02-29"), d("2026-02-28T12:00:00Z"))).toBe(25)
    expect(ageFrom(d("2000-02-29"), d("2026-03-01T12:00:00Z"))).toBe(26)
  })
})

describe("daysUntil", () => {
  it("rounds partial days up and never returns -0", () => {
    const now = d("2026-09-25T12:00:00Z")
    expect(daysUntil(d("2026-09-26T00:00:00Z"), now)).toBe(1)
    expect(Object.is(daysUntil(d("2026-09-25T06:00:00Z"), now), 0)).toBe(true)
    expect(daysUntil(d("2026-09-20T00:00:00Z"), now)).toBe(-5)
  })
})

describe("isMedicationActive", () => {
  const now = d("2026-09-25T15:00:00Z")
  it("is active with no end date", () => {
    expect(isMedicationActive({ endDate: null }, now)).toBe(true)
  })
  it("stays active through the whole of its end date", () => {
    expect(isMedicationActive({ endDate: d("2026-09-25") }, now)).toBe(true)
  })
  it("is inactive after its end date", () => {
    expect(isMedicationActive({ endDate: d("2026-09-24") }, now)).toBe(false)
  })
})

describe("refillDue", () => {
  const now = d("2026-09-25T12:00:00Z")
  it("is due within the window, including overdue", () => {
    expect(refillDue({ endDate: null, nextRefillDate: d("2026-09-30") }, now)).toBe(true)
    expect(refillDue({ endDate: null, nextRefillDate: d("2026-09-01") }, now)).toBe(true)
  })
  it("is not due outside the window or without a date", () => {
    expect(refillDue({ endDate: null, nextRefillDate: d("2026-10-30") }, now)).toBe(false)
    expect(refillDue({ endDate: null, nextRefillDate: null }, now)).toBe(false)
  })
  it("is never due once the medication has ended", () => {
    expect(refillDue({ endDate: d("2026-09-01"), nextRefillDate: d("2026-09-01") }, now)).toBe(false)
  })
})

describe("immunizationDue / insuranceExpiring", () => {
  const now = d("2026-09-25T12:00:00Z")
  it("flags immunizations due within 30 days or overdue", () => {
    expect(immunizationDue({ nextDueDate: d("2026-10-20") }, now)).toBe(true)
    expect(immunizationDue({ nextDueDate: d("2025-01-01") }, now)).toBe(true)
    expect(immunizationDue({ nextDueDate: d("2027-01-01") }, now)).toBe(false)
    expect(immunizationDue({ nextDueDate: null }, now)).toBe(false)
  })
  it("flags policies ending within 60 days but not already ended", () => {
    expect(insuranceExpiring({ endDate: d("2026-11-01") }, now)).toBe(true)
    expect(insuranceExpiring({ endDate: d("2026-09-01") }, now)).toBe(false)
    expect(insuranceExpiring({ endDate: null }, now)).toBe(false)
  })
})

describe("isSupersededImmunization", () => {
  const older = { personId: "p1", vaccine: "Tdap", dateGiven: d("2020-01-01") }
  const newer = { personId: "p1", vaccine: "Tdap", dateGiven: d("2026-01-01") }

  it("marks an older dose superseded when a later dose of the same vaccine exists", () => {
    expect(isSupersededImmunization(older, [older, newer])).toBe(true)
  })
  it("does not mark the latest dose superseded", () => {
    expect(isSupersededImmunization(newer, [older, newer])).toBe(false)
  })
  it("does not supersede across different vaccines", () => {
    const flu = { personId: "p1", vaccine: "Flu", dateGiven: d("2026-06-01") }
    expect(isSupersededImmunization(older, [older, flu])).toBe(false)
  })
  it("does not supersede across different people", () => {
    const otherPerson = { personId: "p2", vaccine: "Tdap", dateGiven: d("2026-01-01") }
    expect(isSupersededImmunization(older, [older, otherPerson])).toBe(false)
  })
  it("matches vaccine names case-insensitively and trimmed", () => {
    const messyOlder = { personId: "p1", vaccine: "  tdap ", dateGiven: d("2020-01-01") }
    const cleanNewer = { personId: "p1", vaccine: "TDAP", dateGiven: d("2026-01-01") }
    expect(isSupersededImmunization(messyOlder, [messyOlder, cleanNewer])).toBe(true)
  })
})

describe("helpers", () => {
  it("adds an interval for the next refill", () => {
    expect(nextRefillFrom(d("2026-09-25T00:00:00Z"), 30).toISOString()).toBe("2026-10-25T00:00:00.000Z")
  })
  it("formats dates for <input type=date>", () => {
    expect(toDateInput(d("2026-09-25T00:00:00Z"))).toBe("2026-09-25")
    expect(toDateInput(null)).toBe("")
  })
  it("labels enum values and falls back to the raw value", () => {
    expect(labelFor(RELATIONSHIPS, "SPOUSE")).toBe("Spouse")
    expect(labelFor(RELATIONSHIPS, "PET")).toBe("Pet")
    expect(labelFor(RELATIONSHIPS, "NOPE")).toBe("NOPE")
  })
})
