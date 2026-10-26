import { describe, expect, it } from "vitest"
import { completeSchema, scheduleSchema, templatePicksSchema } from "./maintenance-input"

const base = { assetId: "a1", assetType: "VEHICLE" as const, title: "Oil change" }
const schedule = (extra: Record<string, unknown>) => scheduleSchema.safeParse({ ...base, ...extra })

describe("scheduleSchema limits", () => {
  it("keeps the day interval from 1 to 3650", () => {
    expect(schedule({ intervalDays: "1" }).success).toBe(true)
    expect(schedule({ intervalDays: "3650" }).success).toBe(true)
    expect(schedule({ intervalDays: "3651" }).success).toBe(false)
    expect(schedule({ intervalDays: "99999999999" }).success).toBe(false)
    expect(schedule({ intervalDays: "0" }).success).toBe(false)
    expect(schedule({ intervalDays: "" }).success).toBe(true)
  })

  it("keeps the mile interval from 1 to 1,000,000", () => {
    expect(schedule({ intervalMiles: "1000000" }).success).toBe(true)
    expect(schedule({ intervalMiles: "1000001" }).success).toBe(false)
  })

  it("keeps the reminder lead times in the same ranges", () => {
    expect(schedule({ reminderDaysBefore: "3650", reminderMilesBefore: "1000000" }).success).toBe(true)
    expect(schedule({ reminderDaysBefore: "3651" }).success).toBe(false)
    expect(schedule({ reminderMilesBefore: "1000001" }).success).toBe(false)
    const r = schedule({})
    expect(r.success && [r.data.reminderDaysBefore, r.data.reminderMilesBefore]).toEqual([14, 500])
  })

  it("keeps the estimated cost from 0 to 10,000,000", () => {
    expect(schedule({ estimatedCost: "10000000" }).success).toBe(true)
    expect(schedule({ estimatedCost: "10000000.01" }).success).toBe(false)
    expect(schedule({ estimatedCost: "-1" }).success).toBe(false)
    expect(schedule({ estimatedCost: "1e21" }).success).toBe(false)
  })

  it("keeps the next due reading from 0 to 10,000,000 and the date from 1900 to 2200", () => {
    expect(schedule({ nextDueMileage: "10000000" }).success).toBe(true)
    expect(schedule({ nextDueMileage: "10000001" }).success).toBe(false)
    expect(schedule({ nextDueDate: "1900-01-01" }).success).toBe(true)
    expect(schedule({ nextDueDate: "2200-12-31" }).success).toBe(true)
    expect(schedule({ nextDueDate: "2201-01-01" }).success).toBe(false)
    expect(schedule({ nextDueDate: "9999-12-31" }).success).toBe(false)
  })

  it("limits the title to 200 characters", () => {
    expect(schedule({ title: "a".repeat(200) }).success).toBe(true)
    expect(schedule({ title: "a".repeat(201) }).success).toBe(false)
  })
})

describe("completeSchema limits", () => {
  const complete = (extra: Record<string, unknown>) => completeSchema.safeParse({ completedDate: "2026-05-01", ...extra })

  it("keeps the completion date between 1900 and 2200 and requires it", () => {
    expect(complete({}).success).toBe(true)
    expect(complete({ completedDate: "2200-12-31" }).success).toBe(true)
    expect(complete({ completedDate: "2201-01-01" }).success).toBe(false)
    expect(complete({ completedDate: "9999-12-31" }).success).toBe(false)
    expect(complete({ completedDate: "" }).success).toBe(false)
  })

  it("refuses a negative cost and caps cost and reading", () => {
    expect(complete({ cost: "10000000" }).success).toBe(true)
    expect(complete({ cost: "-5" }).success).toBe(false)
    expect(complete({ cost: "10000001" }).success).toBe(false)
    expect(complete({ completedMileage: "10000000" }).success).toBe(true)
    expect(complete({ completedMileage: "10000001" }).success).toBe(false)
  })

  it("limits the vendor to 200 characters", () => {
    expect(complete({ vendor: "a".repeat(200) }).success).toBe(true)
    expect(complete({ vendor: "a".repeat(201) }).success).toBe(false)
  })
})

describe("templatePicksSchema limits", () => {
  const pick = (extra: Record<string, unknown>) => templatePicksSchema.safeParse([{ key: "oil", ...extra }])

  it("keeps picked intervals in range", () => {
    expect(pick({ intervalDays: 3650, intervalMiles: 1_000_000 }).success).toBe(true)
    expect(pick({ intervalDays: 99999999 }).success).toBe(false)
    expect(pick({ intervalMiles: 1_000_001 }).success).toBe(false)
    expect(pick({ intervalDays: "" }).success).toBe(true)
  })
})
