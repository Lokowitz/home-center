import { describe, expect, it } from "vitest"
import type { AssetType, Prisma } from "@/app/generated/prisma/client"
import {
  assetInScope,
  attachmentOutOfScopeWhere,
  buildScope,
  equipmentScopeWhere,
  filteredEmptyText,
  keepHiddenLinks,
  linkedOnlyHidden,
  newItemPropertyId,
  notificationScopeWhere,
  ownedScopeWhere,
  personChildScopeWhere,
  personScopeWhere,
  policyScopeWhere,
  propertyFilterCookie,
  propertyLinkWrite,
  propertyScopeWhere,
  readPropertyFilter,
  roomScopeWhere,
  vehicleScopeWhere,
} from "./property-filter"

describe("readPropertyFilter / propertyFilterCookie", () => {
  it("reads an id and treats empty, missing or 'all' as all", () => {
    expect(readPropertyFilter("ckabc123")).toBe("ckabc123")
    expect(readPropertyFilter(undefined)).toBeNull()
    expect(readPropertyFilter("")).toBeNull()
    expect(readPropertyFilter("all")).toBeNull()
  })
  it("rejects values that can't be an id", () => {
    expect(readPropertyFilter("a b")).toBeNull()
    expect(readPropertyFilter("x".repeat(65))).toBeNull()
  })
  it("writes a year-long site-wide cookie, and clears it for all", () => {
    expect(propertyFilterCookie("p1")).toBe("hc-property=p1; path=/; max-age=31536000; samesite=lax")
    expect(propertyFilterCookie(null)).toBe("hc-property=; path=/; max-age=0; samesite=lax")
  })
})

// Fixtures: home H, rental R. Equipment: furnace F1 on H, boiler F2 on R, mower F3 unassigned.
// Vehicles: car V1 on H, truck V2 on R, trailer V3 unlinked.
// People (household of four): Ana on R, Ben, Cara, Dev unlinked.
const H = { id: "H", name: "Home" }
const R = { id: "R", name: "Rental" }
const equipment = [
  { id: "F1", propertyId: "H" },
  { id: "F2", propertyId: "R" },
  { id: "F3", propertyId: null },
]
const vehicles = [
  { id: "V1", propertyId: "H" },
  { id: "V2", propertyId: "R" },
  { id: "V3", propertyId: null },
]
const people = [
  { id: "Ana", propertyId: "R" },
  { id: "Ben", propertyId: null },
  { id: "Cara", propertyId: null },
  { id: "Dev", propertyId: null },
]
const scopeOnH = buildScope({ property: H, equipment, vehicles, people })
const scopeOnR = buildScope({ property: R, equipment, vehicles, people })

function split(key: string): [AssetType, string] {
  const [type, id] = key.split(":")
  return [type as AssetType, id]
}

describe("linkedOnlyHidden", () => {
  it("hides nothing when no row is linked to the property", () => {
    expect(linkedOnlyHidden(people, "H")).toEqual([])
  })
  it("hides unlinked rows and rows linked elsewhere once one is linked", () => {
    expect(linkedOnlyHidden(people, "R").sort()).toEqual(["Ben", "Cara", "Dev"])
    expect(linkedOnlyHidden(vehicles, "H").sort()).toEqual(["V2", "V3"])
  })
})

describe("buildScope", () => {
  it("hides equipment on other properties and keeps unassigned equipment", () => {
    expect(buildScope({ property: H, equipment, vehicles, people }).hiddenEquipmentIds).toEqual(["F2"])
  })
  it("applies the linked-only rule to vehicles and people separately", () => {
    const onH = buildScope({ property: H, equipment, vehicles, people })
    expect(onH.hiddenVehicleIds.sort()).toEqual(["V2", "V3"])
    expect(onH.hiddenPersonIds).toEqual([])
    const onR = buildScope({ property: R, equipment, vehicles, people })
    expect(onR.hiddenVehicleIds.sort()).toEqual(["V1", "V3"])
    expect(onR.hiddenPersonIds.sort()).toEqual(["Ben", "Cara", "Dev"])
  })
})

describe("assetInScope", () => {
  it("is true for everything without a scope", () => {
    expect(assetInScope(null, "PERSON", "Ben")).toBe(true)
  })
  it("on Rental keeps Rental, its and unassigned equipment, the truck and Ana", () => {
    const s = buildScope({ property: R, equipment, vehicles, people })
    expect(["PROPERTY:R", "EQUIPMENT:F2", "EQUIPMENT:F3", "VEHICLE:V2", "PERSON:Ana"].every((k) => assetInScope(s, ...split(k)))).toBe(true)
    expect(["PROPERTY:H", "EQUIPMENT:F1", "VEHICLE:V1", "VEHICLE:V3", "PERSON:Ben"].some((k) => assetInScope(s, ...split(k)))).toBe(false)
  })
  it("on Home keeps all four people (none linked to Home)", () => {
    const s = buildScope({ property: H, equipment, vehicles, people })
    expect(["Ana", "Ben", "Cara", "Dev"].every((p) => assetInScope(s, "PERSON", p))).toBe(true)
  })
})

type Row = { assetType: string; assetId: string }
type Cond = Record<string, unknown>

// Evaluates the AND / OR / not / notIn / equals subset the scope fragments use.
function matches(row: Row, where: Cond): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Cond[]).every((c) => matches(row, c))
    if (key === "OR") return (cond as Cond[]).some((c) => matches(row, c))
    const value = row[key as keyof Row]
    if (typeof cond === "string") return value === cond
    const op = cond as { not?: string; notIn?: string[]; equals?: string }
    if (op.not !== undefined && value === op.not) return false
    if (op.notIn !== undefined && op.notIn.includes(value)) return false
    if (op.equals !== undefined && value !== op.equals) return false
    return true
  })
}

describe("ownedScopeWhere", () => {
  it("adds nothing without a scope", () => {
    expect(ownedScopeWhere(null)).toEqual({})
  })
  it("matches the spec's fragment", () => {
    expect(ownedScopeWhere(scopeOnR)).toEqual({
      AND: [
        { OR: [{ assetType: { not: "PROPERTY" } }, { assetId: "R" }] },
        { OR: [{ assetType: { not: "EQUIPMENT" } }, { assetId: { notIn: ["F1"] } }] },
        { OR: [{ assetType: { not: "VEHICLE" } }, { assetId: { notIn: ["V1", "V3"] } }] },
        { OR: [{ assetType: { not: "PERSON" } }, { assetId: { notIn: ["Ben", "Cara", "Dev"] } }] },
      ],
    })
  })
  it("drops the person clause when no person is hidden", () => {
    expect(ownedScopeWhere(scopeOnH)).toEqual({
      AND: [
        { OR: [{ assetType: { not: "PROPERTY" } }, { assetId: "H" }] },
        { OR: [{ assetType: { not: "EQUIPMENT" } }, { assetId: { notIn: ["F2"] } }] },
        { OR: [{ assetType: { not: "VEHICLE" } }, { assetId: { notIn: ["V2", "V3"] } }] },
      ],
    })
  })
  it("agrees with assetInScope on every fixture row", () => {
    const rows: Row[] = [
      ...[H, R, { id: "other", name: "Other" }].map((p) => ({ assetType: "PROPERTY", assetId: p.id })),
      ...equipment.map((e) => ({ assetType: "EQUIPMENT", assetId: e.id })),
      ...vehicles.map((v) => ({ assetType: "VEHICLE", assetId: v.id })),
      ...people.map((p) => ({ assetType: "PERSON", assetId: p.id })),
    ]
    for (const scope of [scopeOnH, scopeOnR]) {
      const where = ownedScopeWhere(scope) as Cond
      for (const row of rows) {
        expect(matches(row, where), `${scope.propertyId} ${row.assetType}:${row.assetId}`).toBe(
          assetInScope(scope, row.assetType as AssetType, row.assetId),
        )
      }
    }
  })
})

describe("ownedScopeWhere typing", () => {
  it("is assignable to each owned model's where input", () => {
    const w: Prisma.WarrantyWhereInput = ownedScopeWhere(scopeOnR)
    const s: Prisma.ServiceRecordWhereInput = ownedScopeWhere(scopeOnR)
    const m: Prisma.MaintenanceScheduleWhereInput = ownedScopeWhere(scopeOnR)
    expect([w, s, m]).toHaveLength(3)
  })
})

describe("per-model fragments", () => {
  it("add nothing without a scope", () => {
    expect(propertyScopeWhere(null)).toEqual({})
    expect(equipmentScopeWhere(null)).toEqual({})
    expect(vehicleScopeWhere(null)).toEqual({})
    expect(personScopeWhere(null)).toEqual({})
    expect(personChildScopeWhere(null)).toEqual({})
    expect(roomScopeWhere(null)).toEqual({})
    expect(policyScopeWhere(null)).toEqual({})
  })
  it("filter by the scope's ids", () => {
    expect(propertyScopeWhere(scopeOnR)).toEqual({ id: "R" })
    expect(equipmentScopeWhere(scopeOnR)).toEqual({ id: { notIn: ["F1"] } })
    expect(vehicleScopeWhere(scopeOnR)).toEqual({ id: { notIn: ["V1", "V3"] } })
    expect(personScopeWhere(scopeOnR)).toEqual({ id: { notIn: ["Ben", "Cara", "Dev"] } })
    expect(roomScopeWhere(scopeOnR)).toEqual({ propertyId: "R" })
  })
  it("drop empty hidden lists", () => {
    expect(equipmentScopeWhere(buildScope({ property: { id: "Z", name: "Z" }, equipment: [], vehicles: [], people: [] }))).toEqual({})
    expect(personScopeWhere(scopeOnH)).toEqual({})
    expect(personChildScopeWhere(scopeOnH)).toEqual({})
    expect(personChildScopeWhere(scopeOnR)).toEqual({ personId: { notIn: ["Ben", "Cara", "Dev"] } })
  })
})

// Policies: which properties, vehicles and people each one links.
type Policy = { id: string; properties: string[]; vehicles: string[]; members: string[] }
const policies: Policy[] = [
  { id: "homeOwners", properties: ["H"], vehicles: [], members: [] },
  { id: "rentalOwners", properties: ["R"], vehicles: [], members: [] },
  { id: "truckAuto", properties: [], vehicles: ["V2"], members: [] },
  { id: "familyHealth", properties: [], vehicles: [], members: ["Ana", "Ben"] },
  { id: "bensLife", properties: [], vehicles: [], members: ["Ben"] },
  { id: "umbrella", properties: ["H", "R"], vehicles: [], members: [] },
  { id: "unlinked", properties: [], vehicles: [], members: [] },
]

// Evaluates the none / some / id equals / id notIn subset policyScopeWhere uses.
function matchesPolicy(p: Policy, where: Cond): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Cond[]).some((c) => matchesPolicy(p, c))
    const ids = p[key as "properties" | "vehicles" | "members"]
    const rel = cond as { none?: object; some?: { id: string | { notIn: string[] } } }
    if (rel.none) return ids.length === 0
    const id = rel.some!.id
    return ids.some((x) => (typeof id === "string" ? x === id : !id.notIn.includes(x)))
  })
}

describe("policyScopeWhere", () => {
  const kept = (scope: typeof scopeOnH) =>
    policies.filter((p) => matchesPolicy(p, policyScopeWhere(scope) as Cond)).map((p) => p.id).sort()
  it("on Rental drops policies only linked to Home or hidden people", () => {
    expect(kept(scopeOnR)).toEqual(["familyHealth", "rentalOwners", "truckAuto", "umbrella", "unlinked"])
  })
  it("on Home drops policies only linked to Rental or hidden vehicles", () => {
    expect(kept(scopeOnH)).toEqual(["bensLife", "familyHealth", "homeOwners", "umbrella", "unlinked"])
  })
})

describe("attachmentOutOfScopeWhere", () => {
  it("has six branches when no person is hidden", () => {
    expect((attachmentOutOfScopeWhere(scopeOnH).OR as unknown[]).length).toBe(6)
  })
  it("adds five health branches when people are hidden", () => {
    const or = attachmentOutOfScopeWhere(scopeOnR).OR as unknown[]
    expect(or.length).toBe(11)
    expect(or).toContainEqual({ room: { is: { propertyId: { not: "R" } } } })
    expect(or).toContainEqual({ recordType: "DOCUMENT", NOT: ownedScopeWhere(scopeOnR) })
    expect(or).toContainEqual({ healthCondition: { is: { personId: { in: ["Ben", "Cara", "Dev"] } } } })
  })
})

describe("notificationScopeWhere", () => {
  it("adds nothing without hidden entities", () => {
    expect(notificationScopeWhere([])).toEqual({})
  })
  it("keeps notifications without an entity", () => {
    expect(notificationScopeWhere(["s1"])).toEqual({
      OR: [{ relatedEntityId: null }, { relatedEntityId: { notIn: ["s1"] } }],
    })
  })
})

describe("keepHiddenLinks", () => {
  it("keeps current links the user couldn't see", () => {
    expect(keepHiddenLinks(["H", "R"], ["H"], ["H"])).toEqual(["H", "R"])
    expect(keepHiddenLinks(["H", "R"], [], ["H"])).toEqual(["R"])
    expect(keepHiddenLinks(["H"], ["H", "X"], ["H", "X"])).toEqual(["H", "X"])
  })
})

describe("filteredEmptyText", () => {
  it("names the property", () => {
    expect(filteredEmptyText(scopeOnH)).toBe("Nothing here for Home. Switch to All properties to see everything.")
    expect(filteredEmptyText(null)).toBeNull()
  })
})

describe("propertyLinkWrite", () => {
  it("leaves the link alone when the field wasn't sent", () => {
    expect(propertyLinkWrite(undefined)).toEqual({})
  })
  it("clears it for Not assigned and sets it for an id", () => {
    expect(propertyLinkWrite("")).toEqual({ propertyId: null })
    expect(propertyLinkWrite("p1")).toEqual({ propertyId: "p1" })
  })
})

describe("newItemPropertyId", () => {
  it("is null with no scope", () => {
    expect(newItemPropertyId(null, [{ propertyId: "H" }])).toBeNull()
  })
  it("is null when nothing is linked to the selected property", () => {
    expect(newItemPropertyId(scopeOnH, [])).toBeNull()
    expect(newItemPropertyId(scopeOnH, [{ propertyId: null }, { propertyId: "R" }])).toBeNull()
  })
  it("is the selected property once something is linked to it", () => {
    expect(newItemPropertyId(scopeOnH, [{ propertyId: "H" }])).toBe("H")
  })
})
