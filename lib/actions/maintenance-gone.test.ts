import { beforeEach, describe, expect, it, vi } from "vitest"

const { db } = vi.hoisted(() => ({
  db: { find: vi.fn(), update: vi.fn(), del: vi.fn(), transaction: vi.fn(), vehicle: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    maintenanceSchedule: { findUnique: db.find, update: db.update, delete: db.del },
    vehicle: { findUnique: db.vehicle },
    serviceRecord: { create: vi.fn() },
    notification: { updateMany: vi.fn() },
    $transaction: db.transaction,
  },
}))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect") } }))

import { GONE_MESSAGE } from "@/lib/gone"
import { RANGE_DATE_MESSAGE } from "@/lib/input-limits"
import { completeMaintenanceSchedule, deleteMaintenanceSchedule, skipMaintenanceSchedule, snoozeMaintenanceSchedule } from "./maintenance"

const p2025 = () => Object.assign(new Error("not found"), { code: "P2025" })
const schedule = (over: object = {}) => ({
  id: "s1", assetType: "PROPERTY", assetId: "a1", title: "Filter", intervalDays: 30, intervalMiles: null,
  nextDueDate: new Date("2026-11-01T00:00:00Z"), nextDueMileage: null, dueMonths: null, dueDay: null,
  lastCompletedDate: null, lastCompletedMileage: null, ...over,
})
const complete = { completedDate: "2026-10-25", completedMileage: "", logService: false, vendor: "", cost: "", notes: "" }

beforeEach(() => {
  vi.clearAllMocks()
  db.find.mockResolvedValue(schedule())
  db.transaction.mockResolvedValue([])
})

describe("deleteMaintenanceSchedule", () => {
  it("succeeds when the schedule is already gone", async () => {
    db.del.mockRejectedValue(p2025())
    expect(await deleteMaintenanceSchedule("s1", "PROPERTY", "a1")).toEqual({ success: true })
  })
  it("still throws other errors", async () => {
    db.del.mockRejectedValue(new Error("locked"))
    await expect(deleteMaintenanceSchedule("s1", "PROPERTY", "a1")).rejects.toThrow("locked")
  })
})

describe("completeMaintenanceSchedule", () => {
  it("returns an error, not a throw, for a huge stored interval", async () => {
    db.find.mockResolvedValue(schedule({ intervalDays: 99999999999 }))
    expect(await completeMaintenanceSchedule("s1", complete)).toEqual({ error: RANGE_DATE_MESSAGE })
    expect(db.transaction).not.toHaveBeenCalled()
  })
  it("returns the gone message when the schedule vanishes mid-write", async () => {
    db.transaction.mockRejectedValue(p2025())
    expect(await completeMaintenanceSchedule("s1", complete)).toEqual({ error: GONE_MESSAGE })
  })
  it("completes a normal schedule", async () => {
    expect(await completeMaintenanceSchedule("s1", complete)).toEqual({ success: true, serviceRecordId: null })
  })
})

describe("skipMaintenanceSchedule", () => {
  it("returns an error for a huge stored interval", async () => {
    db.find.mockResolvedValue(schedule({ intervalDays: 99999999999 }))
    expect(await skipMaintenanceSchedule("s1")).toEqual({ error: RANGE_DATE_MESSAGE })
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe("snoozeMaintenanceSchedule", () => {
  it("returns the gone message when the schedule vanishes mid-write", async () => {
    db.transaction.mockRejectedValue(p2025())
    expect(await snoozeMaintenanceSchedule("s1", "1d")).toEqual({ error: GONE_MESSAGE })
  })
})
