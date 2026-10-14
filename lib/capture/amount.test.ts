import { describe, expect, it } from "vitest"
import { AMOUNT_RE, parseAmount } from "./amount"

describe("parseAmount", () => {
  it.each([
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["12,50", 12.5],
    ["12.50", 12.5],
    ["$12.50", 12.5],
    ["12,50 €", 12.5],
    ["€ 1.234,56", 1234.56],
    ["EUR 99,00", 99],
    ["£7.05", 7.05],
    ["-12.50", -12.5],
    ["1,234", 1234],
    ["1.234", 1234],
    ["12", 12],
    ["1,234,567.89", 1234567.89],
    ["1.234.567,89", 1234567.89],
  ])("%s → %s", (raw, n) => expect(parseAmount(raw)).toBe(n))

  it.each(["", "   ", "abc", "€", "-", "1.2.3,4,5x"])("%j → null", (raw) => expect(parseAmount(raw)).toBeNull())
})

describe("AMOUNT_RE", () => {
  const found = (s: string) => [...s.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0]))
  it("finds US and European amounts with two decimals", () => {
    expect(found("Total $1,234.56")).toEqual([1234.56])
    expect(found("Gesamt 1.234,56 €")).toEqual([1234.56])
    expect(found("Total: 12,50")).toEqual([12.5])
  })
  it("ignores integers and phone-ish numbers", () => {
    expect(found("Qty 3, call 555 1234")).toEqual([])
  })
  it("does not glue a quantity onto a US price", () => {
    expect(found("Qty 2 450.00")).toEqual([450])
  })
  it("reads space-grouped European amounts", () => {
    expect(found("Total 1 234,56 €")).toEqual([1234.56])
  })
})
