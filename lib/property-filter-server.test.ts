import { beforeEach, describe, expect, it, vi } from "vitest"

const { db, enabled, cookieGet, cookies } = vi.hoisted(() => {
  const cookieGet = vi.fn()
  return {
    db: {
      propertyFindUnique: vi.fn(),
      propertyFindMany: vi.fn(),
      equipment: vi.fn(),
      vehicle: vi.fn(),
      person: vi.fn(),
      schedule: vi.fn(),
      warranty: vi.fn(),
      policy: vi.fn(),
      medication: vi.fn(),
      immunization: vi.fn(),
    },
    enabled: vi.fn(),
    cookieGet,
    cookies: vi.fn(async () => ({ get: cookieGet })),
  }
})
vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: { findUnique: db.propertyFindUnique, findMany: db.propertyFindMany },
    equipment: { findMany: db.equipment },
    vehicle: { findMany: db.vehicle },
    person: { findMany: db.person },
    maintenanceSchedule: { findMany: db.schedule },
    warranty: { findMany: db.warranty },
    insurancePolicy: { findMany: db.policy },
    medication: { findMany: db.medication },
    immunization: { findMany: db.immunization },
  },
}))
vi.mock("next/headers", () => ({ cookies }))
vi.mock("@/lib/features-server", () => ({ loadPropertyFilterEnabled: enabled }))

import { buildScope, ownedScopeWhere, policyScopeWhere } from "./property-filter"
import { loadHiddenEntityIds, loadPropertyFilterChoices, loadPropertyScope } from "./property-filter-server"

const allDb = () => Object.values(db)

beforeEach(() => {
  vi.resetAllMocks()
  cookies.mockImplementation(async () => ({ get: cookieGet }))
})

describe("loadPropertyScope", () => {
  it("is null with the switch off, without reading cookies or the database", async () => {
    enabled.mockResolvedValue(false)
    expect(await loadPropertyScope()).toBeNull()
    expect(cookies).not.toHaveBeenCalled()
    for (const m of allDb()) expect(m).not.toHaveBeenCalled()
  })

  it("is null with the switch on and no cookie", async () => {
    enabled.mockResolvedValue(true)
    cookieGet.mockReturnValue(undefined)
    expect(await loadPropertyScope()).toBeNull()
    for (const m of allDb()) expect(m).not.toHaveBeenCalled()
  })

  it("builds the scope for a selected property", async () => {
    enabled.mockResolvedValue(true)
    cookieGet.mockReturnValue({ name: "hc-property", value: "R" })
    const property = { id: "R", name: "Rental" }
    const equipment = [{ id: "e1", propertyId: "R" }, { id: "e2", propertyId: "H" }]
    const vehicles = [{ id: "v1", propertyId: "R" }, { id: "v2", propertyId: null }]
    const people = [{ id: "p1", propertyId: null }]
    db.propertyFindUnique.mockResolvedValue(property)
    db.equipment.mockResolvedValue(equipment)
    db.vehicle.mockResolvedValue(vehicles)
    db.person.mockResolvedValue(people)
    expect(await loadPropertyScope()).toEqual(buildScope({ property, equipment, vehicles, people }))
    expect(db.propertyFindUnique).toHaveBeenCalledWith({ where: { id: "R" }, select: { id: true, name: true } })
  })

  it("is null when the property was deleted", async () => {
    enabled.mockResolvedValue(true)
    cookieGet.mockReturnValue({ name: "hc-property", value: "gone" })
    db.propertyFindUnique.mockResolvedValue(null)
    db.equipment.mockResolvedValue([])
    db.vehicle.mockResolvedValue([])
    db.person.mockResolvedValue([])
    expect(await loadPropertyScope()).toBeNull()
  })
})

describe("loadHiddenEntityIds", () => {
  it("is empty for no scope, without a query", async () => {
    expect(await loadHiddenEntityIds(null)).toEqual([])
    for (const m of allDb()) expect(m).not.toHaveBeenCalled()
  })

  it("unions ids of hidden schedules, warranties, policies and health records", async () => {
    const scope = buildScope({
      property: { id: "R", name: "Rental" },
      equipment: [{ id: "e2", propertyId: "H" }],
      vehicles: [],
      people: [{ id: "p1", propertyId: "R" }, { id: "p2", propertyId: null }],
    })
    db.schedule.mockResolvedValue([{ id: "s1" }])
    db.warranty.mockResolvedValue([{ id: "w1" }])
    db.policy.mockResolvedValue([{ id: "i1" }])
    db.medication.mockResolvedValue([{ id: "m1" }])
    db.immunization.mockResolvedValue([{ id: "im1" }])
    const ids = await loadHiddenEntityIds(scope)
    expect([...ids].sort()).toEqual(["i1", "im1", "m1", "s1", "w1"])
    expect(db.schedule).toHaveBeenCalledWith({ where: { NOT: ownedScopeWhere(scope) }, select: { id: true } })
    expect(db.warranty).toHaveBeenCalledWith({ where: { NOT: ownedScopeWhere(scope) }, select: { id: true } })
    expect(db.policy).toHaveBeenCalledWith({ where: { NOT: policyScopeWhere(scope) }, select: { id: true } })
    const hidden = { personId: { in: ["p2"] } }
    expect(db.medication).toHaveBeenCalledWith({ where: hidden, select: { id: true } })
    expect(db.immunization).toHaveBeenCalledWith({ where: hidden, select: { id: true } })
  })

  it("skips health record queries when no person is hidden", async () => {
    const scope = buildScope({ property: { id: "R", name: "Rental" }, equipment: [], vehicles: [], people: [] })
    db.schedule.mockResolvedValue([])
    db.warranty.mockResolvedValue([])
    db.policy.mockResolvedValue([])
    expect(await loadHiddenEntityIds(scope)).toEqual([])
    expect(db.medication).not.toHaveBeenCalled()
    expect(db.immunization).not.toHaveBeenCalled()
  })
})

describe("loadPropertyFilterChoices", () => {
  const scope = buildScope({ property: { id: "R", name: "Rental" }, equipment: [], vehicles: [], people: [] })

  it("is null when the switch is off", async () => {
    enabled.mockResolvedValue(false)
    expect(await loadPropertyFilterChoices(null)).toBeNull()
    expect(db.propertyFindMany).not.toHaveBeenCalled()
  })

  it("lists every property by name with no scope", async () => {
    enabled.mockResolvedValue(true)
    db.propertyFindMany.mockResolvedValue([{ id: "H", name: "Home" }, { id: "R", name: "Rental" }])
    expect(await loadPropertyFilterChoices(null)).toEqual([{ id: "H", name: "Home" }, { id: "R", name: "Rental" }])
    expect(db.propertyFindMany).toHaveBeenCalledWith({ orderBy: { name: "asc" }, select: { id: true, name: true } })
  })

  it("lists only the selected property under a scope", async () => {
    enabled.mockResolvedValue(true)
    db.propertyFindMany.mockResolvedValue([{ id: "R", name: "Rental" }])
    expect(await loadPropertyFilterChoices(scope)).toEqual([{ id: "R", name: "Rental" }])
    expect(db.propertyFindMany).toHaveBeenCalledWith({
      where: { id: "R" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    })
  })
})
