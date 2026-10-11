import { describe, expect, it } from "vitest"
import { matchingReminder, remindersInText } from "./maintenance-match"

const r = (id: string, title: string) => ({ id, title })
const ids = (title: string, reminders: { id: string; title: string }[]) => matchingReminder(title, reminders)?.id ?? null

describe("matchingReminder", () => {
  const reminders = [r("oil", "Oil change & filter"), r("tires", "Rotate tires"), r("air", "Replace cabin air filter"), r("svc", "Annual service")]

  it("finds a reminder whose words the title covers, or the other way round", () => {
    expect(ids("Oil change", reminders)).toBe("oil")
    expect(ids("oil change and filter at Jiffy Lube", reminders)).toBe("oil")
    expect(ids("Tire rotation", [r("t", "Tire rotation")])).toBe("t")
  })

  it("ignores case, punctuation, plurals and verb endings", () => {
    expect(ids("Changed the oil", [r("o", "Oil change")])).toBe("o")
    expect(ids("ROTATED TIRES!", [r("t", "Rotate tire")])).toBe("t")
  })

  it("picks the reminder sharing the most words", () => {
    expect(ids("Replaced cabin air filter", reminders)).toBe("air")
  })

  it("doesn't match on generic words alone", () => {
    expect(ids("Service", reminders)).toBeNull()
    expect(ids("Annual maintenance", reminders)).toBeNull()
    expect(ids("Filter", reminders)).toBeNull()
  })

  it("doesn't match unrelated or empty titles", () => {
    expect(ids("Brake pads", reminders)).toBeNull()
    expect(ids("", reminders)).toBeNull()
    expect(ids("   \t ", reminders)).toBeNull()
    expect(ids("Oil change", [])).toBeNull()
  })
})

describe("remindersInText", () => {
  const rem = (id: string, title: string, assetId: string) => ({ id, title, assetType: "VEHICLE" as const, assetId })
  const reminders = [rem("o1", "Oil change", "v1"), rem("t1", "Tire rotation", "v1"), rem("o2", "Oil change", "v2"), rem("b2", "Brake fluid flush", "v2")]
  const receipt = "JIFFY LUBE #1234\nFull synthetic oil change ... 59.99\nOil filter\n\tTotal 64.21\n\nThank you"

  it("finds each asset's reminder the receipt reads as, keyed by asset", () => {
    expect(remindersInText(receipt, reminders)).toEqual({ "VEHICLE:v1": "o1", "VEHICLE:v2": "o2" })
  })

  it("leaves out assets with nothing matching, or with a tie", () => {
    expect(remindersInText("Brake fluid flush and tire rotation", reminders)).toEqual({ "VEHICLE:v1": "t1", "VEHICLE:v2": "b2" })
    const tied = [rem("a", "Oil change", "v1"), rem("b", "Change oil", "v1")]
    expect(remindersInText(receipt, tied)).toEqual({})
  })

  it("returns nothing for empty text or no reminders", () => {
    expect(remindersInText("", reminders)).toEqual({})
    expect(remindersInText(receipt, [])).toEqual({})
  })
})
