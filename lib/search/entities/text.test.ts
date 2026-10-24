import { describe, expect, it } from "vitest"
import {
  ageWords, allergyDoc, compose, INLINE_NOTE_CHARS, insuranceDoc, intervalWords, maintenanceDoc, medicationDoc, observationDoc, personDoc,
  propertyDoc, roomDoc, sentences, serviceDoc, vehicleDoc, warrantyDoc,
} from "./text"
import { createFormatter, DEFAULT_REGIONAL } from "@/lib/regional"

const now = new Date("2026-10-01T12:00:00Z")
const day = (s: string) => new Date(`${s}T00:00:00Z`)

describe("sentences", () => {
  it("drops empty parts and adds missing full stops", () => {
    expect(sentences(["One", null, false, "", "Two.", "  three  "])).toBe("One. Two. three.")
  })
})

describe("ageWords", () => {
  it("reads years, months, or new", () => {
    expect(ageWords(day("2016-09-01"), now)).toBe("about 10 years old")
    expect(ageWords(day("2025-10-02"), now)).toBe("about 12 months old")
    expect(ageWords(day("2026-09-20"), now)).toBe("new")
  })
})

describe("intervalWords", () => {
  it("prefers whole years, months, weeks", () => {
    expect(intervalWords(365, null, null)).toBe("Repeats every year")
    expect(intervalWords(90, 5000, "MILES")).toBe("Repeats every 3 months or every 5,000 miles")
    expect(intervalWords(14, null, null)).toBe("Repeats every 2 weeks")
    expect(intervalWords(null, 100, "HOURS")).toBe("Repeats every 100 engine hours")
    expect(intervalWords(null, null, null)).toBeNull()
  })
})

describe("compose", () => {
  it("keeps a short note in the summary", () => {
    expect(compose("Summary.", [{ label: "Notes", text: "short", of: "x" }])).toEqual(["Summary. Notes: short."])
  })

  it("gives a long note chunks of its own, labelled with what it belongs to", () => {
    const long = "word ".repeat(INLINE_NOTE_CHARS)
    const chunks = compose("Summary.", [{ label: "Notes", text: long, of: "property Maple" }])
    expect(chunks[0]).toBe("Summary.")
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.slice(1).every((c) => c.startsWith("Notes for property Maple: word"))).toBe(true)
  })
})

describe("record text", () => {
  it("writes a property with everything that carries meaning", () => {
    const doc = propertyDoc({
      id: "p1", name: "Maple Street House", type: "HOUSE", address: "412 Maple St, Springfield",
      purchaseDate: day("2019-05-10"), purchasePrice: 412000, yearBuilt: 1998, sqFt: 2150,
      notes: "Corner lot, finished basement.",
      equipment: [{ name: "Gas Furnace", category: "Heating & Cooling" }],
    }, now)
    expect(doc).toEqual({
      kind: "PROPERTY",
      id: "p1",
      chunks: [
        "Property: Maple Street House. A house at 412 Maple St, Springfield. Built in 1998 (about 28 years old). " +
        "2,150 square feet. Purchased May 2019 for about $412,000. Equipment here: Gas Furnace (heating & cooling). " +
        "Notes: Corner lot, finished basement.",
      ],
    })
  })

  it("writes a room with its property, flooring and paint", () => {
    const doc = roomDoc({
      id: "r1", name: "Kitchen", level: "Main floor", area: 224, dimensions: "14 × 16 ft",
      flooringType: "Hardwood", flooringProduct: "Bruce Natural Oak", notes: null,
      property: { name: "Maple Street House" },
      paints: [
        { surface: "Walls", brand: "Sherwin-Williams", colorName: "Agreeable Gray", colorCode: "SW 7029", finish: "Eggshell" },
        { surface: "Ceiling", brand: null, colorName: null, colorCode: null, finish: null },
      ],
    })
    expect(doc.kind).toBe("ROOM")
    expect(doc.chunks[0]).toContain("Agreeable Gray")
    expect(doc.chunks[0]).toContain("Maple Street House")
    expect(doc.chunks[0]).toBe(
      "Room: Kitchen at Maple Street House. Level: Main floor. 224 square feet (14 × 16 ft). " +
      "Flooring: Hardwood, Bruce Natural Oak. Paint: Walls: Sherwin-Williams Agreeable Gray SW 7029 · Eggshell; Ceiling."
    )
  })

  it("leaves identifiers out of a vehicle", () => {
    const doc = vehicleDoc({
      id: "v1", name: "Commuter", make: "Honda", model: "Civic Sport", year: 2021, color: "Blue",
      purchaseDate: null, purchasePrice: null, currentMileage: 28900, meterUnit: "MILES", notes: null,
    }, now)
    expect(doc.chunks).toEqual(["Vehicle: Commuter. A 2021 Honda Civic Sport, blue (about 5 years old). About 28,900 miles on it."])
  })

  it("names the owner of a service record and calls a person's one a health visit", () => {
    const asset = serviceDoc({
      id: "s1", title: "Annual furnace service", description: "Replaced filter.", date: day("2026-08-14"), vendor: "Comfort Air",
      cost: 189, category: "Routine", mileageAtService: null, meterUnit: null, isPerson: false,
      owner: { kind: "equipment", name: "Gas Furnace", at: "Maple Street House" }, provider: null, condition: null,
    })
    expect(asset.chunks[0]).toBe(
      "Service record for Gas Furnace (equipment at Maple Street House) on August 14, 2026: Annual furnace service. " +
      "Done by Comfort Air. Type: Routine. Cost about $189. Details: Replaced filter."
    )
    const visit = serviceDoc({
      id: "s2", title: "Ear check", description: null, date: day("2026-03-02"), vendor: null, cost: null, category: "Office visit",
      mileageAtService: null, meterUnit: null, isPerson: true, owner: { kind: "person", name: "Sam" },
      provider: { name: "Dr. Lee", specialty: "Pediatrics" }, condition: "Otitis media",
    })
    expect(visit.chunks[0]).toBe(
      "Health visit for Sam on March 2, 2026: Ear check. Seen by Dr. Lee (Pediatrics). Type: Office visit. For the condition Otitis media."
    )
  })

  it("marks an overdue reminder and a paused one", () => {
    const base = {
      id: "m1", title: "Oil change", description: null, owner: { kind: "vehicle" as const, name: "Commuter" }, isPerson: false,
      intervalDays: 180, intervalMiles: 5000, meterUnit: "MILES" as const, lastCompletedDate: null, nextDueDate: day("2026-09-01"),
      nextDueMileage: null, isActive: true,
    }
    expect(maintenanceDoc(base, now).chunks[0]).toBe(
      "Maintenance reminder for Commuter (vehicle): Oil change. Repeats every 6 months or every 5,000 miles. Next due September 1, 2026 (overdue)."
    )
    expect(maintenanceDoc({ ...base, isActive: false }, now).chunks[0]).toContain("Paused, not currently scheduled.")
  })

  it("says whether a warranty has expired", () => {
    const w = { id: "w1", productName: "Compressor", owner: null, vendor: null, purchaseDate: null, notes: null }
    expect(warrantyDoc({ ...w, expirationDate: day("2026-01-01") }, now).chunks[0]).toContain("Expired January 1, 2026.")
    expect(warrantyDoc({ ...w, expirationDate: day("2030-01-01") }, now).chunks[0]).toContain("Coverage runs until January 1, 2030.")
  })

  it("names a policy's kind and what it covers", () => {
    const p = { id: "i1", carrier: "State Farm", planName: "HO-3", kind: "PROPERTY_OTHER", startDate: null, endDate: null, deductible: null, outOfPocketMax: null, notes: null, members: [], assets: ["Maple Street House", "Work Truck"] }
    expect(insuranceDoc(p, now).chunks[0]).toContain("Other insurance policy from State Farm, plan HO-3.")
    expect(insuranceDoc(p, now).chunks[0]).toContain("Covers Maple Street House, Work Truck.")
    expect(insuranceDoc({ ...p, kind: "HOME", assets: [] }, now).chunks[0]).toContain("Home insurance policy")
    // People on a non-health policy are health data: they stay out of the text that semantic search matches on.
    expect(insuranceDoc({ ...p, kind: "LIFE", assets: [], members: ["Avery"] }, now).chunks[0]).not.toContain("Avery")
    expect(insuranceDoc({ ...p, kind: "MEDICAL", assets: [], members: ["Avery"] }, now).chunks[0]).toContain("Covers Avery.")
  })

  it("summarises a person's health so 'who is allergic to…' finds them", () => {
    const doc = personDoc({
      id: "x", name: "Sam Rivera", relationship: "CHILD", dateOfBirth: day("2016-04-02"), sex: null, notes: null,
      primaryProvider: { name: "Dr. Lee", specialty: "Pediatrics" },
      conditions: [{ name: "Asthma", status: "MANAGED" }], medications: ["Albuterol"], allergies: ["Penicillin"],
    }, now)
    expect(doc.chunks[0]).toBe(
      "Person: Sam Rivera. Household relationship: child. Age 10. Primary care: Dr. Lee (Pediatrics). " +
      "Health conditions: Asthma (managed). Current medications: Albuterol. Allergies: Penicillin."
    )
  })

  it("writes health records in words", () => {
    expect(allergyDoc({ id: "a", substance: "Peanuts", reaction: "Hives", severity: "SEVERE", person: "Sam", notes: null }).chunks[0])
      .toBe("Allergy: Sam is allergic to Peanuts. Reaction: Hives. Severity: severe.")
    expect(medicationDoc({
      id: "m", name: "Albuterol", dosage: "90 mcg", frequency: "as needed", pharmacy: null, startDate: null, endDate: null,
      person: "Sam", prescriber: "Dr. Lee", condition: "Asthma", notes: null,
    }, now).chunks[0]).toBe("Medication for Sam: Albuterol 90 mcg. Taken as needed. For Asthma. Prescribed by Dr. Lee. Currently taking it.")
    expect(observationDoc({
      id: "o", type: "Meltdown", date: day("2026-09-30"), time: "17:30", severity: 4, durationMinutes: 20,
      tags: "school, tired", person: "Sam", condition: null, notes: null,
    }).chunks[0]).toBe(
      "Observation about Sam on September 30, 2026 at 17:30: Meltdown. Severity 4 of 5 (severe). Lasted about 20 minutes. Tags: school, tired."
    )
  })
})

describe("household units", () => {
  const metric = createFormatter({ ...DEFAULT_REGIONAL, currency: "EUR", distanceUnit: "KM", areaUnit: "SQM" })

  it("writes metric units and the household currency", () => {
    expect(intervalWords(90, 5000, "MILES", metric)).toBe("Repeats every 3 months or every 5,000 kilometres")
    const doc = vehicleDoc({
      id: "v1", name: "Commuter", make: "Honda", model: "Civic Sport", year: 2021, color: "Blue",
      purchaseDate: day("2022-03-01"), purchasePrice: 20000, currentMileage: 28900, meterUnit: "MILES", notes: null,
    }, now, metric)
    expect(doc.chunks[0]).toContain("About 28,900 kilometres on it")
    expect(doc.chunks[0]).toContain(metric.moneyWhole(20000))
    expect(doc.chunks[0]).not.toContain("$")
  })
})
