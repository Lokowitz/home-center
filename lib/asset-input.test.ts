import { describe, expect, it } from "vitest"
import { equipmentSchema, equipmentData, propertySchema, propertyData } from "./asset-input"

const blanks = ["", "   ", "\t", undefined]

describe("equipment input", () => {
  const base = { name: "Furnace", category: "HVAC" as const }
  const parse = (extra: Record<string, unknown>) => {
    const r = equipmentSchema.safeParse({ ...base, ...extra })
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten().fieldErrors))
    return equipmentData(r.data)
  }

  it("saves no price when the field is left empty, not 0", () => {
    for (const v of blanks) expect(parse({ purchasePrice: v }).purchasePrice).toBeNull()
  })

  it("keeps a real price, including an honest 0", () => {
    expect(parse({ purchasePrice: "1299.99" }).purchasePrice).toBe(1299.99)
    expect(parse({ purchasePrice: "0" }).purchasePrice).toBe(0)
  })

  it("still rejects junk and negative prices", () => {
    expect(equipmentSchema.safeParse({ ...base, purchasePrice: "abc" }).success).toBe(false)
    expect(equipmentSchema.safeParse({ ...base, purchasePrice: "-1" }).success).toBe(false)
  })

  it("saves the value class as picked, and none for Default", () => {
    expect(parse({ valueClass: "FIXTURE" }).valueClass).toBe("FIXTURE")
    expect(parse({ valueClass: "CONTENTS" }).valueClass).toBe("CONTENTS")
    expect(parse({ valueClass: "" }).valueClass).toBeNull()
    expect(parse({}).valueClass).toBeNull()
    expect(equipmentSchema.safeParse({ ...base, valueClass: "HOUSE" }).success).toBe(false)
  })

  it("saves no replacement cost or expected life when left empty, not 0", () => {
    for (const v of blanks) {
      expect(parse({ replacementCost: v }).replacementCost).toBeNull()
      expect(parse({ expectedLifeYears: v }).expectedLifeYears).toBeNull()
    }
  })

  it("keeps a replacement cost and an expected life", () => {
    expect(parse({ replacementCost: "1800.50" }).replacementCost).toBe(1800.5)
    expect(parse({ replacementCost: "0" }).replacementCost).toBe(0)
    expect(parse({ expectedLifeYears: "15" }).expectedLifeYears).toBe(15)
  })

  it("rejects an expected life outside whole years 1-100 and a negative replacement cost", () => {
    for (const v of ["0", "12.5", "101", "abc"]) expect(equipmentSchema.safeParse({ ...base, expectedLifeYears: v }).success, v).toBe(false)
    expect(equipmentSchema.safeParse({ ...base, replacementCost: "-1" }).success).toBe(false)
  })

  it("keeps a picked room and saves no room for a blank one", () => {
    expect(parse({ roomId: "room1" }).roomId).toBe("room1")
    expect(parse({ roomId: "" }).roomId).toBeNull()
    expect(parse({}).roomId).toBeNull()
  })
})

describe("property input", () => {
  const base = { name: "Home", type: "HOUSE" as const, address: "1 Main St" }
  const parse = (extra: Record<string, unknown>) => {
    const r = propertySchema.safeParse({ ...base, ...extra })
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten().fieldErrors))
    return propertyData(r.data)
  }

  it("saves nothing for empty or whitespace-only number fields", () => {
    for (const v of blanks) {
      const d = parse({ purchasePrice: v, yearBuilt: v, sqFt: v })
      expect(d.purchasePrice).toBeNull()
      expect(d.yearBuilt).toBeNull()
      expect(d.sqFt).toBeNull()
    }
  })

  it("keeps real values", () => {
    const d = parse({ purchasePrice: "412000", yearBuilt: "1998", sqFt: "2150" })
    expect(d).toMatchObject({ purchasePrice: 412000, yearBuilt: 1998, sqFt: 2150 })
  })

  it("still rejects out-of-range values", () => {
    const bad = (extra: Record<string, unknown>) => propertySchema.safeParse({ ...base, ...extra }).success
    expect(bad({ purchasePrice: "0" })).toBe(false)
    expect(bad({ yearBuilt: "1700" })).toBe(false)
    expect(bad({ yearBuilt: "1998.5" })).toBe(false)
    expect(bad({ sqFt: "-10" })).toBe(false)
    expect(bad({ sqFt: "abc" })).toBe(false)
  })
})
