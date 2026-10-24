import { describe, expect, it } from "vitest"
import {
  alignCalendarDue,
  firstCalendarDue,
  formatDueMonths,
  isDoneOnce,
  isStuckOneTime,
  monthsMissing,
  nextCalendarDue,
  normalizeRepeats,
  parseDueMonths,
  repeatsLabel,
  scheduleKind,
} from "./maintenance-schedule"

const none = { intervalDays: null, intervalMiles: null, lastCompletedDate: null, nextDueDate: null, lastCompletedMileage: null, nextDueMileage: null }

describe("isStuckOneTime", () => {
  it("clears the date of a one-time reminder done after it was due", () => {
    expect(isStuckOneTime({ ...none, lastCompletedDate: new Date("2026-05-02"), nextDueDate: new Date("2026-05-01") })).toEqual({ clearDate: true, clearMileage: false })
  })

  it("clears the date when it was done on the due date", () => {
    expect(isStuckOneTime({ ...none, lastCompletedDate: new Date("2026-05-01"), nextDueDate: new Date("2026-05-01") }).clearDate).toBe(true)
  })

  it("keeps the date when the last completion is older than the due date", () => {
    expect(isStuckOneTime({ ...none, lastCompletedDate: new Date("2026-04-01"), nextDueDate: new Date("2026-05-01") }).clearDate).toBe(false)
  })

  it("clears the mileage of a one-time reminder done past its due mileage", () => {
    expect(isStuckOneTime({ ...none, lastCompletedMileage: 60100, nextDueMileage: 60000 })).toEqual({ clearDate: false, clearMileage: true })
  })

  it("leaves repeating reminders alone", () => {
    const s = { ...none, intervalDays: 90, lastCompletedDate: new Date("2026-05-02"), nextDueDate: new Date("2026-05-01") }
    expect(isStuckOneTime(s)).toEqual({ clearDate: false, clearMileage: false })
    expect(isStuckOneTime({ ...s, intervalDays: null, intervalMiles: 5000 })).toEqual({ clearDate: false, clearMileage: false })
  })

  it("keeps the date when it was never completed", () => {
    expect(isStuckOneTime({ ...none, nextDueDate: new Date("2026-05-01") }).clearDate).toBe(false)
  })
})

describe("parseDueMonths / formatDueMonths", () => {
  it("keeps sorted unique months 1-12 and drops bad tokens", () => {
    expect(parseDueMonths(" 10,4,4,13,x ")).toEqual([4, 10])
    expect(parseDueMonths(null)).toEqual([])
  })

  it("writes a sorted comma string, or null when empty", () => {
    expect(formatDueMonths([10, 4])).toBe("4,10")
    expect(formatDueMonths([])).toBeNull()
  })
})

describe("scheduleKind", () => {
  it("tells interval, calendar and one-time apart", () => {
    expect(scheduleKind({ intervalDays: 90, intervalMiles: null })).toBe("interval")
    expect(scheduleKind({ intervalDays: null, intervalMiles: 5000 })).toBe("interval")
    expect(scheduleKind({ intervalDays: null, intervalMiles: null, dueMonths: "4" })).toBe("calendar")
    expect(scheduleKind({ intervalDays: null, intervalMiles: null })).toBe("once")
  })
})

describe("nextCalendarDue", () => {
  const iso = (d: Date) => d.toISOString()

  it("picks the next listed month", () => {
    expect(iso(nextCalendarDue([4, 10], 1, new Date("2026-03-25T08:00Z")))).toBe("2026-04-01T12:00:00.000Z")
  })

  it("moves on when completed on the due day, at any hour", () => {
    expect(iso(nextCalendarDue([4, 10], 1, new Date("2026-04-01T00:00Z")))).toBe("2026-10-01T12:00:00.000Z")
    expect(iso(nextCalendarDue([4, 10], 1, new Date("2026-04-01T23:30Z")))).toBe("2026-10-01T12:00:00.000Z")
  })

  it("wraps into the next year", () => {
    expect(iso(nextCalendarDue([4, 10], 1, new Date("2026-11-03T12:00Z")))).toBe("2027-04-01T12:00:00.000Z")
    expect(iso(nextCalendarDue([10], 1, new Date("2026-10-20T12:00Z")))).toBe("2027-10-01T12:00:00.000Z")
  })
})

describe("firstCalendarDue", () => {
  it("counts today", () => {
    expect(firstCalendarDue([4], 15, new Date("2026-04-15T09:00Z")).toISOString()).toBe("2026-04-15T12:00:00.000Z")
    expect(firstCalendarDue([4], 1, new Date("2026-10-10T12:00Z")).toISOString()).toBe("2027-04-01T12:00:00.000Z")
  })
})

describe("repeatsLabel", () => {
  const base = { intervalDays: null, intervalMiles: null }

  it("describes each kind", () => {
    expect(repeatsLabel({ ...base, intervalDays: 90 }, "mi")).toBe("Every 90 days")
    expect(repeatsLabel({ ...base, intervalMiles: 5000 }, "mi")).toBe("Every 5,000 mi")
    expect(repeatsLabel({ intervalDays: 180, intervalMiles: 6000 }, "mi")).toBe("Every 180 days or 6,000 mi")
    expect(repeatsLabel({ ...base, dueMonths: "4,10", dueDay: 1 }, "mi")).toBe("Apr, Oct")
    expect(repeatsLabel({ ...base, dueMonths: "4,10", dueDay: 15 }, "mi")).toBe("Apr 15, Oct 15")
    expect(repeatsLabel(base, "mi")).toBe("Once")
  })
})

describe("normalizeRepeats", () => {
  const none = { intervalDays: null, intervalMiles: null, dueMonths: [], dueDay: null }

  it("stores months as a sorted string and defaults the day to 1", () => {
    expect(normalizeRepeats({ ...none, dueMonths: [10, 4] })).toEqual({
      ok: true,
      value: { intervalDays: null, intervalMiles: null, dueMonths: "4,10", dueDay: 1 },
    })
  })

  it("refuses months together with an interval", () => {
    expect(normalizeRepeats({ ...none, dueMonths: [4], intervalDays: 90 })).toEqual({
      ok: false,
      error: "A reminder on set months can't also repeat every so many days or miles.",
    })
    expect(normalizeRepeats({ ...none, dueMonths: [4], intervalMiles: 5000 }).ok).toBe(false)
  })

  it("drops the day when no months are set", () => {
    expect(normalizeRepeats({ ...none, dueDay: 15 })).toEqual({
      ok: true,
      value: { intervalDays: null, intervalMiles: null, dueMonths: null, dueDay: null },
    })
  })

  it("passes an interval through", () => {
    expect(normalizeRepeats({ ...none, intervalDays: 90 })).toEqual({
      ok: true,
      value: { intervalDays: 90, intervalMiles: null, dueMonths: null, dueDay: null },
    })
  })
})

describe("isDoneOnce", () => {
  const once = { intervalDays: null, intervalMiles: null, dueMonths: null, nextDueDate: null, nextDueMileage: null, lastCompletedDate: new Date("2026-05-10") }

  it("is true for a one-time reminder that was completed and has no due value left", () => {
    expect(isDoneOnce(once)).toBe(true)
  })

  it("is false while it still has a due date or mileage, or was never completed", () => {
    expect(isDoneOnce({ ...once, nextDueDate: new Date("2026-06-01") })).toBe(false)
    expect(isDoneOnce({ ...once, nextDueMileage: 60000 })).toBe(false)
    expect(isDoneOnce({ ...once, lastCompletedDate: null })).toBe(false)
  })

  it("is false for repeating reminders", () => {
    expect(isDoneOnce({ ...once, intervalDays: 90 })).toBe(false)
    expect(isDoneOnce({ ...once, dueMonths: "4" })).toBe(false)
  })
})

describe("monthsMissing", () => {
  it("is true only when set months is chosen and no month is picked", () => {
    expect(monthsMissing("months", "")).toBe(true)
    expect(monthsMissing("months", undefined)).toBe(true)
    expect(monthsMissing("months", "x,13")).toBe(true)
    expect(monthsMissing("months", "4")).toBe(false)
    expect(monthsMissing("every", "")).toBe(false)
    expect(monthsMissing("once", "")).toBe(false)
  })
})

describe("alignCalendarDue", () => {
  it("keeps a typed date that falls in a listed month", () => {
    expect(alignCalendarDue([4, 10], 1, new Date("2026-04-10T00:00Z")).toISOString()).toBe("2026-04-10T00:00:00.000Z")
  })

  it("moves a typed date in an unlisted month to the next listed one", () => {
    expect(alignCalendarDue([4, 10], 1, new Date("2026-07-15T00:00Z")).toISOString()).toBe("2026-10-01T12:00:00.000Z")
    expect(alignCalendarDue([4, 10], 1, new Date("2026-11-20T00:00Z")).toISOString()).toBe("2027-04-01T12:00:00.000Z")
  })
})
