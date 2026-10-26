import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("@/lib/maintenance-complete-server", () => ({ scheduleCompletionWrites: () => [] }))
vi.mock("@/lib/rooms-server", () => ({ checkRoom: async () => ({ roomId: null }) }))
import { cleanServiceRecord, serviceRecordSchema } from "./service-record-server"

const base = { assetId: "a1", assetType: "PROPERTY" as const, date: "2026-05-01", title: "Gutter clean" }
const parse = (extra: Record<string, unknown>) => serviceRecordSchema.safeParse({ ...base, ...extra })
const message = (extra: Record<string, unknown>, field: string) => {
  const r = parse(extra)
  return r.success ? undefined : r.error.flatten().fieldErrors[field as keyof typeof base]?.[0]
}

describe("service record limits", () => {
  it("allows a negative cost, which is how a refund is entered", () => {
    const r = parse({ cost: "-25.50" })
    expect(r.success && cleanServiceRecord(r.data, "u1").cost).toBe(-25.5)
    expect(parse({ cost: "-10000000" }).success).toBe(true)
    expect(parse({ cost: "10000000" }).success).toBe(true)
  })

  it("refuses a cost past 10,000,000 either way, and exponent or infinite values", () => {
    expect(parse({ cost: "10000000.01" }).success).toBe(false)
    expect(parse({ cost: "-10000000.01" }).success).toBe(false)
    for (const cost of ["1e21", "1e30", "Infinity", "NaN"]) expect(parse({ cost }).success, cost).toBe(false)
    expect(message({ cost: "1e21" }, "cost")).toBe("Enter a number, like 89.99.")
  })

  it("keeps a blank cost as no cost", () => {
    const r = parse({ cost: "" })
    expect(r.success && cleanServiceRecord(r.data, "u1").cost).toBeNull()
  })

  it("keeps the date between 1900 and 2200 and says so", () => {
    expect(parse({ date: "1900-01-01" }).success).toBe(true)
    expect(parse({ date: "2200-12-31" }).success).toBe(true)
    for (const date of ["1899-12-31", "2201-01-01", "0202-05-05", "0001-01-01", "275760-01-01", "9999-12-31"]) {
      expect(message({ date }, "date"), date).toBe("Pick a date between 1900 and 2200.")
    }
    expect(message({ date: "" }, "date")).toBe("Date is required")
  })

  it("saves the date as UTC midnight", () => {
    const r = parse({ date: "2026-05-01" })
    expect(r.success && cleanServiceRecord(r.data, "u1").date.toISOString()).toBe("2026-05-01T00:00:00.000Z")
  })

  it("keeps the mileage from 0 to 10,000,000 in whole numbers", () => {
    expect(parse({ mileageAtService: "10000000" }).success).toBe(true)
    expect(parse({ mileageAtService: "0" }).success).toBe(true)
    expect(parse({ mileageAtService: "10000001" }).success).toBe(false)
    expect(parse({ mileageAtService: "-1" }).success).toBe(false)
    expect(parse({ mileageAtService: "12.5" }).success).toBe(false)
  })

  it("limits the title and vendor to 200 characters", () => {
    expect(parse({ title: "a".repeat(200), vendor: "b".repeat(200) }).success).toBe(true)
    expect(parse({ title: "a".repeat(201) }).success).toBe(false)
    expect(parse({ vendor: "b".repeat(201) }).success).toBe(false)
  })
})
