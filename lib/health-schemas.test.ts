import { describe, expect, it } from "vitest"
import {
  normalizeTags, observationSchema,
  allergySchema, conditionSchema, immunizationSchema, insuranceSchema,
  medicationSchema, personSchema, providerSchema,
} from "./health-schemas"

describe("personSchema", () => {
  it("turns blanks into nulls and dates into Dates", () => {
    const r = personSchema.parse({ name: " Sam ", relationship: "CHILD", dateOfBirth: "2015-04-02", sex: "", bloodType: "", primaryProviderId: "", notes: "" })
    expect(r).toEqual({ name: "Sam", relationship: "CHILD", dateOfBirth: new Date("2015-04-02"), sex: null, bloodType: null, primaryProviderId: null, notes: null })
  })
  it("requires a name", () => {
    const r = personSchema.safeParse({ name: "  ", relationship: "SELF" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.name).toBeDefined()
  })
  it("rejects a future date of birth", () => {
    const r = personSchema.safeParse({ name: "A", relationship: "SELF", dateOfBirth: "2999-01-01" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.dateOfBirth).toBeDefined()
  })
  it("accepts a pet", () => {
    expect(personSchema.safeParse({ name: "Rex", relationship: "PET" }).success).toBe(true)
  })

  it("rejects an unknown relationship", () => {
    expect(personSchema.safeParse({ name: "A", relationship: "COUSIN" }).success).toBe(false)
  })
})

describe("date-order rules", () => {
  it("medication cannot end before it starts", () => {
    const r = medicationSchema.safeParse({ name: "X", startDate: "2026-05-01", endDate: "2026-04-01" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.endDate).toBeDefined()
  })
  it("immunization cannot be next due before it was given", () => {
    const r = immunizationSchema.safeParse({ vaccine: "Tdap", dateGiven: "2026-05-01", nextDueDate: "2026-01-01" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.nextDueDate).toBeDefined()
  })
  it("condition cannot resolve before diagnosis", () => {
    const r = conditionSchema.safeParse({ name: "X", status: "RESOLVED", diagnosedDate: "2026-05-01", resolvedDate: "2026-01-01" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.resolvedDate).toBeDefined()
  })
  it("policy cannot end before it starts", () => {
    const r = insuranceSchema.safeParse({ carrier: "Aetna", kind: "MEDICAL", startDate: "2026-05-01", endDate: "2026-01-01" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.endDate).toBeDefined()
  })
})

describe("numbers, emails and lists", () => {
  it("parses refill interval as a whole number and rejects decimals", () => {
    expect(medicationSchema.parse({ name: "X", refillIntervalDays: "30" }).refillIntervalDays).toBe(30)
    expect(medicationSchema.safeParse({ name: "X", refillIntervalDays: "2.5" }).success).toBe(false)
  })
  it("rejects a negative deductible", () => {
    expect(insuranceSchema.safeParse({ carrier: "A", kind: "MEDICAL", deductible: "-1" }).success).toBe(false)
  })
  it("splits member ids", () => {
    expect(insuranceSchema.parse({ carrier: "A", kind: "DENTAL", memberIds: "p1,p2" }).memberIds).toEqual(["p1", "p2"])
    expect(insuranceSchema.parse({ carrier: "A", kind: "DENTAL" }).memberIds).toEqual([])
  })
  it("validates provider email only when present", () => {
    expect(providerSchema.safeParse({ name: "Dr A", email: "" }).success).toBe(true)
    expect(providerSchema.safeParse({ name: "Dr A", email: "nope" }).success).toBe(false)
  })
  it("requires allergy severity to be known", () => {
    expect(allergySchema.safeParse({ substance: "Penicillin", severity: "SEVERE" }).success).toBe(true)
    expect(allergySchema.safeParse({ substance: "Penicillin", severity: "LETHAL" }).success).toBe(false)
  })
  it("rejects an unparseable date", () => {
    expect(immunizationSchema.safeParse({ vaccine: "Flu", dateGiven: "not-a-date" }).success).toBe(false)
  })
})

describe("observationSchema", () => {
  it("needs only a date and what was observed", () => {
    const r = observationSchema.safeParse({ date: "2026-06-14", type: " Meltdown " })
    expect(r.success && r.data).toEqual({
      date: new Date("2026-06-14"), time: null, type: "Meltdown", severity: null, durationMinutes: null,
      conditionId: null, tags: null, notes: null,
    })
  })

  it("parses the optional details", () => {
    const r = observationSchema.safeParse({
      date: "2026-06-14", time: "07:45", type: "Meltdown", severity: "4", durationMinutes: "20",
      conditionId: "c1", tags: "school, tired, School", notes: "Before the bus",
    })
    expect(r.success && r.data).toMatchObject({ time: "07:45", severity: 4, durationMinutes: 20, conditionId: "c1", tags: "school, tired" })
  })

  it("rejects bad times, severities and durations", () => {
    const errors = (v: Record<string, string>) => {
      const r = observationSchema.safeParse({ date: "2026-06-14", type: "x", ...v })
      return r.success ? {} : r.error.flatten().fieldErrors
    }
    expect(errors({ time: "25:00" }).time).toEqual(["Enter a time like 14:30"])
    expect(errors({ severity: "6" }).severity).toEqual(["Pick 1 to 5"])
    expect(errors({ durationMinutes: "1.5" }).durationMinutes).toBeDefined()
    expect(errors({ date: "" }).date).toContain("Date is required")
  })
})

describe("normalizeTags", () => {
  it("trims, drops blanks and case-insensitive repeats", () => {
    expect(normalizeTags(" school ,, tired,School ")).toBe("school, tired")
    expect(normalizeTags(" , ")).toBeNull()
    expect(normalizeTags(undefined)).toBeNull()
  })
})
