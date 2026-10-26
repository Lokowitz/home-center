import { describe, expect, it } from "vitest"
import {
  normalizeTags, observationSchema,
  allergySchema, conditionSchema, immunizationSchema, insuranceSchema,
  medicationSchema, personSchema, premiumSchema, providerSchema,
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

  describe("propertyId", () => {
    const valid = { name: "Sam", relationship: "CHILD" }
    it("stays undefined when left out, so the link is untouched", () => {
      expect(personSchema.parse(valid).propertyId).toBeUndefined()
    })
    it("keeps an id", () => {
      expect(personSchema.parse({ ...valid, propertyId: "p1" }).propertyId).toBe("p1")
    })
    it("keeps an empty string, which the action turns into an unlink", () => {
      expect(personSchema.parse({ ...valid, propertyId: "" }).propertyId).toBe("")
    })
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
  it("a resolved date only counts while the condition is resolved", () => {
    const base = { name: "X", diagnosedDate: "2026-01-01", resolvedDate: "2026-03-01" }
    expect(conditionSchema.parse({ ...base, status: "RESOLVED" }).resolvedDate).toEqual(new Date("2026-03-01"))
    expect(conditionSchema.parse({ ...base, status: "ACTIVE" }).resolvedDate).toBeNull()
    expect(conditionSchema.parse({ ...base, status: "MANAGED" }).resolvedDate).toBeNull()
    // A stale date from before the status changed must not trip the diagnosis check.
    expect(conditionSchema.safeParse({ ...base, status: "ACTIVE", resolvedDate: "2025-01-01" }).success).toBe(true)
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

describe("insurance policy links and coverage lines", () => {
  it("splits property and vehicle ids", () => {
    const r = insuranceSchema.parse({ carrier: "A", kind: "AUTO", vehicleIds: "v1,v2" })
    expect(r.vehicleIds).toEqual(["v1", "v2"])
    expect(r.propertyIds).toEqual([])
  })

  it("reads coverage lines and drops blank ones", () => {
    const r = insuranceSchema.parse({
      carrier: "A", kind: "HOME",
      coverages: [{ label: "Dwelling", limit: "450000", deductible: "2500" }, { label: "", limit: "", deductible: "" }],
    })
    expect(r.coverages).toEqual([{ label: "Dwelling", limit: 450000, deductible: 2500, sortOrder: 0 }])
    expect(insuranceSchema.parse({ carrier: "A", kind: "HOME" }).coverages).toEqual([])
  })

  it("refuses a coverage line with an amount and no name", () => {
    const r = insuranceSchema.safeParse({ carrier: "A", kind: "HOME", coverages: [{ label: " ", limit: "1000" }] })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.flatten().fieldErrors.coverages).toContain("Each coverage line needs a name.")
  })

  it("refuses a negative coverage limit", () => {
    expect(insuranceSchema.safeParse({ carrier: "A", kind: "HOME", coverages: [{ label: "Liability", limit: "-1" }] }).success).toBe(false)
  })
})

describe("premiumSchema", () => {
  it("reads a premium", () => {
    expect(premiumSchema.parse({ effectiveDate: "2026-11-01", amount: "1680", period: "ANNUAL" })).toEqual({
      effectiveDate: new Date("2026-11-01"), amount: 1680, period: "ANNUAL", notes: null,
    })
    expect(premiumSchema.parse({ effectiveDate: "2026-11-01", amount: "10" }).period).toBe("ANNUAL")
  })

  it("refuses a missing or negative amount and a missing date", () => {
    const blank = premiumSchema.safeParse({ effectiveDate: "2026-11-01", amount: "" })
    expect(blank.success).toBe(false)
    if (!blank.success) expect(blank.error.flatten().fieldErrors.amount).toContain("Amount is required")
    expect(premiumSchema.safeParse({ effectiveDate: "2026-11-01", amount: "-5" }).success).toBe(false)
    expect(premiumSchema.safeParse({ amount: "5" }).success).toBe(false)
  })
})

describe("input limits", () => {
  const dateError = "Pick a date between 1900 and 2200."
  const errors = (r: { success: boolean; error?: { flatten(): { fieldErrors: Record<string, string[] | undefined> } } }) =>
    r.success ? {} : r.error!.flatten().fieldErrors

  it("keeps health dates between 1900 and 2200", () => {
    const give = (dateGiven: string) => immunizationSchema.safeParse({ vaccine: "Flu", dateGiven })
    expect(give("1900-01-01").success).toBe(true)
    expect(give("2200-12-31").success).toBe(true)
    expect(errors(give("1899-12-31")).dateGiven).toEqual([dateError])
    expect(errors(give("2201-01-01")).dateGiven).toEqual([dateError])
    expect(give("0001-01-01").success).toBe(false)
    expect(give("275760-01-01").success).toBe(false)
    expect(observationSchema.safeParse({ date: "2024-02-30", type: "Cough" }).success).toBe(false)
    expect(personSchema.safeParse({ name: "A", relationship: "SELF", dateOfBirth: "1850-01-01" }).success).toBe(false)
    expect(personSchema.safeParse({ name: "A", relationship: "SELF", dateOfBirth: "1900-01-01" }).success).toBe(true)
  })

  it("keeps a policy's dates in range and its amounts from 0 to 10,000,000", () => {
    const policy = (extra: Record<string, unknown>) => insuranceSchema.safeParse({ carrier: "Acme", kind: "HOME", ...extra })
    expect(policy({ startDate: "1900-01-01", endDate: "2200-12-31" }).success).toBe(true)
    expect(policy({ startDate: "1899-12-31" }).success).toBe(false)
    expect(policy({ endDate: "2201-01-01" }).success).toBe(false)
    expect(policy({ deductible: "10000000" }).success).toBe(true)
    expect(errors(policy({ deductible: "10000001" })).deductible).toEqual(["Enter an amount from 0 to 10,000,000."])
    expect(policy({ deductible: "-1" }).success).toBe(false)
    expect(policy({ deductible: "1e21" }).success).toBe(false)
    expect(policy({ outOfPocketMax: "10000001" }).success).toBe(false)
    expect(policy({ coverages: [{ label: "Dwelling", limit: "10000000", deductible: "0" }] }).success).toBe(true)
    expect(policy({ coverages: [{ label: "Dwelling", limit: "10000001" }] }).success).toBe(false)
    expect(policy({ coverages: [{ label: "Dwelling", deductible: "-5" }] }).success).toBe(false)
  })

  it("limits a premium to 0 through 10,000,000 and keeps its date in range", () => {
    const premium = (extra: Record<string, unknown>) => premiumSchema.safeParse({ effectiveDate: "2024-01-01", amount: "100", ...extra })
    expect(premium({ amount: "0" }).success).toBe(true)
    expect(premium({ amount: "10000000" }).success).toBe(true)
    expect(premium({ amount: "10000001" }).success).toBe(false)
    expect(premium({ amount: "-1" }).success).toBe(false)
    expect(premium({ amount: "1e21" }).success).toBe(false)
    expect(premium({ effectiveDate: "0001-01-01" }).success).toBe(false)
    expect(premium({ effectiveDate: "275760-01-01" }).success).toBe(false)
    const r = premium({ amount: "145.505" })
    expect(r.success && r.data.amount).toBe(145.505)
  })

  it("limits a refill interval to 3650 days", () => {
    const med = (refillIntervalDays: string) => medicationSchema.safeParse({ name: "Zyrtec", refillIntervalDays })
    expect(med("3650").success).toBe(true)
    expect(med("3651").success).toBe(false)
    expect(med("99999999999").success).toBe(false)
    expect(med("30").success).toBe(true)
  })

  it("limits names to 200 characters", () => {
    const long = "a".repeat(201)
    const exact = "a".repeat(200)
    expect(personSchema.safeParse({ name: exact, relationship: "SELF" }).success).toBe(true)
    expect(personSchema.safeParse({ name: long, relationship: "SELF" }).success).toBe(false)
    expect(providerSchema.safeParse({ name: long }).success).toBe(false)
    expect(insuranceSchema.safeParse({ carrier: exact, kind: "HOME" }).success).toBe(true)
    expect(insuranceSchema.safeParse({ carrier: long, kind: "HOME" }).success).toBe(false)
    expect(insuranceSchema.safeParse({ carrier: "Acme", kind: "HOME", planName: long }).success).toBe(false)
  })
})
