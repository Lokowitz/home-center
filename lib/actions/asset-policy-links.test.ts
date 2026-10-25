import { beforeEach, describe, expect, it, vi } from "vitest"

const { db, requireHealth, revalidatePath, loadPropertyScope } = vi.hoisted(() => ({
  db: { policies: vi.fn(), propertyUpdate: vi.fn(), vehicleUpdate: vi.fn(), personUpdate: vi.fn() },
  requireHealth: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
  loadPropertyScope: vi.fn(async (): Promise<PropertyScope | null> => null),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    insurancePolicy: { findMany: db.policies },
    property: { update: db.propertyUpdate },
    vehicle: { update: db.vehicleUpdate },
    person: { update: db.personUpdate },
  },
}))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect") } }))
vi.mock("@/lib/asset-delete-server", () => ({ deleteAssetWithRecords: async () => undefined }))
vi.mock("@/lib/upload-fs", () => ({ removeUploadDir: async () => undefined }))
vi.mock("@/lib/features-server", () => ({ requireHealth }))
vi.mock("@/lib/property-filter-server", () => ({ loadPropertyScope }))

import { policyScopeWhere, type PropertyScope } from "@/lib/property-filter"
import { eligibleKinds } from "@/lib/insurance"
import { healthKindWhere } from "@/lib/insurance-server"
import { updateProperty } from "./properties"
import { updateVehicle } from "./vehicles"
import { updatePerson } from "./people"

const validProperty = { name: "Maple Street House", type: "HOUSE" as const, address: "12 Maple St" }
const validVehicle = { name: "Work Truck", make: "Ford", model: "F-150", year: 2020, meterUnit: "MILES" as const }
const validPerson = { name: "Jordan Rivera", relationship: "SELF" }

const homeScope: PropertyScope = {
  propertyId: "home",
  propertyName: "Home",
  hiddenEquipmentIds: [],
  hiddenVehicleIds: ["boat"],
  hiddenPersonIds: ["ben"],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireHealth.mockResolvedValue(undefined)
  loadPropertyScope.mockResolvedValue(null)
})

describe("assetPolicyLinks under the property filter", () => {
  it("asks only for in-scope policies, so an out-of-scope linked policy is never disconnected", async () => {
    loadPropertyScope.mockResolvedValue(homeScope)
    // The database applies the scope: the Rental-only auto policy linked to this vehicle isn't returned.
    db.policies.mockResolvedValue([{ id: "homeAuto", kind: "AUTO", vehicles: [] }])
    await updateVehicle("v1", validVehicle, ["homeAuto"])
    const { where } = db.policies.mock.calls[0][0]
    expect(where.AND).toContainEqual(policyScopeWhere(homeScope))
    expect(db.vehicleUpdate.mock.calls[0][0].data.insurancePolicies).toEqual({ connect: [{ id: "homeAuto" }], disconnect: [] })
  })

  it("scopes the property and person lookups too", async () => {
    loadPropertyScope.mockResolvedValue(homeScope)
    db.policies.mockResolvedValue([])
    await updateProperty("home", validProperty, [])
    await updatePerson("h1", { ...validPerson, insurancePolicyIds: "" })
    for (const call of db.policies.mock.calls) expect(call[0].where.AND).toContainEqual(policyScopeWhere(homeScope))
  })

  it("adds nothing to the lookup without a scope", async () => {
    db.policies.mockResolvedValue([])
    await updateVehicle("v1", validVehicle, [])
    expect(db.policies.mock.calls[0][0].where).toEqual({
      AND: [healthKindWhere(false), { kind: { in: eligibleKinds("vehicles", false) } }],
    })
  })
})

describe("updateProperty", () => {
  it("unlinks only this property from a shared policy", async () => {
    db.policies.mockResolvedValue([
      { id: "chubb", kind: "UMBRELLA", properties: [{ id: "p1" }] },
      { id: "sf", kind: "HOME", properties: [] },
    ])
    expect(await updateProperty("p1", validProperty, ["sf"])).toEqual({ success: true })
    expect(db.propertyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ insurancePolicies: { connect: [{ id: "sf" }], disconnect: [{ id: "chubb" }] } }),
      }),
    )
  })

  it("asks only for policies that can cover a property", async () => {
    db.policies.mockResolvedValue([])
    await updateProperty("p1", validProperty, [])
    const where = JSON.stringify(db.policies.mock.calls[0][0].where)
    expect(where).toContain('"kind":{"in":["HOME","RENTERS","AUTO","UMBRELLA","PROPERTY_OTHER"]}')
    expect(where).toContain('"kind":{"notIn":["MEDICAL","DENTAL","VISION","OTHER"]}')
  })

  it("leaves links alone when no ids are sent", async () => {
    await updateProperty("p1", validProperty)
    expect(db.policies).not.toHaveBeenCalled()
    expect(db.propertyUpdate.mock.calls[0][0].data).not.toHaveProperty("insurancePolicies")
  })

  it("revalidates the Insurance page when links change", async () => {
    db.policies.mockResolvedValue([{ id: "sf", kind: "HOME", properties: [] }])
    await updateProperty("p1", validProperty, ["sf"])
    const paths = revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toContain("/insurance")
    expect(paths).toContain("/assets/properties/p1")
  })

  it("writes nothing on invalid fields", async () => {
    const r = await updateProperty("p1", { ...validProperty, name: "" }, ["sf"])
    expect(r).toHaveProperty("error.name")
    expect(db.propertyUpdate).not.toHaveBeenCalled()
  })
})

describe("updateVehicle", () => {
  it("links an auto policy to this vehicle", async () => {
    db.policies.mockResolvedValue([{ id: "prog", kind: "AUTO", vehicles: [] }])
    await updateVehicle("v1", validVehicle, ["prog"])
    expect(db.vehicleUpdate.mock.calls[0][0].data.insurancePolicies).toEqual({ connect: [{ id: "prog" }], disconnect: [] })
  })
})

describe("updatePerson", () => {
  it("links health and life policies with Health on", async () => {
    db.policies.mockResolvedValue([
      { id: "bc", kind: "MEDICAL", members: [{ id: "h1" }] },
      { id: "life", kind: "LIFE", members: [] },
    ])
    await updatePerson("h1", { ...validPerson, insurancePolicyIds: "life" })
    expect(db.personUpdate.mock.calls[0][0].data.insurancePolicies).toEqual({ connect: [{ id: "life" }], disconnect: [{ id: "bc" }] })
    expect(revalidatePath.mock.calls.map((c) => c[0])).toContain("/insurance")
  })

  it("does nothing with Health off", async () => {
    requireHealth.mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"))
    await expect(updatePerson("h1", { ...validPerson, insurancePolicyIds: "life" })).rejects.toThrow()
    expect(db.policies).not.toHaveBeenCalled()
    expect(db.personUpdate).not.toHaveBeenCalled()
  })

  it("leaves links alone without the field", async () => {
    await updatePerson("h1", validPerson)
    expect(db.policies).not.toHaveBeenCalled()
    expect(db.personUpdate.mock.calls[0][0].data).not.toHaveProperty("insurancePolicies")
  })
})
