import { describe, expect, it } from "vitest"
import { canSkip, completeSchedule, completionCategory, completionRecordData, skipSchedule } from "./maintenance-complete"

const base = { intervalDays: null, intervalMiles: null, nextDueDate: null, nextDueMileage: null }

describe("completeSchedule", () => {
  it("counts the next due date and mileage from the completion", () => {
    const r = completeSchedule({ ...base, intervalDays: 90, intervalMiles: 5000 }, new Date(Date.UTC(2026, 9, 1)), 41000)
    expect(r.lastCompletedDate).toEqual(new Date(Date.UTC(2026, 9, 1)))
    expect(r.lastCompletedMileage).toBe(41000)
    expect(r.nextDueDate).toEqual(new Date(Date.UTC(2026, 11, 30)))
    expect(r.nextDueMileage).toBe(46000)
  })

  it("keeps a side's due value when it has no interval", () => {
    const due = new Date(2027, 0, 1)
    const r = completeSchedule({ ...base, intervalMiles: 5000, nextDueDate: due }, new Date(2026, 9, 1), 41000)
    expect(r.nextDueDate).toBe(due)
    expect(r.nextDueMileage).toBe(46000)
  })

  it("keeps the due mileage when no reading was taken", () => {
    const r = completeSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 55000 }, new Date(2026, 9, 1), null)
    expect(r.lastCompletedMileage).toBeNull()
    expect(r.nextDueMileage).toBe(55000)
  })

  // Never move a due date earlier: filing an old receipt against a reminder
  // that is already due later must not make it due (or overdue) sooner.
  it("keeps the later due date when an old receipt completes the reminder", () => {
    const due = new Date(2027, 9, 10)
    const r = completeSchedule({ ...base, intervalDays: 365, nextDueDate: due }, new Date(2023, 9, 13), null)
    expect(r.nextDueDate).toEqual(due)
    expect(r.lastCompletedDate).toEqual(new Date(2023, 9, 13))
  })

  it("moves the due date forward for a completion done today", () => {
    const r = completeSchedule({ ...base, intervalDays: 365, nextDueDate: new Date(2026, 10, 1) }, new Date(2026, 9, 10), null)
    expect(r.nextDueDate).toEqual(new Date(2027, 9, 10))
  })

  it("moves an overdue reminder forward from a slightly old completion", () => {
    const r = completeSchedule({ ...base, intervalDays: 90, nextDueDate: new Date(Date.UTC(2026, 5, 1)) }, new Date(Date.UTC(2026, 8, 1)), null)
    expect(r.nextDueDate).toEqual(new Date(Date.UTC(2026, 10, 30)))
  })

  // Dates are stored as UTC midnight, so counting days must not follow the
  // server's clock change: 30 days from Oct 25 is Nov 24, not Nov 23 at 23:00.
  it("counts whole days across a daylight saving change", () => {
    const r = completeSchedule({ ...base, intervalDays: 30 }, new Date(Date.UTC(2026, 9, 25)), null)
    expect(r.nextDueDate).toEqual(new Date(Date.UTC(2026, 10, 24)))
  })

  it("uses the computed due date when there was none", () => {
    const r = completeSchedule({ ...base, intervalDays: 30 }, new Date(2020, 0, 1), null)
    expect(r.nextDueDate).toEqual(new Date(2020, 0, 31))
  })

  it("keeps the same due date when the computed one equals it", () => {
    const due = new Date(2027, 0, 31)
    const r = completeSchedule({ ...base, intervalDays: 30, nextDueDate: due }, new Date(2027, 0, 1), null)
    expect(r.nextDueDate).toEqual(due)
  })

  it("keeps the higher due mileage when an old reading completes the reminder", () => {
    const r = completeSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 60000 }, new Date(2026, 9, 1), 30000)
    expect(r.nextDueMileage).toBe(60000)
  })

  it("moves the due mileage forward from a current reading", () => {
    const r = completeSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 60000 }, new Date(2026, 9, 1), 58000)
    expect(r.nextDueMileage).toBe(63000)
  })

  it("uses the computed due mileage when there was none, and keeps equal values", () => {
    expect(completeSchedule({ ...base, intervalMiles: 5000 }, new Date(2026, 9, 1), 1000).nextDueMileage).toBe(6000)
    expect(completeSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 6000 }, new Date(2026, 9, 1), 1000).nextDueMileage).toBe(6000)
  })

  it("applies the rule to each side on its own when both intervals are set", () => {
    const r = completeSchedule(
      { ...base, intervalDays: 365, intervalMiles: 5000, nextDueDate: new Date(2027, 9, 10), nextDueMileage: 40000 },
      new Date(2023, 9, 13),
      41000,
    )
    expect(r.nextDueDate).toEqual(new Date(2027, 9, 10))
    expect(r.nextDueMileage).toBe(46000)
  })

  it("keeps the later last-completed date and its reading when an older completion is filed", () => {
    const r = completeSchedule(
      { ...base, intervalDays: 365, lastCompletedDate: new Date(2026, 8, 1), lastCompletedMileage: 50000 },
      new Date(2023, 9, 13),
      30000,
    )
    expect(r.lastCompletedDate).toEqual(new Date(2026, 8, 1))
    expect(r.lastCompletedMileage).toBe(50000)
  })

  it("does not change the date it was given", () => {
    const done = new Date(2026, 9, 1)
    completeSchedule({ ...base, intervalDays: 30 }, done, null)
    expect(done).toEqual(new Date(2026, 9, 1))
  })
})

describe("completionCategory", () => {
  it("logs asset work as routine and leaves people's uncategorized", () => {
    expect(completionCategory("VEHICLE")).toBe("ROUTINE")
    expect(completionCategory("EQUIPMENT")).toBe("ROUTINE")
    expect(completionCategory("PERSON")).toBeNull()
  })
})

describe("skipSchedule", () => {
  const now = new Date(2026, 9, 9, 12)

  it("moves a date one interval on from where it was due", () => {
    const r = skipSchedule({ ...base, intervalDays: 30, nextDueDate: new Date(Date.UTC(2026, 9, 20)) }, now, null)
    expect(r.nextDueDate).toEqual(new Date(Date.UTC(2026, 10, 19)))
  })

  it("keeps stepping until the next one is ahead, so a long-overdue reminder isn't still overdue", () => {
    const r = skipSchedule({ ...base, intervalDays: 30, nextDueDate: new Date(2026, 6, 1) }, now, null)
    expect(r.nextDueDate).toEqual(new Date(2026, 9, 29))
  })

  it("steps mileage past the current reading", () => {
    expect(skipSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 50000 }, now, 49000).nextDueMileage).toBe(55000)
    expect(skipSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 50000 }, now, 61000).nextDueMileage).toBe(65000)
    expect(skipSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 50000 }, now, null).nextDueMileage).toBe(55000)
  })

  it("leaves a side with no interval or no due value alone, and never touches last done", () => {
    const due = new Date(2026, 9, 1)
    const r = skipSchedule({ ...base, intervalMiles: 5000, nextDueMileage: 50000, nextDueDate: due, lastCompletedDate: due }, now, 49000)
    expect(r.nextDueDate).toBe(due)
    expect(r).not.toHaveProperty("lastCompletedDate")
    expect(skipSchedule({ ...base, intervalDays: 30 }, now, null).nextDueDate).toBeNull()
  })

  it("does not change the dates it was given", () => {
    const due = new Date(2026, 9, 20)
    skipSchedule({ ...base, intervalDays: 30, nextDueDate: due }, now, null)
    expect(due).toEqual(new Date(2026, 9, 20))
  })
})

describe("canSkip", () => {
  it("needs an interval with a due value on the same side", () => {
    expect(canSkip({ ...base, intervalDays: 30, nextDueDate: new Date() })).toBe(true)
    expect(canSkip({ ...base, intervalMiles: 5000, nextDueMileage: 100 })).toBe(true)
    expect(canSkip({ ...base, intervalDays: 30, nextDueMileage: 100 })).toBe(false)
    expect(canSkip({ ...base, nextDueDate: new Date() })).toBe(false)
  })
})

describe("completionRecordData", () => {
  const schedule = { assetType: "VEHICLE" as const, assetId: "v1", title: "Oil change" }
  const date = new Date(2026, 9, 1)

  it("logs the reminder's title with what was entered", () => {
    expect(completionRecordData(schedule, { date, mileage: 41000, vendor: "Jiffy", cost: 59.99, notes: "Synthetic" }, "u1")).toEqual({
      assetType: "VEHICLE", assetId: "v1", date, title: "Oil change", description: "Synthetic", vendor: "Jiffy", cost: 59.99,
      category: "ROUTINE", mileageAtService: 41000, roomId: null, createdById: "u1",
    })
  })

  it("files the record in the reminder's room", () => {
    const r = completionRecordData({ assetType: "PROPERTY", assetId: "p1", title: "Clean gutters", roomId: "r1" }, { date, mileage: null, vendor: "", cost: null, notes: "" }, "u1")
    expect(r.roomId).toBe("r1")
  })

  it("stores blanks as empty, not zero", () => {
    const r = completionRecordData(schedule, { date, mileage: null, vendor: "", cost: null, notes: "" }, "u1")
    expect(r).toMatchObject({ description: null, vendor: null, cost: null, mileageAtService: null })
  })

  it("keeps a reading only on a vehicle, and leaves a person's record uncategorized", () => {
    const r = completionRecordData({ ...schedule, assetType: "PERSON" }, { date, mileage: 5, vendor: "", cost: 0, notes: "" }, "u1")
    expect(r).toMatchObject({ mileageAtService: null, category: null, cost: 0 })
  })
})

describe("one-time reminders", () => {
  it("clears the due date when completed", () => {
    const r = completeSchedule({ ...base, nextDueDate: new Date("2026-05-01T12:00Z") }, new Date("2026-05-10T12:00Z"), null)
    expect(r.nextDueDate).toBeNull()
    expect(r.nextDueMileage).toBeNull()
    expect(r.lastCompletedDate).toEqual(new Date("2026-05-10T12:00Z"))
  })

  it("clears a mileage-only due value when completed", () => {
    const r = completeSchedule({ ...base, nextDueMileage: 60000 }, new Date("2026-05-10T12:00Z"), 60250)
    expect(r.nextDueMileage).toBeNull()
    expect(r.lastCompletedMileage).toBe(60250)
  })

  it("can't be skipped", () => {
    expect(canSkip({ ...base, nextDueDate: new Date("2026-05-01T12:00Z") })).toBe(false)
  })
})

describe("calendar reminders", () => {
  const cal = { ...base, dueMonths: "4,10", dueDay: 1, nextDueDate: new Date("2026-04-01T12:00Z") }

  it("moves to the next listed month after an early completion", () => {
    expect(completeSchedule(cal, new Date("2026-03-25T12:00Z"), null).nextDueDate?.toISOString()).toBe("2026-10-01T12:00:00.000Z")
  })

  it("moves to the next listed month after a late completion", () => {
    expect(completeSchedule(cal, new Date("2026-05-10T12:00Z"), null).nextDueDate?.toISOString()).toBe("2026-10-01T12:00:00.000Z")
  })

  it("skips to the next listed month", () => {
    expect(skipSchedule(cal, new Date("2026-04-03T12:00Z"), null).nextDueDate?.toISOString()).toBe("2026-10-01T12:00:00.000Z")
  })

  it("can be skipped while it has a due date", () => {
    expect(canSkip(cal)).toBe(true)
    expect(canSkip({ ...cal, nextDueDate: null })).toBe(false)
  })
})
