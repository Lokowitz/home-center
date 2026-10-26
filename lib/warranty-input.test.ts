import { describe, expect, it } from "vitest"
import { warrantySchema } from "./warranty-input"

const base = { assetId: "a1", assetType: "EQUIPMENT" as const, productName: "Fridge" }
const parse = (extra: Record<string, unknown>) => warrantySchema.safeParse({ ...base, ...extra })

describe("warrantySchema", () => {
  it("refuses a purchase date after the expiration date, on the expiration field", () => {
    const r = parse({ purchaseDate: "2026-11-01", expirationDate: "2026-10-01" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.expirationDate).toEqual(["Expiration can't be before the purchase date."])
  })

  it("accepts the same day, a later expiry, and a single date", () => {
    expect(parse({ purchaseDate: "2026-11-01", expirationDate: "2026-11-01" }).success).toBe(true)
    expect(parse({ purchaseDate: "2026-11-01", expirationDate: "2028-11-01" }).success).toBe(true)
    expect(parse({ purchaseDate: "2026-11-01" }).success).toBe(true)
    expect(parse({ expirationDate: "2026-11-01" }).success).toBe(true)
    expect(parse({}).success).toBe(true)
  })

  it("keeps both dates between 1900 and 2200", () => {
    for (const field of ["purchaseDate", "expirationDate"]) {
      expect(parse({ [field]: "1900-01-01" }).success, field).toBe(true)
      expect(parse({ [field]: "2200-12-31" }).success, field).toBe(true)
      expect(parse({ [field]: "1899-12-31" }).success, field).toBe(false)
      expect(parse({ [field]: "2201-01-01" }).success, field).toBe(false)
      expect(parse({ [field]: "0001-01-01" }).success, field).toBe(false)
    }
  })

  it("limits the product and vendor names to 200 characters", () => {
    expect(parse({ productName: "a".repeat(200), vendor: "b".repeat(200) }).success).toBe(true)
    expect(parse({ productName: "a".repeat(201) }).success).toBe(false)
    expect(parse({ vendor: "b".repeat(201) }).success).toBe(false)
  })
})
