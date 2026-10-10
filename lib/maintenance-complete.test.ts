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
