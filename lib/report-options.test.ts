import { describe, expect, it } from "vitest"
import { DEFAULT_REPORT_OPTIONS, obsDays, parseReportOptions, rangeLabel, reportOptionsQuery } from "./report-options"

describe("report options", () => {
  it("defaults when no params", () => {
    expect(parseReportOptions({})).toEqual(DEFAULT_REPORT_OPTIONS)
  })
  it("overrides booleans and ignores junk", () => {
    const o = parseReportOptions({ allergies: "1", conditions: "0", obs: "bogus", visits: "cost" })
    expect(o.allergies).toBe(true)
    expect(o.conditions).toBe(false)
    expect(o.obs).toBe("off")
    expect(o.visits).toBe("cost")
  })
  it("round-trips through the query string", () => {
    const o = { ...DEFAULT_REPORT_OPTIONS, obs: "30" as const, obsView: "histogram" as const, reminders: true }
    expect(parseReportOptions(Object.fromEntries(new URLSearchParams(reportOptionsQuery(o))))).toEqual(o)
    expect(obsDays(o)).toBe(30)
    expect(obsDays(DEFAULT_REPORT_OPTIONS)).toBeNull()
  })
  it("accepts multi-year ranges and labels them", () => {
    const o = parseReportOptions({ obs: "1095", historyRange: "1825" })
    expect(obsDays(o)).toBe(1095)
    expect(o.historyRange).toBe("1825")
    expect([30, 365, 730, 1095, 1825, "all" as const].map(rangeLabel)).toEqual([
      "last 30 days", "last 12 months", "last 2 years", "last 3 years", "last 5 years", "all time",
    ])
  })
})
