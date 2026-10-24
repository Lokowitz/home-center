import { describe, expect, it } from "vitest"
import { AssetType, ServiceCategory } from "@/app/generated/prisma/enums"
import { describeOntology, ENTITIES, ENTITY_KEYS, entityKeysFor } from "./ontology"
import { compileInclude, compileWhere, entityDef, relationNames, withLocationSelect } from "./query"

const FORBIDDEN = ["passwordHash", "passwordEnc", "apiKeyEnc", "imageFilename", "createdById", "createdBy", "uploadedBy", "attachments", "user", "userId"]

describe("ontology", () => {
  it("links premiums and coverage lines to their policy", () => {
    expect(ENTITIES.insurancePremium.keys).toEqual(["policyId"])
    expect(ENTITIES.insurancePremium.fields.period.values).toEqual(["MONTHLY", "SEMIANNUAL", "ANNUAL"])
    expect(ENTITIES.insurancePremium.fields.amount.description).toMatch(/yearly/)
    expect(ENTITIES.insurancePolicy.relations.vehicles).toEqual({ kind: "many", entity: "vehicle" })
    expect(ENTITIES.insurancePolicy.href?.({ id: "i1" })).toBe("/insurance")
  })

  it("lets the assistant open a reminder's manual page", () => {
    const def = ENTITIES.maintenanceSchedule
    expect(def.keys).toContain("referenceAttachmentId")
    expect(def.fields.referencePage.type).toBe("int")
    expect(def.fields.referencePage.description).toMatch(/read_document/)
  })

  it("lets the assistant see a reminder's cost and set months", () => {
    const fields = ENTITIES.maintenanceSchedule.fields
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["estimatedCost", "dueMonths", "dueDay"]))
  })

  it("lets the assistant see equipment value and lifespan", () => {
    const fields = ENTITIES.equipment.fields
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["valueClass", "expectedLifeYears", "replacementCost"]))
    expect(fields.valueClass.values).toEqual(["FIXTURE", "CONTENTS"])
    expect(fields.valueClass.description).toMatch(/category/i)
  })

  it("defines every key", () => {
    expect(Object.keys(ENTITIES).sort()).toEqual([...ENTITY_KEYS].sort())
  })

  it("never exposes excluded fields or relations", () => {
    for (const key of ENTITY_KEYS) {
      const def = ENTITIES[key]
      for (const name of [...Object.keys(def.fields), ...Object.keys(def.relations), ...def.keys]) {
        expect(FORBIDDEN, `${key}.${name}`).not.toContain(name)
      }
    }
  })

  it("points relations at real entities and valid fields", () => {
    for (const key of ENTITY_KEYS) {
      const def = ENTITIES[key]
      expect(def.fields[def.nameField], `${key}.nameField`).toBeDefined()
      for (const f of def.searchFields) expect(def.fields[f], `${key} search ${f}`).toBeDefined()
      expect(def.fields[def.defaultSort.field], `${key} sort`).toBeDefined()
      for (const rel of Object.values(def.relations)) {
        if (rel.kind !== "asset") expect(ENTITY_KEYS).toContain(rel.entity)
        if (rel.kind === "asset") expect(def.polymorphic).toBe(true)
        if (rel.kind === "assetChildren") expect(def.assetType).toBeDefined()
      }
    }
  })

  it("uses the Prisma enum values", () => {
    expect(ENTITIES.serviceRecord.fields.category.values).toEqual(Object.values(ServiceCategory))
    expect(ENTITIES.serviceRecord.fields.assetType.values).toEqual(Object.values(AssetType))
  })

  it("scopes notifications to the signed-in user", () => {
    expect(ENTITIES.notification.scope?.({ userId: "u1" })).toEqual({ userId: "u1" })
  })

  it("links rows to their pages", () => {
    expect(ENTITIES.vehicle.href?.({ id: "v1" })).toBe("/assets/vehicles/v1")
    expect(ENTITIES.medication.href?.({ id: "m1", personId: "p1" })).toBe("/assets/people/p1")
    expect(ENTITIES.serviceRecord.href?.({ id: "s1", assetType: "EQUIPMENT", assetId: "e1" })).toBe("/assets/equipment/e1")
    expect(ENTITIES.provider.href?.({ id: "x" })).toBe("/providers")
    expect(ENTITIES.room.href?.({ id: "r1", propertyId: "p1" })).toBe("/assets/properties/p1?tab=rooms&open=r1")
  })

  it("describes every entity compactly", () => {
    const text = describeOntology()
    for (const key of ENTITY_KEYS) expect(text).toContain(`- ${key}:`)
    expect(text).toContain("meterUnit(MILES|HOURS)")
    expect(text).toContain("asset→property|vehicle|equipment|person")
    expect(text).toContain("medications→medication[]")
    expect(text).not.toMatch(/passwordHash|imageFilename/)
  })

  it("leaves rooms out while Rooms is off", () => {
    expect(entityKeysFor(true, false)).not.toContain("room")
    expect(entityKeysFor(true, false)).not.toContain("roomPaint")
    expect(entityKeysFor(true, true)).toEqual(expect.arrayContaining(["room", "roomPaint"]))
    expect(entityKeysFor(false, false)).not.toContain("person")
    const off = describeOntology(true, false)
    expect(off).not.toMatch(/^- room/m)
    expect(off).not.toMatch(/→room/)
    const on = describeOntology(true, true)
    expect(on).toContain("rooms→room[]")
    expect(on).toContain("paints→roomPaint[]")
    expect(on).toMatch(/^- equipment:.*room→room/m)
  })

  it("refuses room entities and relations while Rooms is off", () => {
    const ctx = { userId: "u1", now: new Date(), rooms: false }
    expect(() => entityDef("room", ctx)).toThrow(/Rooms is turned off/)
    expect(() => entityDef("rooms", ctx)).toThrow(/Rooms is turned off/)
    expect(() => compileInclude("property", ["rooms"], undefined, ctx)).toThrow(/Rooms is turned off/)
    expect(() => compileInclude("equipment", ["room"], undefined, ctx)).toThrow(/Rooms is turned off/)
    expect(() => compileInclude("property", ["rooms"], undefined, { rooms: true })).not.toThrow()
  })

  it("leaves room relations out of error messages while Rooms is off", () => {
    const off = { userId: "u1", now: new Date(), rooms: false }
    expect(relationNames("property", off)).not.toContain("rooms")
    expect(relationNames("property")).toContain("rooms")
    expect(relationNames("room", { rooms: true })).toBe("property, paints, equipment")
    expect(() => compileInclude("equipment", ["nope"], undefined, off)).toThrow(/Relations on equipment: property, serviceRecords/)
    expect(() => compileWhere("property", [{ field: "nope", op: "has" }], off)).toThrow(/list relation of property: equipment, serviceRecords/)
  })

  it("selects equipment's room name for its location, Rooms on or off", () => {
    const off = { userId: "u1", now: new Date(), rooms: false }
    expect(compileInclude("equipment", [], undefined, off).select.room).toEqual({ select: { name: true } })
    expect(compileInclude("equipment").select.room).toEqual({ select: { name: true } })
    expect(compileInclude("equipment", [], ["name"]).select.room).toBeUndefined()
    expect(compileInclude("equipment", ["room"], undefined, { rooms: true }).select.room).toMatchObject({ select: { id: true, name: true } })
    expect(withLocationSelect("equipment", { id: true, location: true })).toEqual({ id: true, location: true, room: { select: { name: true } } })
    expect(withLocationSelect("vehicle", { id: true })).toEqual({ id: true })
  })

  it("brings a room's paint along on a plain lookup", () => {
    const { select } = compileInclude("room")
    expect(select.paints).toMatchObject({ select: { surface: true, colorName: true }, orderBy: { sortOrder: "asc" } })
  })
})
