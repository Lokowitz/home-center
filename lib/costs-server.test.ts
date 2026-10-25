import { beforeEach, describe, expect, it, vi } from "vitest"

const { serviceFindMany, scheduleFindMany } = vi.hoisted(() => ({
  serviceFindMany: vi.fn(async (): Promise<unknown[]> => []),
  scheduleFindMany: vi.fn(async (): Promise<unknown[]> => []),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceRecord: { findMany: serviceFindMany },
    maintenanceSchedule: { findMany: scheduleFindMany },
  },
}))
vi.mock("@/lib/features-server", () => ({ loadFeatures: async () => ({ health: true }) }))

import { ownedScopeWhere, type PropertyScope } from "@/lib/property-filter"
import { loadCostRecords, loadPlannedSchedules } from "./costs-server"

const rental: PropertyScope = {
  propertyId: "rental",
  propertyName: "Rental",
  hiddenEquipmentIds: ["mower"],
  hiddenVehicleIds: ["boat"],
  hiddenPersonIds: ["sam"],
}

const whereOf = (fn: typeof serviceFindMany) => (fn.mock.calls[0] as unknown as [{ where: unknown }])[0].where

beforeEach(() => {
  serviceFindMany.mockClear()
  scheduleFindMany.mockClear()
})

describe("loadCostRecords", () => {
  it("leaves the where as today with no scope", async () => {
    await loadCostRecords({ scope: null })
    expect(whereOf(serviceFindMany)).toEqual({ cost: { not: null } })
  })

  it("adds the scope fragment when a property is selected", async () => {
    await loadCostRecords({ scope: rental })
    expect(whereOf(serviceFindMany)).toEqual({ cost: { not: null }, ...ownedScopeWhere(rental) })
  })

  it("keeps the scope with an asset type and no asset id", async () => {
    await loadCostRecords({ assetType: "VEHICLE", scope: rental })
    expect(whereOf(serviceFindMany)).toEqual({ cost: { not: null }, assetType: "VEHICLE", ...ownedScopeWhere(rental) })
  })

  it("ignores the scope for one asset", async () => {
    await loadCostRecords({ assetId: "mower", assetType: "EQUIPMENT", scope: rental })
    expect(whereOf(serviceFindMany)).toEqual({ cost: { not: null }, assetId: "mower", assetType: "EQUIPMENT" })
  })
})

describe("loadPlannedSchedules", () => {
  it("leaves the where as today with no scope", async () => {
    await loadPlannedSchedules({ assetType: "VEHICLE", scope: null })
    expect(whereOf(scheduleFindMany)).toEqual({ estimatedCost: { not: null }, assetType: "VEHICLE" })
  })

  it("adds the scope fragment when a property is selected", async () => {
    await loadPlannedSchedules({ scope: rental })
    expect(whereOf(scheduleFindMany)).toEqual({ estimatedCost: { not: null }, ...ownedScopeWhere(rental) })
  })

  it("ignores the scope for named assets", async () => {
    const assets = [{ assetType: "EQUIPMENT" as const, assetId: "mower" }]
    await loadPlannedSchedules({ assets, scope: rental })
    expect(whereOf(scheduleFindMany)).toEqual({
      estimatedCost: { not: null },
      OR: [{ assetType: "EQUIPMENT", assetId: "mower" }],
    })
  })
})
