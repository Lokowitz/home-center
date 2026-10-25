import { describe, expect, it } from "vitest"
import {
  equipmentScopeWhere, notificationScopeWhere, ownedScopeWhere, personChildScopeWhere, personScopeWhere, policyScopeWhere,
  propertyScopeWhere, roomScopeWhere, vehicleScopeWhere, type PropertyScope,
} from "@/lib/property-filter"
import { ENTITY_KEYS, type EntityKey, type Row } from "./ontology"
import { entityScopeWhere, scopedNames, withScope } from "./property-scope"

const scopeOnR: PropertyScope = {
  propertyId: "pR",
  propertyName: "Rental",
  hiddenEquipmentIds: ["eH"],
  hiddenVehicleIds: ["vH"],
  hiddenPersonIds: ["ben"],
}
const hiddenEntityIds = ["w1", "m1"]

describe("entityScopeWhere", () => {
  it("adds nothing for any entity without a scope", () => {
    for (const key of ENTITY_KEYS) {
      expect(entityScopeWhere(key, {})).toEqual({})
      expect(entityScopeWhere(key, { scope: null, hiddenEntityIds: [] })).toEqual({})
    }
  })

  it("maps every entity to its fragment under a scope", () => {
    const expected: Record<EntityKey, Row> = {
      property: propertyScopeWhere(scopeOnR),
      vehicle: vehicleScopeWhere(scopeOnR),
      equipment: equipmentScopeWhere(scopeOnR),
      person: personScopeWhere(scopeOnR),
      room: roomScopeWhere(scopeOnR),
      healthCondition: personChildScopeWhere(scopeOnR),
      medication: personChildScopeWhere(scopeOnR),
      allergy: personChildScopeWhere(scopeOnR),
      immunization: personChildScopeWhere(scopeOnR),
      observation: personChildScopeWhere(scopeOnR),
      serviceRecord: ownedScopeWhere(scopeOnR),
      warranty: ownedScopeWhere(scopeOnR),
      maintenanceSchedule: ownedScopeWhere(scopeOnR),
      insurancePolicy: policyScopeWhere(scopeOnR),
      insurancePremium: { policy: { is: policyScopeWhere(scopeOnR) } },
      insuranceCoverage: { policy: { is: policyScopeWhere(scopeOnR) } },
      roomPaint: { room: { is: roomScopeWhere(scopeOnR) } },
      notification: notificationScopeWhere(hiddenEntityIds),
      provider: {},
    }
    for (const key of ENTITY_KEYS) {
      expect(entityScopeWhere(key, { scope: scopeOnR, hiddenEntityIds }), key).toEqual(expected[key])
    }
  })

  it("keeps notifications without hidden ids unfiltered", () => {
    expect(entityScopeWhere("notification", { scope: scopeOnR })).toEqual({})
  })
})

describe("withScope", () => {
  it("returns the where itself when the fragment is empty", () => {
    const where = { isActive: true }
    expect(withScope(where, {})).toBe(where)
  })
  it("ANDs a fragment without overwriting the where's own AND or OR", () => {
    const where = { AND: [{ a: 1 }], OR: [{ b: 1 }] }
    const fragment = { AND: [{ c: 1 }] }
    expect(withScope(where, fragment)).toEqual({ AND: [where, fragment] })
  })
})

describe("scopedNames", () => {
  const names = {
    PROPERTY: { pR: "Rental", pH: "Home" },
    VEHICLE: { vH: "Truck", v2: "Civic" },
    EQUIPMENT: { eH: "Home Boiler", e2: "Rental Furnace" },
    PERSON: { ben: "Ben", ana: "Ana" },
  }
  it("is the same object without a scope", () => {
    expect(scopedNames(names, null)).toBe(names)
    expect(scopedNames(names, undefined)).toBe(names)
  })
  it("drops assets and people outside the scope", () => {
    expect(scopedNames(names, scopeOnR)).toEqual({
      PROPERTY: { pR: "Rental" },
      VEHICLE: { v2: "Civic" },
      EQUIPMENT: { e2: "Rental Furnace" },
      PERSON: { ana: "Ana" },
    })
  })
})
