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

  it("still rejects junk and negative mileage", () => {
    expect(vehicleSchema.safeParse({ ...base, currentMileage: "abc" }).success).toBe(false)
    expect(vehicleSchema.safeParse({ ...base, currentMileage: "-5" }).success).toBe(false)
    expect(vehicleSchema.safeParse({ ...base, currentMileage: "1.5" }).success).toBe(false)
  })
})
