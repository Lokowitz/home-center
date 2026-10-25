import { beforeEach, describe, expect, it, vi } from "vitest"

const updateMany = vi.fn()
const visibleNotificationsWhere = vi.fn()
const loadPropertyScope = vi.fn()
const loadHiddenEntityIds = vi.fn()

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/prisma", () => ({ prisma: { notification: { updateMany: (a: unknown) => updateMany(a) } } }))
vi.mock("@/lib/features-server", () => ({
  loadFeatures: async () => ({ health: false }),
  visibleNotificationsWhere: (f: unknown) => visibleNotificationsWhere(f),
}))
vi.mock("@/lib/property-filter-server", () => ({
  loadPropertyScope: () => loadPropertyScope(),
  loadHiddenEntityIds: (s: unknown) => loadHiddenEntityIds(s),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

import { markAllNotificationsRead } from "./notifications"
import { notificationScopeWhere } from "@/lib/property-filter"

beforeEach(() => {
  vi.clearAllMocks()
  visibleNotificationsWhere.mockResolvedValue({})
})

describe("markAllNotificationsRead", () => {
  it("leaves hidden-property notifications unread under a scope", async () => {
    loadPropertyScope.mockResolvedValue({ propertyId: "p1" })
    loadHiddenEntityIds.mockResolvedValue(["s9", "med3"])
    await markAllNotificationsRead()
    const where = updateMany.mock.calls[0][0].where
    expect(where.userId).toBe("u1")
    expect(where.isRead).toBe(false)
    expect(where.AND).toContainEqual(notificationScopeWhere(["s9", "med3"]))
  })

  it("keeps both the health-off visibility OR and the scope OR", async () => {
    const vis = { OR: [{ type: { notIn: ["MEDICATION_REFILL"] } }, { relatedEntityId: null }] }
    visibleNotificationsWhere.mockResolvedValue(vis)
    loadPropertyScope.mockResolvedValue({ propertyId: "p1" })
    loadHiddenEntityIds.mockResolvedValue(["s9"])
    await markAllNotificationsRead()
    const where = updateMany.mock.calls[0][0].where
    expect(where.OR).toBeUndefined()
    expect(where.AND).toEqual([vis, notificationScopeWhere(["s9"])])
  })

  it("keeps today's where under no scope and loads nothing extra", async () => {
    loadPropertyScope.mockResolvedValue(null)
    loadHiddenEntityIds.mockResolvedValue([])
    await markAllNotificationsRead()
    const where = updateMany.mock.calls[0][0].where
    expect(where).toEqual({ userId: "u1", isRead: false })
    expect(visibleNotificationsWhere).not.toHaveBeenCalled()
    expect(loadHiddenEntityIds).not.toHaveBeenCalled()
  })
})
