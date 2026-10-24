import { beforeEach, describe, expect, it, vi } from "vitest"

const { db, removeUploadDir } = vi.hoisted(() => ({
  db: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), conditionFind: vi.fn() },
  removeUploadDir: vi.fn(async () => undefined),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    observation: { findUnique: db.findUnique, updateMany: db.updateMany, deleteMany: db.deleteMany },
    healthCondition: { findFirst: db.conditionFind, findUnique: db.conditionFind },
  },
}))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect") } }))
vi.mock("@/lib/upload-fs", () => ({ removeUploadDir }))
vi.mock("@/lib/features-server", () => ({ requireHealth: async () => undefined }))

import { STALE_ENTRY } from "@/lib/observation-cards"
import { applyObservationEdit, deleteObservationIfUnchanged } from "./health"

const at = "2026-10-15T10:00:00.000Z"
const values = { date: "2026-10-14", time: "", type: "Meltdown", severity: "4", durationMinutes: "", conditionId: "", tags: "", notes: "" }

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ personId: "p1" })
})

describe("applyObservationEdit", () => {
  it("updates only if the entry is unchanged", async () => {
    db.updateMany.mockResolvedValue({ count: 1 })
    expect(await applyObservationEdit("o1", values, at)).toEqual({ success: true, id: "o1" })
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "o1", updatedAt: new Date(at) } }))
  })
  it("refuses a stale card", async () => {
    db.updateMany.mockResolvedValue({ count: 0 })
    expect(await applyObservationEdit("o1", values, at)).toEqual({ error: STALE_ENTRY })
  })
  it("returns field errors and never writes on bad values", async () => {
    const r = await applyObservationEdit("o1", { ...values, severity: "9" }, at)
    expect(typeof r.error).toBe("object")
    expect(db.updateMany).not.toHaveBeenCalled()
  })
  it("reports a missing entry", async () => {
    db.findUnique.mockResolvedValue(null)
    expect((await applyObservationEdit("o1", values, at)).error).toBeTruthy()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe("deleteObservationIfUnchanged", () => {
  it("deletes an unchanged entry and its uploads", async () => {
    db.deleteMany.mockResolvedValue({ count: 1 })
    expect(await deleteObservationIfUnchanged("o1", at)).toEqual({ success: true })
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: "o1", updatedAt: new Date(at) } })
    expect(removeUploadDir).toHaveBeenCalledWith("observation", "o1")
  })
  it("refuses a stale card and keeps uploads", async () => {
    db.deleteMany.mockResolvedValue({ count: 0 })
    expect(await deleteObservationIfUnchanged("o1", at)).toEqual({ error: STALE_ENTRY })
    expect(removeUploadDir).not.toHaveBeenCalled()
  })
})
