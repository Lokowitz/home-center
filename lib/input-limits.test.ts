import { describe, expect, it } from "vitest"
import {
  DATE_MESSAGE, MAX_NAME_LENGTH, boundedNumber, dateInRange, fieldIssue, intervalDays, intervalMiles, meterReading, moneyAmount, nameText,
  numberText, optionalDateText, parseDateOnly, requiredDateText,
} from "./input-limits"

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success

describe("parseDateOnly", () => {
  it("accepts the first and last day, as UTC midnight", () => {
    expect(parseDateOnly("1900-01-01")?.toISOString()).toBe("1900-01-01T00:00:00.000Z")
    expect(parseDateOnly("2200-12-31")?.toISOString()).toBe("2200-12-31T00:00:00.000Z")
    expect(parseDateOnly(" 2024-02-29 ")?.toISOString()).toBe("2024-02-29T00:00:00.000Z")
  })

  it("rejects the day before and the day after", () => {
    expect(parseDateOnly("1899-12-31")).toBeNull()
    expect(parseDateOnly("2201-01-01")).toBeNull()
  })

  it("rejects the years the date input lets through", () => {
    for (const v of ["0001-01-01", "0202-05-05", "275760-01-01", "9999-12-31", "-000001-01-01"]) expect(parseDateOnly(v), v).toBeNull()
  })

  it("rejects things that are not a real calendar day in this exact shape", () => {
    for (const v of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-5-1", "05/01/2024", "2024-05-01T10:00:00Z", "tomorrow", ""]) {
      expect(parseDateOnly(v), v).toBeNull()
    }
  })
})

describe("date fields", () => {
  it("lets a blank optional date through and refuses one out of range", () => {
    expect(ok(optionalDateText, undefined)).toBe(true)
    expect(ok(optionalDateText, "")).toBe(true)
    expect(ok(optionalDateText, "   ")).toBe(true)
    expect(ok(optionalDateText, "2000-06-01")).toBe(true)
    const r = optionalDateText.safeParse("1850-01-01")
    expect(r.success ? "" : r.error.issues[0].message).toBe(DATE_MESSAGE)
  })

  it("requires a required date and checks its range", () => {
    const schema = requiredDateText("Date is required")
    const blank = schema.safeParse("")
    expect(blank.success ? "" : blank.error.issues[0].message).toBe("Date is required")
    expect(ok(schema, "2200-12-31")).toBe(true)
    expect(ok(schema, "2201-01-01")).toBe(false)
  })
})

describe("money", () => {
  const money = moneyAmount()
  it("accepts 0 and 10,000,000, rejects just past", () => {
    expect(money.parse("0")).toBe(0)
    expect(money.parse("10000000")).toBe(10_000_000)
    expect(money.parse("89.99")).toBe(89.99)
    expect(ok(money, "10000000.01")).toBe(false)
  })

  it("rejects a negative amount", () => {
    expect(ok(money, "-0.01")).toBe(false)
    expect(ok(money, -5)).toBe(false)
  })

  it("lets a negative amount through only where asked, with the same upper bound", () => {
    const refund = moneyAmount({ negative: true })
    expect(refund.parse("-10000000")).toBe(-10_000_000)
    expect(refund.parse("-5.25")).toBe(-5.25)
    expect(ok(refund, "-10000000.01")).toBe(false)
    expect(ok(refund, "10000000.01")).toBe(false)
  })

  it("rejects exponent notation, Infinity, NaN, hex and junk", () => {
    for (const v of ["1e21", "1e30", "1E3", "Infinity", "-Infinity", "NaN", "0x10", "abc", "", "  ", "1,000", "--1", Infinity, NaN, 1e21, null]) {
      expect(ok(money, v), String(v)).toBe(false)
    }
  })

  it("explains the range", () => {
    const r = money.safeParse("1e21")
    expect(r.success ? "" : r.error.issues[0].message).toBe("Enter a number, like 89.99.")
    const big = money.safeParse("20000000")
    expect(big.success ? "" : big.error.issues[0].message).toBe("Enter an amount from 0 to 10,000,000.")
  })
})

describe("readings and intervals", () => {
  it("meter readings run 0 to 10,000,000 in whole numbers", () => {
    const m = meterReading()
    expect(m.parse("0")).toBe(0)
    expect(m.parse("10000000")).toBe(10_000_000)
    for (const v of ["-1", "10000001", "1500.5", "1e7", "NaN"]) expect(ok(m, v), v).toBe(false)
  })

  it("day intervals run 1 to 3650", () => {
    const d = intervalDays()
    expect(d.parse("1")).toBe(1)
    expect(d.parse("3650")).toBe(3650)
    for (const v of ["0", "3651", "99999999999", "1.5", "1e3"]) expect(ok(d, v), v).toBe(false)
  })

  it("mile intervals run 1 to 1,000,000", () => {
    const m = intervalMiles()
    expect(m.parse("1")).toBe(1)
    expect(m.parse("1000000")).toBe(1_000_000)
    for (const v of ["0", "1000001", "99999999999"]) expect(ok(m, v), v).toBe(false)
  })

  it("takes a custom message for its range", () => {
    const r = boundedNumber(1900, 2100, { whole: true, message: "Enter a year from 1900 to 2100." }).safeParse("1850")
    expect(r.success ? "" : r.error.issues[0].message).toBe("Enter a year from 1900 to 2100.")
  })
})

describe("names", () => {
  it("allows 200 characters and refuses 201", () => {
    const schema = nameText("Name is required")
    expect(ok(schema, "a".repeat(MAX_NAME_LENGTH))).toBe(true)
    expect(ok(schema, "a".repeat(MAX_NAME_LENGTH + 1))).toBe(false)
    expect(ok(schema, "")).toBe(false)
  })
})

describe("number text", () => {
  const field = numberText(moneyAmount())
  it("checks a filled field with the server's message and leaves a blank one alone", () => {
    expect(ok(field, undefined)).toBe(true)
    expect(ok(field, "")).toBe(true)
    expect(ok(field, "12.50")).toBe(true)
    const r = field.safeParse("10000001")
    expect(r.success ? "" : r.error.issues[0].message).toBe("Enter an amount from 0 to 10,000,000.")
  })

  it("can be required", () => {
    const required = numberText(moneyAmount(), "Amount is required")
    const r = required.safeParse("")
    expect(r.success ? "" : r.error.issues[0].message).toBe("Amount is required")
  })

  it("reports an issue as text, or null", () => {
    expect(fieldIssue(intervalDays(), "")).toBeNull()
    expect(fieldIssue(intervalDays(), "30")).toBeNull()
    expect(fieldIssue(intervalDays(), "4000")).toBe("Enter a whole number from 1 to 3,650.")
  })
})

describe("dateInRange", () => {
  it("accepts null and dates from 1900 through 2200", () => {
    expect(dateInRange(null)).toBe(true)
    expect(dateInRange(new Date("2026-10-25T00:00:00Z"))).toBe(true)
    expect(dateInRange(new Date("1900-01-01T00:00:00Z"))).toBe(true)
    expect(dateInRange(new Date("2200-12-31T00:00:00Z"))).toBe(true)
  })
  it("rejects an invalid date and dates outside the range", () => {
    expect(dateInRange(new Date(NaN))).toBe(false)
    expect(dateInRange(new Date("1899-12-31T00:00:00Z"))).toBe(false)
    expect(dateInRange(new Date("2201-01-01T00:00:00Z"))).toBe(false)
  })
})
