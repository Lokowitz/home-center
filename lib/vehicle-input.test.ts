import { describe, expect, it } from "vitest"
import { vehicleSchema, vehicleData } from "./vehicle-input"

const base = { name: "BT Test Car", make: "Honda", model: "Civic", year: "2020", meterUnit: "MILES" as const }

function parse(extra: Record<string, unknown>) {
  const r = vehicleSchema.safeParse({ ...base, ...extra })
  if (!r.success) throw new Error(JSON.stringify(r.error.flatten().fieldErrors))
  return vehicleData(r.data)
}

describe("vehicle input", () => {
  it("saves no mileage when the field is left empty, not 0", () => {
    expect(parse({ currentMileage: "" }).currentMileage).toBeNull()
    expect(parse({ currentMileage: "   " }).currentMileage).toBeNull()
    expect(parse({}).currentMileage).toBeNull()
  })

  it("keeps a real reading, including an honest 0", () => {
    expect(parse({ currentMileage: "45210" }).currentMileage).toBe(45210)
    expect(parse({ currentMileage: "0" }).currentMileage).toBe(0)
    expect(parse({ currentMileage: 12 }).currentMileage).toBe(12)
  })

  it("saves no price when the field is left empty", () => {
    expect(parse({ purchasePrice: "" }).purchasePrice).toBeNull()
    expect(parse({ purchasePrice: "18999.5" }).purchasePrice).toBe(18999.5)
  })

  it("leaves the property link alone when the form doesn't send one", () => {
    expect("propertyId" in parse({})).toBe(false)
  })

  it("clears the link on an empty value and sets it on an id", () => {
    expect(parse({ propertyId: "" }).propertyId).toBeNull()
    expect(parse({ propertyId: "p1" }).propertyId).toBe("p1")
  })

  it("still rejects junk and negative mileage", () => {
    expect(vehicleSchema.safeParse({ ...base, currentMileage: "abc" }).success).toBe(false)
    expect(vehicleSchema.safeParse({ ...base, currentMileage: "-5" }).success).toBe(false)
    expect(vehicleSchema.safeParse({ ...base, currentMileage: "1.5" }).success).toBe(false)
  })
})

describe("vehicle limits", () => {
  const ok = (extra: Record<string, unknown>) => vehicleSchema.safeParse({ ...base, ...extra }).success

  it("takes a reading up to 10,000,000 and refuses more, negatives and fractions", () => {
    expect(ok({ currentMileage: "10000000" })).toBe(true)
    expect(ok({ currentMileage: "10000001" })).toBe(false)
    expect(ok({ currentMileage: "-1" })).toBe(false)
    expect(ok({ currentMileage: "1500.5" })).toBe(false)
    expect(ok({ currentMileage: "1e21" })).toBe(false)
  })

  it("takes a price from 0 to 10,000,000 and refuses a negative one", () => {
    expect(ok({ purchasePrice: "0" })).toBe(true)
    expect(ok({ purchasePrice: "10000000" })).toBe(true)
    expect(ok({ purchasePrice: "10000000.01" })).toBe(false)
    expect(ok({ purchasePrice: "-100" })).toBe(false)
    expect(ok({ purchasePrice: "1e30" })).toBe(false)
  })

  it("keeps the year from 1900 to 2100 and the purchase date from 1900 to 2200", () => {
    expect(ok({ year: "1900" })).toBe(true)
    expect(ok({ year: "2100" })).toBe(true)
    expect(ok({ year: "1899" })).toBe(false)
    expect(ok({ year: "2101" })).toBe(false)
    expect(ok({ year: "275760" })).toBe(false)
    expect(ok({ purchaseDate: "1900-01-01" })).toBe(true)
    expect(ok({ purchaseDate: "2201-01-01" })).toBe(false)
    expect(ok({ purchaseDate: "0001-01-01" })).toBe(false)
  })

  it("limits names to 200 characters", () => {
    expect(ok({ name: "a".repeat(200) })).toBe(true)
    expect(ok({ name: "a".repeat(201) })).toBe(false)
  })
})
