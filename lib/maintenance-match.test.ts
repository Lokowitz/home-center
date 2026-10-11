import { describe, expect, it } from "vitest"
import { matchingReminder } from "./maintenance-match"

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
