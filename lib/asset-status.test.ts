import { describe, expect, it } from "vitest"
import { costPerYearOwned, nextDueMeter, warrantyMeter } from "./asset-status"

const NOW = new Date("2026-06-15T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)
const schedule = (over: Partial<Parameters<typeof nextDueMeter>[0][number]> = {}) => ({
  title: "Oil change",
  nextDueDate: days(40),
  lastCompletedDate: days(-60),
  createdAt: days(-400),
  reminderDaysBefore: 14,
  ...over,
})

describe("nextDueMeter", () => {
  it("returns null with nothing dated", () => {
    expect(nextDueMeter([], NOW)).toBeNull()
    expect(nextDueMeter([schedule({ nextDueDate: null })], NOW)).toBeNull()
  })

  it("picks the soonest and measures elapsed over the whole gap", () => {
    const m = nextDueMeter([schedule({ title: "Later", nextDueDate: days(90) }), schedule()], NOW)!
    expect(m.label).toBe("Next: Oil change")
    expect(m.valueLabel).toBe("in 40 days")
    expect(m.fraction).toBeCloseTo(60 / 100)
    expect(m.tone).toBe("ok")
  })

  it("turns amber inside the reminder window and red when overdue", () => {
    expect(nextDueMeter([schedule({ nextDueDate: days(10) })], NOW)!.tone).toBe("soon")
    const late = nextDueMeter([schedule({ nextDueDate: days(-3) })], NOW)!
    expect(late.tone).toBe("late")
    expect(late.valueLabel).toBe("3 days overdue")
    expect(late.fraction).toBe(1)
  })

  it("says today and singular days", () => {
    expect(nextDueMeter([schedule({ nextDueDate: NOW })], NOW)!.valueLabel).toBe("Due today")
    expect(nextDueMeter([schedule({ nextDueDate: days(1) })], NOW)!.valueLabel).toBe("in 1 day")
  })

  it("measures from set-up when it has never been done", () => {
    const m = nextDueMeter([schedule({ lastCompletedDate: null, createdAt: days(-10), nextDueDate: days(10) })], NOW)!
    expect(m.fraction).toBeCloseTo(0.5)
  })
})

describe("warrantyMeter", () => {
  const w = (over = {}) => ({ productName: "Parts", purchaseDate: days(-300), expirationDate: days(100), ...over })

  it("ignores expired and undated warranties", () => {
    expect(warrantyMeter([w({ expirationDate: days(-1) }), w({ expirationDate: null })], NOW)).toBeNull()
  })

  it("shows the share of the term left, for the one ending first", () => {
    const m = warrantyMeter([w({ productName: "Long", expirationDate: days(500) }), w()], NOW)!
    expect(m.label).toBe("Warranty: Parts")
    expect(m.valueLabel).toBe("100 days left")
    expect(m.fraction).toBeCloseTo(100 / 400)
    expect(m.tone).toBe("ok")
  })

  it("warns as it runs out", () => {
    expect(warrantyMeter([w({ expirationDate: days(60) })], NOW)!.tone).toBe("soon")
    expect(warrantyMeter([w({ expirationDate: days(20) })], NOW)!.tone).toBe("late")
  })

  it("has no bar without a start date", () => {
    expect(warrantyMeter([w({ purchaseDate: null })], NOW)!.fraction).toBeNull()
  })
})

describe("costPerYearOwned", () => {
  it("divides by years owned", () => {
    const since = new Date("2024-06-15T12:00:00Z")
    const years = (NOW.getTime() - since.getTime()) / (365.25 * 86_400_000)
    expect(costPerYearOwned(3000, since, NOW)).toBeCloseTo(3000 / years, 6)
  })

  it("is null without a date or when owned only briefly", () => {
    expect(costPerYearOwned(3000, null, NOW)).toBeNull()
    expect(costPerYearOwned(3000, days(-30), NOW)).toBeNull()
  })
})
