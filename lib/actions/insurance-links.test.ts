import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PropertyScope } from "@/lib/property-filter"

const { db, loadPropertyScope, loadFeatures } = vi.hoisted(() => ({
  db: {
    findUnique: vi.fn(),
    findMany: vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []),
    update: vi.fn((args: unknown) => args),
    people: vi.fn(),
    properties: vi.fn(),
    vehicles: vi.fn(),
  },
  loadPropertyScope: vi.fn(async (): Promise<PropertyScope | null> => null),
  loadFeatures: vi.fn(async () => ({ health: true })),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    insurancePolicy: { findUnique: db.findUnique, findMany: db.findMany, update: db.update },
    insuranceCoverage: { deleteMany: () => null, createMany: () => null },
    person: { findMany: db.people },
    property: { findMany: db.properties },
    vehicle: { findMany: db.vehicles },
    $transaction: async () => [],
  },
}))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect") } }))
vi.mock("@/lib/upload-fs", () => ({ removeUploadDir: async () => undefined }))
vi.mock("@/lib/features-server", () => ({ loadFeatures }))
vi.mock("@/lib/property-filter-server", () => ({ loadPropertyScope }))

import { updateInsurancePolicy } from "./insurance"
import { loadInsurancePage } from "@/lib/insurance-server"

const homeScope: PropertyScope = {
  propertyId: "home",
  propertyName: "Home",
  hiddenEquipmentIds: [],
  hiddenVehicleIds: ["boat"],
  hiddenPersonIds: ["ben"],
}

const named = (...ids: string[]) => ids.map((id) => ({ id, name: id }))

function setLists() {
  const data = db.update.mock.calls[0][0] as { data: Record<string, { set: { id: string }[] } | undefined> }
  const ids = (key: string) => data.data[key]?.set.map((r) => r.id)
  return { members: ids("members"), properties: ids("properties"), vehicles: ids("vehicles") }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadPropertyScope.mockResolvedValue(null)
  loadFeatures.mockResolvedValue({ health: true })
  db.people.mockResolvedValue(named("ana"))
  db.properties.mockResolvedValue(named("home"))
  db.vehicles.mockResolvedValue(named("car"))
})

describe("updateInsurancePolicy links", () => {
  it("keeps the Rental link on the umbrella when saved with Home selected", async () => {
    loadPropertyScope.mockResolvedValue(homeScope)
    db.findUnique
      .mockResolvedValueOnce({ id: "umb", kind: "UMBRELLA" })
      .mockResolvedValueOnce({ members: [], properties: named("home", "rental"), vehicles: named("car", "boat") })
    await updateInsurancePolicy("umb", { carrier: "Chubb", kind: "UMBRELLA", propertyIds: "home", vehicleIds: "" } as never)
    expect(setLists()).toMatchObject({ properties: ["home", "rental"], vehicles: ["boat"] })
    expect(db.properties.mock.calls[0][0].where).toEqual({ id: "home" })
  })

  it("keeps a family member the filter hides", async () => {
    loadPropertyScope.mockResolvedValue(homeScope)
    db.findUnique
      .mockResolvedValueOnce({ id: "bc", kind: "MEDICAL" })
      .mockResolvedValueOnce({ members: named("ana", "ben"), properties: [], vehicles: [] })
    await updateInsurancePolicy("bc", { carrier: "Blue Cross", kind: "MEDICAL", memberIds: "ana" } as never)
    expect(setLists().members).toEqual(["ana", "ben"])
  })

  it("writes exactly what was chosen without a scope", async () => {
    db.findUnique.mockResolvedValueOnce({ id: "umb", kind: "UMBRELLA" })
    await updateInsurancePolicy("umb", { carrier: "Chubb", kind: "UMBRELLA", propertyIds: "home", vehicleIds: "" } as never)
    expect(setLists()).toMatchObject({ properties: ["home"], vehicles: [] })
    expect(db.findUnique).toHaveBeenCalledTimes(1)
    expect(db.properties).not.toHaveBeenCalled()
  })
})

describe("loadInsurancePage", () => {
  it("names only in-scope links on each card under a scope", async () => {
    await loadInsurancePage(true, homeScope)
    const { include } = db.findMany.mock.calls[0][0] as { include: Record<string, { where?: unknown }> }
    expect(include.members.where).toEqual({ id: { notIn: ["ben"] } })
    expect(include.properties.where).toEqual({ id: "home" })
    expect(include.vehicles.where).toEqual({ id: { notIn: ["boat"] } })
  })

  it("filters no links without a scope, and drops members with Health off", async () => {
    db.findMany.mockResolvedValueOnce([{ id: "life", members: named("ana"), properties: [], vehicles: [] }] as never)
    const page = await loadInsurancePage(false)
    const { include } = db.findMany.mock.calls[0][0] as { include: Record<string, { where?: unknown }> }
    for (const key of ["members", "properties", "vehicles"]) expect(include[key].where).toEqual({})
    expect(page.policies[0].members).toEqual([])
    expect(db.people).not.toHaveBeenCalled()
  })
})
