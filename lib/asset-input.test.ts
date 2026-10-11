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
