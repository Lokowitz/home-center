import { describe, expect, it } from "vitest"
import { addYearsUTC, ageLabel, equipmentAge, lifeStart, localDay, replacementPlan } from "./equipment-life"

const d = (s: string) => new Date(s)
const none = { installDate: null, purchaseDate: null, expectedLifeYears: null }

describe("addYearsUTC", () => {
  it("keeps the month and day, at noon UTC", () => {
    expect(addYearsUTC(d("2020-06-15T00:00Z"), 4).toISOString()).toBe("2024-06-15T12:00:00.000Z")
  })

  it("moves Feb 29 to Feb 28 in a year without one", () => {
    expect(addYearsUTC(d("2016-02-29T00:00Z"), 10).toISOString()).toBe("2026-02-28T12:00:00.000Z")
  })
})

describe("lifeStart", () => {
  it("prefers the install date, then the purchase date", () => {
    expect(lifeStart({ ...none, installDate: d("2020-01-01"), purchaseDate: d("2019-01-01") })).toEqual(d("2020-01-01"))
    expect(lifeStart({ ...none, purchaseDate: d("2019-01-01") })).toEqual(d("2019-01-01"))
    expect(lifeStart(none)).toBeNull()
  })
})

describe("equipmentAge", () => {
  it("counts whole years against the expected life", () => {
    expect(equipmentAge({ ...none, installDate: d("2014-03-01T00:00Z"), expectedLifeYears: 15 }, d("2026-10-24T12:00Z"))).toEqual({ years: 12, lifeYears: 15, pastLife: false })
  })

  it("turns over on the anniversary, by UTC calendar day", () => {
    const e = { ...none, installDate: d("2016-03-01T00:00Z"), expectedLifeYears: 10 }
    expect(equipmentAge(e, d("2026-02-28T23:00Z"))).toMatchObject({ years: 9, pastLife: false })
    expect(equipmentAge(e, d("2026-03-01T00:30Z"))).toMatchObject({ years: 10, pastLife: true })
  })

  it("counts a Feb 29 install as a year older on Feb 28", () => {
    expect(equipmentAge({ ...none, installDate: d("2016-02-29T00:00Z"), expectedLifeYears: 10 }, d("2026-02-28T12:00Z"))).toMatchObject({ years: 10, pastLife: true })
  })

  it("is never negative for a start date in the future", () => {
    expect(equipmentAge({ ...none, installDate: d("2027-01-01T00:00Z"), expectedLifeYears: 10 }, d("2026-10-24T12:00Z"))?.years).toBe(0)
  })

  it("is null without an expected life or a start date", () => {
    expect(equipmentAge({ ...none, installDate: d("2020-01-01") }, d("2026-10-24"))).toBeNull()
    expect(equipmentAge({ ...none, expectedLifeYears: 10 }, d("2026-10-24"))).toBeNull()
  })
})

describe("ageLabel", () => {
  it("reads 12 of 15 years, and 1 year in the singular", () => {
    expect(ageLabel({ years: 12, lifeYears: 15 })).toBe("12 of 15 years")
    expect(ageLabel({ years: 0, lifeYears: 1 })).toBe("0 of 1 year")
  })
})

describe("replacementPlan", () => {
  const heater = { ...none, name: "Water Heater", replacementCost: 1800 as number | null }
  const today = d("2026-10-24T12:00Z")

  it("is due when the life ends, with the replacement cost as the estimate", () => {
    expect(replacementPlan({ ...heater, installDate: d("2020-05-10T00:00Z"), expectedLifeYears: 12 }, today)).toEqual({
      title: "Replace Water Heater",
      dueDate: d("2032-05-10T12:00Z"),
      estimatedCost: 1800,
    })
  })

  it("is a year from today when the life already ran out", () => {
    expect(replacementPlan({ ...heater, installDate: d("2010-05-10T00:00Z"), expectedLifeYears: 12 }, today).dueDate).toEqual(d("2027-10-24T12:00Z"))
  })

  it("keeps today when the life ends today", () => {
    expect(replacementPlan({ ...heater, installDate: d("2014-10-24T00:00Z"), expectedLifeYears: 12 }, d("2026-10-24T20:00Z")).dueDate).toEqual(d("2026-10-24T12:00Z"))
  })

  it("is a year from today without an expected life or any date", () => {
    expect(replacementPlan({ ...heater, installDate: d("2020-05-10T00:00Z") }, today).dueDate).toEqual(d("2027-10-24T12:00Z"))
    expect(replacementPlan({ ...heater, expectedLifeYears: 12 }, today).dueDate).toEqual(d("2027-10-24T12:00Z"))
  })

  it("leaves the estimate blank, not 0, without a replacement cost", () => {
    expect(replacementPlan({ ...heater, replacementCost: null }, today).estimatedCost).toBeNull()
  })
})

describe("localDay", () => {
  it("is the viewer's calendar day at noon UTC, whatever the hour or time zone", () => {
    expect(localDay(new Date(2026, 9, 24, 20, 0)).toISOString()).toBe("2026-10-24T12:00:00.000Z")
    expect(localDay(new Date(2026, 9, 24, 0, 30)).toISOString()).toBe("2026-10-24T12:00:00.000Z")
    expect(localDay(new Date(2026, 11, 31, 23, 59)).toISOString()).toBe("2026-12-31T12:00:00.000Z")
  })

  it("lets a life that ends today count as not passed in the evening", () => {
    const evening = localDay(new Date(2026, 9, 24, 20, 0))
    expect(replacementPlan({ ...none, name: "Heater", replacementCost: null, installDate: d("2014-10-24T00:00Z"), expectedLifeYears: 12 }, evening).dueDate).toEqual(d("2026-10-24T12:00Z"))
  })
})
