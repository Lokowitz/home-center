import { describe, expect, it } from "vitest"
import {
  checksPerDay,
  describeInterval,
  effectiveInterval,
  intervalWarning,
  isValidInterval,
  untilDismissedWarning,
} from "./interval"

describe("isValidInterval", () => {
  it("accepts 0 and 5 or more whole minutes", () => {
    expect(isValidInterval(0)).toBe(true)
    expect(isValidInterval(5)).toBe(true)
    expect(isValidInterval(360)).toBe(true)
  })
  it("refuses 1 to 4, negatives and fractions", () => {
    for (const n of [1, 4, -1, 7.5]) expect(isValidInterval(n)).toBe(false)
  })
})

describe("effectiveInterval", () => {
  it("prefers the saved value", () => {
    expect(effectiveInterval(30, "60")).toEqual({ minutes: 30, source: "settings" })
  })
  it("keeps a saved 0 (off) rather than falling back", () => {
    expect(effectiveInterval(0, "60")).toEqual({ minutes: 0, source: "settings" })
  })
  it("falls back to the environment, then the default", () => {
    expect(effectiveInterval(null, "60")).toEqual({ minutes: 60, source: "env" })
    expect(effectiveInterval(null, undefined)).toEqual({ minutes: 360, source: "default" })
  })
  it("ignores an invalid saved or env value", () => {
    expect(effectiveInterval(2, "60")).toEqual({ minutes: 60, source: "env" })
    expect(effectiveInterval(null, "abc")).toEqual({ minutes: 360, source: "default" })
    expect(effectiveInterval(null, "-5")).toEqual({ minutes: 360, source: "default" })
    expect(effectiveInterval(null, "")).toEqual({ minutes: 360, source: "default" })
  })
})

describe("describeInterval", () => {
  it("uses the largest whole unit", () => {
    expect(describeInterval(10)).toBe("10 minutes")
    expect(describeInterval(60)).toBe("1 hour")
    expect(describeInterval(360)).toBe("6 hours")
    expect(describeInterval(90)).toBe("90 minutes")
    expect(describeInterval(1440)).toBe("1 day")
    expect(describeInterval(0)).toBe("never")
  })
})

describe("intervalWarning", () => {
  it("warns below 15 minutes", () => {
    expect(intervalWarning(5)).toMatch(/very often/)
    expect(intervalWarning(14)).toMatch(/very often/)
  })
  it("is quiet at 15 and above, and when off", () => {
    expect(intervalWarning(15)).toBeNull()
    expect(intervalWarning(360)).toBeNull()
    expect(intervalWarning(0)).toBeNull()
  })
})

describe("untilDismissedWarning", () => {
  it("warns at the 6 hour default, with the count per day", () => {
    expect(checksPerDay(360)).toBe(4)
    expect(untilDismissedWarning(360)).toMatch(/spammed/)
    expect(untilDismissedWarning(360)).toMatch(/4 times a day/)
  })
  it("warns at exactly once a day", () => {
    expect(untilDismissedWarning(1440)).toMatch(/1 time a day/)
  })
  it("is quiet when checks are off or less than daily", () => {
    expect(untilDismissedWarning(0)).toBeNull()
    expect(untilDismissedWarning(2880)).toBeNull()
  })
})
