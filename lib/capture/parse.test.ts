import { describe, expect, it } from "vitest"
import { parseReceipt } from "./parse"

const today = new Date("2026-10-10T12:00:00Z")
const p = (t: string) => parseReceipt(t, today)

describe("parseReceipt date", () => {
  it("prefers a labelled invoice date over a due or print date", () => {
    const t = "Acme Plumbing\nPrinted 10/09/2026\nDue Date: 11/05/2026\nInvoice Date: 10/05/2026\nTotal $120.00"
    expect(p(t).date).toBe("2026-10-05")
  })
  it("reads MM/DD/YYYY", () => expect(p("Shop\n03/14/2025 thanks").date).toBe("2025-03-14"))
  it("reads YYYY-MM-DD", () => expect(p("Shop\n2025-03-14").date).toBe("2025-03-14"))
  it("reads 'Oct 5, 2026'", () => expect(p("Shop\nOct 5, 2026").date).toBe("2026-10-05"))
  it("reads '5-Oct-26'", () => expect(p("Shop\n5-Oct-26").date).toBe("2026-10-05"))
  it("rejects years past next year", () => {
    expect(p("Shop\n01/01/2028").date).toBeNull()
    expect(p("Shop\n01/01/2027").date).toBe("2027-01-01")
  })
  it("bounds the year by the injected today", () => {
    expect(parseReceipt("Shop\n01/01/2031", new Date("2030-06-01")).date).toBe("2031-01-01")
  })
  it("picks the most common date without a label", () => {
    expect(p("Shop\n01/02/2026 x 03/04/2026 y 03/04/2026").date).toBe("2026-03-04")
  })
  it("returns null with no date", () => expect(p("Shop\nno dates here").date).toBeNull())
})

describe("parseReceipt total", () => {
  it("Grand Total beats subtotal and tax", () => {
    const t = "Shop\nSubtotal 100.00\nTax 8.25\nGrand Total 108.25\nCash 120.00\nChange 11.75"
    expect(p(t).total).toBe(108.25)
  })
  it("reads an amount on the line after the label", () => {
    expect(p("Shop\nAmount Due\n\n$45.10\nSubtotal 40.00").total).toBe(45.1)
  })
  it("handles thousands separators", () => expect(p("Shop\nTotal: $1,234.56").total).toBe(1234.56))
  it("falls back to the largest amount", () => expect(p("Shop\n12.00\n15.50").total).toBe(15.5))
  it("returns null with no amounts", () => expect(p("Shop\nnothing to pay").total).toBeNull())
  it("handles tabs", () => {
    const r = p("Shop\nInvoice Date:\t10/05/2026\nTotal\t\t$99.99")
    expect(r).toEqual({ date: "2026-10-05", total: 99.99, vendor: "Shop" })
  })
})

describe("parseReceipt vendor", () => {
  it("skips INVOICE, Receipt and Page lines", () => {
    expect(p("INVOICE\nPage 1\nReceipt\n  Bob's Garage LLC  \n123 Main").vendor).toBe("Bob's Garage LLC")
  })
  it("skips lines without three letters", () => expect(p("12345\n--\nAce Hardware").vendor).toBe("Ace Hardware"))
  it("truncates to 60 chars", () => expect(p("A".repeat(80)).vendor).toHaveLength(60))
})

describe("parseReceipt edge inputs", () => {
  it("empty string", () => expect(p("")).toEqual({ date: null, total: null, vendor: null }))
  it("whitespace only", () => expect(p(" \t\n ")).toEqual({ date: null, total: null, vendor: null }))
  it("text with no newlines", () => {
    expect(p("Joe's Auto Invoice Date 10/01/2026 Subtotal 50.00 Total 54.00")).toEqual({
      date: "2026-10-01", total: 54, vendor: null,
    })
  })
  it("multi-paragraph text", () => {
    const t = "Northside HVAC\n\nService Date: Sep 3, 2026\n\nLabor 200.00\nParts 50.00\n\nTotal Due $250.00\n"
    expect(p(t)).toEqual({ date: "2026-09-03", total: 250, vendor: "Northside HVAC" })
  })
})
