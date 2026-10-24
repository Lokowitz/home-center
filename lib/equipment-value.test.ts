import { describe, expect, it } from "vitest"
import { defaultValueClass, effectiveValueClass, equipmentValueTotals, valueClassLabel } from "./equipment-value"

describe("defaultValueClass", () => {
  it("counts HVAC, water and security as part of the home", () => {
    for (const c of ["HVAC", "WATER", "SECURITY"]) expect(defaultValueClass(c), c).toBe("FIXTURE")
  })

  it("counts the rest as belongings, and an unknown category too", () => {
    for (const c of ["APPLIANCE", "ELECTRONICS", "TOOL", "OUTDOOR", "OTHER", "NOPE"]) expect(defaultValueClass(c), c).toBe("CONTENTS")
  })
})

describe("effectiveValueClass", () => {
  it("follows the category when none is set", () => {
    expect(effectiveValueClass({ category: "APPLIANCE", valueClass: null })).toBe("CONTENTS")
    expect(effectiveValueClass({ category: "HVAC", valueClass: null })).toBe("FIXTURE")
  })

  it("lets an override win, like a built-in oven", () => {
    expect(effectiveValueClass({ category: "APPLIANCE", valueClass: "FIXTURE" })).toBe("FIXTURE")
    expect(effectiveValueClass({ category: "HVAC", valueClass: "CONTENTS" })).toBe("CONTENTS")
  })
})

describe("valueClassLabel", () => {
  it("reads in plain words", () => {
    expect(valueClassLabel("FIXTURE")).toBe("Part of the home")
    expect(valueClassLabel("CONTENTS")).toBe("Belongings")
  })
})

describe("equipmentValueTotals", () => {
  const zero = { count: 0, priced: 0, paid: 0, withReplacementCost: 0, toReplace: 0, toReplaceOrPaid: 0 }

  it("is all zeros for no equipment, with both classes present", () => {
    expect(equipmentValueTotals([])).toEqual({ FIXTURE: zero, CONTENTS: zero })
  })

  it("totals each class, treating a price of 0 as priced and falling back to the price paid", () => {
    const totals = equipmentValueTotals([
      { category: "HVAC", valueClass: null, purchasePrice: 4200, replacementCost: 5200 },
      { category: "APPLIANCE", valueClass: null, purchasePrice: 2499, replacementCost: null },
      { category: "ELECTRONICS", valueClass: null, purchasePrice: null, replacementCost: 900 },
      { category: "APPLIANCE", valueClass: "FIXTURE", purchasePrice: 0, replacementCost: null },
      { category: "TOOL", valueClass: null, purchasePrice: null, replacementCost: null },
    ])
    expect(totals.FIXTURE).toEqual({ count: 2, priced: 2, paid: 4200, withReplacementCost: 1, toReplace: 5200, toReplaceOrPaid: 5200 })
    expect(totals.CONTENTS).toEqual({ count: 3, priced: 1, paid: 2499, withReplacementCost: 1, toReplace: 900, toReplaceOrPaid: 3399 })
  })

  it("moves an item between classes when its category changes", () => {
    const item = { valueClass: null, purchasePrice: 800, replacementCost: null }
    expect(equipmentValueTotals([{ ...item, category: "APPLIANCE" }]).CONTENTS.paid).toBe(800)
    expect(equipmentValueTotals([{ ...item, category: "HVAC" }]).FIXTURE.paid).toBe(800)
  })
})
