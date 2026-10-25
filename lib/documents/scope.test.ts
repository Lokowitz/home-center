import { describe, expect, it, vi } from "vitest"

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { attachment: { findMany } } }))

import { outOfScopeAttachmentIds } from "./scope"
import { attachmentOutOfScopeWhere, type PropertyScope } from "@/lib/property-filter"

const scope: PropertyScope = {
  propertyId: "rental",
  propertyName: "Rental",
  hiddenEquipmentIds: ["furnace"],
  hiddenVehicleIds: [],
  hiddenPersonIds: ["ben"],
}

describe("outOfScopeAttachmentIds", () => {
  it("is empty with no scope and doesn't query", async () => {
    findMany.mockClear()
    expect(await outOfScopeAttachmentIds(null)).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it("returns the ids of files the scope hides", async () => {
    findMany.mockReset().mockResolvedValue([{ id: "a1" }, { id: "a2" }])
    expect(await outOfScopeAttachmentIds(scope)).toEqual(["a1", "a2"])
    expect(findMany).toHaveBeenCalledWith({ where: attachmentOutOfScopeWhere(scope), select: { id: true } })
  })
})
