import { describe, expect, it } from "vitest"
import { describeMedications, withoutNotes, type MedRow } from "./medication-history"

const d = (s: string) => new Date(s)
const now = d("2026-10-16T12:00:00Z")
const avery = { id: "p1", name: "Avery" }
const riley = { id: "p2", name: "Riley" }
let n = 0
const row = (person: MedRow["person"], name: string, dosage: string | null, start: string | null, end: string | null, notes: string | null = null): MedRow => ({
  id: `m${++n}`, name, dosage, frequency: null, notes, person, prescriber: null, condition: null,
  startDate: start ? d(start) : null, endDate: end ? d(end) : null,
})

const rows = [
  row(avery, "Famotidine", "60 mg", "2026-03-03", "2026-08-12"),
  row(avery, "Famotidine", "40 mg", "2025-09-06", "2026-03-02", "Increased to 40 mg."),
  row(avery, "Famotidine", "20 mg", "2026-08-13", "2026-08-26"),
  row(avery, "Simvastatin", "50 mg", "2026-09-24", null),
  row(riley, "Famotidine", "10 mg", "2026-07-07", null),
  row(avery, "Melatonin", "1 mg", null, null),
]

describe("describeMedications", () => {
  it("narrows to one drug and keeps each person's rows apart", () => {
    const { people } = describeMedications(rows, now, { medication: "famot" })
    expect(people.map((p) => p.person.name)).toEqual(["Avery", "Riley"])
    expect(people[0].medications).toHaveLength(1)
    expect(people[1].medications[0]).toMatchObject({ medication: "Famotidine", status: "currently taking", currentDosage: "10 mg" })
  })

  it("puts dose periods in date order and says how each one changed", () => {
    const [averyFamot] = describeMedications(rows.filter((r) => r.person === avery), now, { medication: "Famotidine" }).people[0].medications as {
      periods: { dosage: string; from: string; to: string; change: string; notes?: string }[]
      status: string; lastTaken: string; doseChanges: number
    }[]
    expect(averyFamot.periods.map((p) => [p.dosage, p.from, p.to, p.change])).toEqual([
      ["40 mg", "2025-09-06", "2026-03-02", "started"],
      ["60 mg", "2026-03-03", "2026-08-12", "increased from 40 mg"],
      ["20 mg", "2026-08-13", "2026-08-26", "decreased from 60 mg"],
    ])
    expect(averyFamot.periods[0].notes).toBe("Increased to 40 mg.")
    expect(averyFamot).toMatchObject({ status: "stopped", lastTaken: "2026-08-26", doseChanges: 2 })
  })

  it("shows only current medications when asked", () => {
    const { people } = describeMedications(rows, now, { current: true })
    expect(people.find((p) => p.person.name === "Avery")!.medications.map((m) => (m as { medication: string }).medication)).toEqual(["Simvastatin"])
  })

  it("lists rows without a start date rather than dropping them", () => {
    const { people } = describeMedications(rows, now, { medication: "melatonin" })
    expect(people[0].undated).toEqual([{ id: expect.any(String), medication: "Melatonin", dosage: "1 mg" }])
  })

  it("matches nothing for an unknown drug but still knows what is on file", () => {
    const { people, all } = describeMedications(rows, now, { medication: "adderall" })
    expect(people).toEqual([])
    expect(all.find((p) => p.person.name === "Avery")!.knownMedications).toEqual(["Famotidine", "Melatonin", "Simvastatin"])
  })

  it("says the dose changed when the previous dose wasn't recorded", () => {
    const r = [row(avery, "Cetirizine", null, "2024-09-01", "2024-09-12"), row(avery, "Cetirizine", "0.1 mg", "2024-09-13", "2024-10-01")]
    const m = describeMedications(r, now, {}).people[0].medications[0] as { periods: { change: string }[] }
    expect(m.periods.map((p) => p.change)).toEqual(["started", "changed to 0.1 mg (previous dose not recorded)"])
  })

  it("can drop period notes to fit, keeping everything else", () => {
    const reply = { people: describeMedications(rows, now, { medication: "famot" }).people }
    const slim = withoutNotes(reply)
    const periods = (slim.people[0].medications[0] as { periods: Record<string, unknown>[] }).periods
    expect(periods.every((p) => !("notes" in p))).toBe(true)
    expect(periods).toHaveLength(3)
  })

  it("links to the person's Medications tab", () => {
    expect(describeMedications(rows, now, {}).people[0].person.href).toBe("/assets/people/p1?tab=medications")
  })
})
