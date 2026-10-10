import { describe, expect, it } from "vitest"
import { completeSchedule, completionCategory } from "./maintenance-complete"

const base = { intervalDays: null, intervalMiles: null, nextDueDate: null, nextDueMileage: null }

describe("completeSchedule", () => {
  it("counts the next due date and mileage from the completion", () => {
    const r = completeSchedule({ ...base, intervalDays: 90, intervalMiles: 5000 }, new Date(2026, 9, 1), 41000)
    expect(r.lastCompletedDate).toEqual(new Date(2026, 9, 1))
    expect(r.lastCompletedMileage).toBe(41000)
    expect(r.nextDueDate).toEqual(new Date(2026, 11, 30))
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
    const r = completeSchedule({ ...base, intervalDays: 90, nextDueDate: new Date(2026, 5, 1) }, new Date(2026, 8, 1), null)
    expect(r.nextDueDate).toEqual(new Date(2026, 10, 30))
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
