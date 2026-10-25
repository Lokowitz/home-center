import { describe, expect, it } from "vitest"
import {
  compileInclude, compileLimit, compileSort, compileWhere, entityDef, inDayRange, requireDay, selectFor, ToolInputError,
} from "./query"
import { ownedScopeWhere, personChildScopeWhere } from "@/lib/property-filter"

const ctx = { userId: "u1", now: new Date("2026-09-26T12:00:00Z") }

describe("entityDef", () => {
  it("accepts exact, cased, plural and spaced names", () => {
    expect(entityDef("vehicle").key).toBe("vehicle")
    expect(entityDef("Vehicles").key).toBe("vehicle")
    expect(entityDef("properties").key).toBe("property")
    expect(entityDef("service_records").key).toBe("serviceRecord")
    expect(entityDef("Insurance Policies").key).toBe("insurancePolicy")
  })
  it("rejects excluded tables", () => {
    for (const bad of ["user", "users", "mailSettings", "llmSettings", "attachment", "account"]) {
      expect(() => entityDef(bad)).toThrow(ToolInputError)
    }
    expect(() => entityDef("user")).toThrow(/Valid entities: property, vehicle/)
  })
})

describe("requireDay", () => {
  it("parses YYYY-MM-DD as UTC midnight, tolerating a time suffix", () => {
    expect(requireDay("2025-03-01", "d")).toEqual(new Date("2025-03-01T00:00:00.000Z"))
    expect(requireDay("2025-03-01T15:00:00Z", "d")).toEqual(new Date("2025-03-01T00:00:00.000Z"))
  })
  it("rejects vague or impossible dates", () => {
    expect(() => requireDay("last year", "date")).toThrow(/date needs a date as YYYY-MM-DD/)
    expect(() => requireDay("2025", "date")).toThrow(ToolInputError)
    expect(() => requireDay("2025-02-30", "date")).toThrow(ToolInputError)
  })
})

describe("compileWhere", () => {
  it("builds simple conditions", () => {
    expect(compileWhere("vehicle", [{ field: "year", op: "gte", value: 2015 }], ctx)).toEqual({
      where: { AND: [{ year: { gte: 2015 } }] },
      assetName: null,
      related: [],
    })
  })

  it("returns an empty where with no filters", () => {
    expect(compileWhere("vehicle", undefined, ctx).where).toEqual({})
  })

  it("coerces numeric strings, money strings and enum casing", () => {
    const { where } = compileWhere("serviceRecord", [
      { field: "cost", op: "gt", value: "$1,200" },
      { field: "category", op: "eq", value: "repair" },
      { field: "assetType", op: "in", value: ["vehicle", "Equipment"] },
      { field: "mileageAtService", op: "lt", value: "90000" },
    ], ctx)
    expect(where).toEqual({
      AND: [
        { cost: { gt: 1200 } },
        { category: { equals: "REPAIR" } },
        { assetType: { in: ["VEHICLE", "EQUIPMENT"] } },
        { mileageAtService: { lt: 90000 } },
      ],
    })
  })

  it("turns dates into whole UTC days, since stored dates can carry a time", () => {
    const day = new Date("2025-01-01T00:00:00.000Z")
    const next = new Date("2025-01-02T00:00:00.000Z")
    const date = (op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte") =>
      compileWhere("serviceRecord", [{ field: "date", op, value: "2025-01-01" }], ctx).where
    expect(date("eq")).toEqual({ AND: [{ date: { gte: day, lt: next } }] })
    expect(date("ne")).toEqual({ AND: [{ NOT: { date: { gte: day, lt: next } } }] })
    expect(date("lte")).toEqual({ AND: [{ date: { lt: next } }] })
    expect(date("gt")).toEqual({ AND: [{ date: { gte: next } }] })
    expect(date("gte")).toEqual({ AND: [{ date: { gte: day } }] })
    expect(date("lt")).toEqual({ AND: [{ date: { lt: day } }] })
    expect(() => compileWhere("serviceRecord", [{ field: "date", op: "in", value: ["2025-01-01"] }], ctx)).toThrow(ToolInputError)
  })

  it("matches strings exactly but ignoring case", () => {
    const where = (op: "eq" | "ne" | "in", value: unknown) => compileWhere("vehicle", [{ field: "make", op, value }], ctx).where
    expect(where("eq", "honda")).toEqual({ AND: [{ make: { startsWith: "honda", endsWith: "honda" } }] })
    expect(where("ne", "honda")).toEqual({ AND: [{ NOT: { make: { startsWith: "honda", endsWith: "honda" } } }] })
    expect(where("in", ["honda", "Ford"])).toEqual({
      AND: [{ OR: [{ make: { startsWith: "honda", endsWith: "honda" } }, { make: { startsWith: "Ford", endsWith: "Ford" } }] }],
    })
  })

  it("allows eq/in on ids and foreign keys, exactly", () => {
    expect(compileWhere("medication", [{ field: "personId", op: "eq", value: "p1" }], ctx).where).toEqual({
      AND: [{ personId: { equals: "p1" } }],
    })
    expect(compileWhere("vehicle", [{ field: "id", op: "in", value: ["v1", "v2"] }], ctx).where).toEqual({
      AND: [{ id: { in: ["v1", "v2"] } }],
    })
    expect(() => compileWhere("medication", [{ field: "personId", op: "contains", value: "p" }], ctx)).toThrow(/Allowed: eq, in/)
  })

  it("rejects bad enum values with the allowed list", () => {
    expect(() => compileWhere("serviceRecord", [{ field: "category", op: "eq", value: "fun" }], ctx)).toThrow(
      /category must be one of ROUTINE, REPAIR/
    )
  })

  it("rejects unknown and excluded fields with the valid list", () => {
    expect(() => compileWhere("vehicle", [{ field: "imageFilename", op: "isNull", value: true }], ctx)).toThrow(
      /Valid fields: name, make, model/
    )
    expect(() => compileWhere("serviceRecord", [{ field: "createdById", op: "eq", value: "x" }], ctx)).toThrow(ToolInputError)
  })

  it("rejects operators that don't fit the type", () => {
    expect(() => compileWhere("vehicle", [{ field: "year", op: "contains", value: "20" }], ctx)).toThrow(
      /Allowed: eq, ne, gt, gte, lt, lte, isNull/
    )
  })

  it("lets an enum be filtered on null, so equipment left on the category default can be found", () => {
    expect(compileWhere("equipment", [{ field: "valueClass", op: "isNull", value: true }], ctx).where).toEqual({ AND: [{ valueClass: null }] })
  })

  it("handles isNull both ways and 'in' needing an array", () => {
    expect(compileWhere("medication", [{ field: "endDate", op: "isNull", value: true }], ctx).where).toEqual({ AND: [{ endDate: null }] })
    expect(compileWhere("medication", [{ field: "endDate", op: "isNull", value: false }], ctx).where).toEqual({ AND: [{ endDate: { not: null } }] })
    expect(() => compileWhere("vehicle", [{ field: "make", op: "in", value: "Honda" }], ctx)).toThrow(/non-empty array/)
  })

  it("follows one relation hop", () => {
    expect(compileWhere("medication", [{ field: "person.name", op: "contains", value: "anna" }], ctx).where).toEqual({
      AND: [{ person: { is: { name: { contains: "anna" } } } }],
    })
    expect(compileWhere("insurancePolicy", [{ field: "members.name", op: "eq", value: "Anna" }], ctx).where).toEqual({
      AND: [{ members: { some: { name: { startsWith: "Anna", endsWith: "Anna" } } } }],
    })
    expect(compileWhere("medication", [{ field: "person.name", op: "in", value: ["anna"] }], ctx).where).toEqual({
      AND: [{ person: { is: { OR: [{ name: { startsWith: "anna", endsWith: "anna" } }] } } }],
    })
  })

  it("rejects deeper paths, list-of-children filters and excluded relations", () => {
    expect(() => compileWhere("medication", [{ field: "person.primaryProvider.name", op: "eq", value: "x" }], ctx)).toThrow(/one relation/)
    expect(() => compileWhere("vehicle", [{ field: "serviceRecords.cost", op: "gt", value: 1 }], ctx)).toThrow(/"op":"has"/)
    expect(() => compileWhere("serviceRecord", [{ field: "createdBy.email", op: "eq", value: "x" }], ctx)).toThrow(ToolInputError)
  })

  it("returns asset.name filters separately", () => {
    expect(compileWhere("serviceRecord", [{ field: "asset.name", op: "contains", value: "Civic" }], ctx)).toEqual({
      where: {},
      assetName: { op: "contains", value: "Civic" },
      related: [],
    })
    expect(() => compileWhere("serviceRecord", [{ field: "asset.year", op: "eq", value: 1 }], ctx)).toThrow(/asset.name/)
  })

  it("keeps rows that have, or lack, related rows on a list relation", () => {
    expect(compileWhere("person", [{ field: "allergies", op: "has" }], ctx).where).toEqual({ AND: [{ allergies: { some: {} } }] })
    expect(
      compileWhere("person", [{ field: "medications", op: "hasNone", value: [{ field: "name", op: "contains", value: "statin" }] }], ctx).where
    ).toEqual({ AND: [{ medications: { none: { AND: [{ name: { contains: "statin" } }] } } }] })
  })

  it("hands has/hasNone on an asset's warranties or service records to the executor", () => {
    const r = compileWhere("vehicle", [
      { field: "make", op: "eq", value: "Honda" },
      { field: "serviceRecords", op: "hasNone", value: [{ field: "date", op: "gte", value: "2026-07-01" }] },
    ], ctx)
    expect(r.where).toEqual({ AND: [{ make: { startsWith: "Honda", endsWith: "Honda" } }] })
    expect(r.related).toEqual([
      { entity: "serviceRecord", assetType: "VEHICLE", op: "hasNone", where: { AND: [{ date: { gte: new Date("2026-07-01T00:00:00Z") } }] } },
    ])
  })

  it("explains has/hasNone misuse", () => {
    expect(() => compileWhere("medication", [{ field: "person", op: "has" }], ctx)).toThrow(/single record/)
    expect(() => compileWhere("vehicle", [{ field: "make", op: "has" }], ctx)).toThrow(/list relation/)
    expect(() => compileWhere("equipment", [{ field: "warranties", op: "has", value: "active" }], ctx)).toThrow(/list of conditions/)
    expect(() =>
      compileWhere("property", [{ field: "equipment", op: "has", value: [{ field: "warranties", op: "hasNone" }] }], ctx)
    ).toThrow(/can't be nested/)
  })

  it("never lets the model widen notification scope", () => {
    expect(compileWhere("notification", [{ field: "isRead", op: "eq", value: "false" }], ctx).where).toEqual({
      AND: [{ isRead: { equals: false } }, { userId: "u1" }],
    })
    expect(() => compileWhere("notification", [{ field: "userId", op: "eq", value: "u2" }], ctx)).toThrow(ToolInputError)
    expect(compileWhere("notification", [], ctx).where).toEqual({ AND: [{ userId: "u1" }] })
  })
})

describe("compileLimit", () => {
  it("defaults, coerces and clamps", () => {
    expect(compileLimit(undefined)).toBe(25)
    expect(compileLimit("10")).toBe(10)
    expect(compileLimit(1000)).toBe(100)
    expect(compileLimit(0)).toBe(1)
    expect(compileLimit("lots")).toBe(25)
  })
})

describe("compileWhere under the property filter", () => {
  const scopeOnR = { propertyId: "pR", propertyName: "Rental", hiddenEquipmentIds: ["eH"], hiddenVehicleIds: [], hiddenPersonIds: ["ben"] }
  const scoped = { ...ctx, scope: scopeOnR, hiddenEntityIds: [] }

  it("ANDs the owned-row fragment into warranties", () => {
    const { where } = compileWhere("warranty", [], scoped)
    expect(where.AND).toContainEqual(ownedScopeWhere(scopeOnR))
  })
  it("ANDs the person fragment into medications, next to the model's filters", () => {
    const { where } = compileWhere("medication", [{ field: "personId", op: "eq", value: "ben" }], scoped)
    expect(where.AND).toContainEqual(personChildScopeWhere(scopeOnR))
    expect(where.AND).toContainEqual({ personId: { equals: "ben" } })
  })
  it("filters list includes, such as a policy's members", () => {
    const plan = compileInclude("insurancePolicy", ["members", "premiums"], undefined, scoped)
    expect(plan.select.members).toMatchObject({ where: { id: { notIn: ["ben"] } } })
    expect(compileInclude("insurancePolicy", ["members"], undefined, { scope: null }).select.members).not.toHaveProperty("where")
  })
  it("is today's output without a scope", () => {
    expect(compileWhere("warranty", [], ctx).where).toEqual({})
    expect(compileWhere("medication", [], { ...ctx, scope: null }).where).toEqual({})
  })
})

describe("compileSort", () => {
  it("uses the given field or the entity default", () => {
    expect(compileSort("vehicle", { field: "year", dir: "desc" })).toEqual({ year: "desc" })
    expect(compileSort("vehicle", { field: "year" })).toEqual({ year: "asc" })
    expect(compileSort("serviceRecord")).toEqual({ date: "desc" })
    expect(() => compileSort("vehicle", { field: "vinz" })).toThrow(ToolInputError)
  })
})

describe("selectFor", () => {
  it("selects id, name, keys and declared fields only", () => {
    const sel = selectFor("medication")
    expect(sel).toMatchObject({ id: true, name: true, personId: true, dosage: true })
    expect(sel).not.toHaveProperty("createdAt")
    expect(selectFor("vehicle", ["make"])).toEqual({ id: true, name: true, make: true })
    expect(() => selectFor("vehicle", ["imageFilename"])).toThrow(ToolInputError)
  })
})

describe("compileInclude", () => {
  it("nests one/many relations and lists asset children for the executor", () => {
    const plan = compileInclude("person", ["medications", "primaryProvider", "serviceRecords"])
    expect(plan.select.primaryProvider).toEqual({ select: selectFor("provider") })
    expect(plan.select.medications).toEqual({ select: selectFor("medication"), orderBy: { startDate: "desc" }, take: 50 })
    expect(plan.children).toEqual([{ relation: "serviceRecords", entity: "serviceRecord" }])
  })
  it("always says whose record a person's own row is", () => {
    expect(compileInclude("medication").select.person).toEqual({ select: { id: true, name: true } })
    expect(compileInclude("medication", ["person"]).select.person).toEqual({ select: selectFor("person") })
    expect(compileInclude("vehicle").select.person).toBeUndefined()
  })

  it("treats asset as always-on and rejects unknown relations", () => {
    expect(compileInclude("serviceRecord", ["asset"]).children).toEqual([])
    expect(() => compileInclude("vehicle", ["owner"])).toThrow(/Relations on vehicle: serviceRecords, warranties, maintenanceSchedules/)
  })
})

describe("inDayRange", () => {
  it("includes the whole 'to' day, even with a time of day", () => {
    const range = { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-03-01T00:00:00Z") }
    expect(inDayRange(new Date("2025-03-01T14:28:00Z"), range)).toBe(true)
    expect(inDayRange(new Date("2025-03-02T00:00:00Z"), range)).toBe(false)
    expect(inDayRange(new Date("2024-12-31T23:59:59Z"), range)).toBe(false)
    expect(inDayRange(new Date("2025-01-01T00:00:00Z"), range)).toBe(true)
    expect(inDayRange(new Date("1990-01-01T00:00:00Z"), {})).toBe(true)
  })
})
