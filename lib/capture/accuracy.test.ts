import { describe, expect, it } from "vitest"
import { parseReceipt, type ParsedReceipt } from "./parse"
import { FIXTURE_TODAY, RECEIPT_FIXTURES, type ReceiptExpectation } from "./fixtures/receipts"

// Accuracy regression set for the deterministic receipt reader. Every fixture
// is synthetic (see fixtures/receipts.ts). Fixtures the parser handles are
// asserted field by field; the overall date+total score may not drop below
// MIN_DATE_AND_TOTAL. Raise the floor when the parser improves.

/** Fixtures (of RECEIPT_FIXTURES) whose date and total must both be right. Measured 2026-10-10: 32 of 39. */
const MIN_DATE_AND_TOTAL = 32

const parse = (text: string) => parseReceipt(text, FIXTURE_TODAY)

function check(r: ParsedReceipt, e: ReceiptExpectation) {
  return {
    date: r.date === e.date,
    total: r.total === e.total,
    vendor: e.vendor === null ? r.vendor === null : (r.vendor ?? "").toLowerCase().includes(e.vendor.toLowerCase()),
  }
}

const results = RECEIPT_FIXTURES.map((f) => ({ f, r: parse(f.text), ok: check(parse(f.text), f.expected) }))
const dateAndTotal = results.filter((x) => x.ok.date && x.ok.total).length
const vendors = results.filter((x) => x.ok.vendor).length
const pct = (n: number) => `${Math.round((n / RECEIPT_FIXTURES.length) * 100)}%`
const score = `${dateAndTotal}/${RECEIPT_FIXTURES.length} (${pct(dateAndTotal)})`

describe("receipt parser accuracy", () => {
  it("fixture ids are unique", () => {
    const ids = RECEIPT_FIXTURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(results.filter((x) => !x.f.knownMiss).map((x) => [x.f.id, x] as const))("%s", (_id, { f, r }) => {
    expect({ date: r.date, total: r.total }).toEqual({ date: f.expected.date, total: f.expected.total })
    expect(check(r, f.expected).vendor, `vendor ${JSON.stringify(r.vendor)} should contain ${JSON.stringify(f.expected.vendor)}`).toBe(true)
  })

  // Documents the limits. If one of these starts passing, the parser improved:
  // drop its knownMiss flag and raise MIN_DATE_AND_TOTAL.
  it.each(results.filter((x) => x.f.knownMiss).map((x) => [x.f.id, x] as const))("known miss: %s", (_id, { f, ok }) => {
    expect(f.why, "a knownMiss fixture says why").toBeTruthy()
    expect(ok.date && ok.total && ok.vendor, "now parsed correctly — remove knownMiss").toBe(false)
  })

  it(`date+total accuracy ${score} stays at or above ${MIN_DATE_AND_TOTAL}/${RECEIPT_FIXTURES.length}`, () => {
    console.info(`[receipt accuracy] date+total ${score}; vendor ${vendors}/${RECEIPT_FIXTURES.length} (${pct(vendors)})`)
    expect(dateAndTotal).toBeGreaterThanOrEqual(MIN_DATE_AND_TOTAL)
  })
})
