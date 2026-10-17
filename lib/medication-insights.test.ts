import { describe, expect, it } from "vitest"
import { buildTimeline, type TimelineMedication } from "./medication-timeline"
import { medicationEffects, medicationEvents } from "./medication-effects"
import { medicationInsights } from "./medication-insights"

const d = (s: string) => new Date(s)
const now = d("2026-10-16T12:00:00Z")
const med = (over: Partial<TimelineMedication> & { name: string }): TimelineMedication => ({
  id: over.name + (over.startDate?.toISOString() ?? ""),
  dosage: null, frequency: null, startDate: null, endDate: null, notes: null, ...over,
})

const lanes = buildTimeline([
  med({ name: "Famotidine", dosage: "20 mg", startDate: d("2025-01-01"), endDate: d("2026-05-31") }),
  med({ name: "Famotidine", dosage: "40 mg", startDate: d("2026-06-01"), endDate: d("2026-08-31") }),
  med({ name: "Qelbree", dosage: "150 mg", startDate: d("2026-09-01") }),
  med({ name: "Simvastatin", dosage: "25 mg", startDate: d("2026-10-01") }),
  med({ name: "Wart remover", startDate: d("2026-08-14"), endDate: d("2026-08-14") }),
], now)
const events = medicationEvents(lanes)

// Sparse in 2025 (two in March), then regular from May 2026; a busy June.
const obs = [
  { date: d("2025-03-03"), type: "Meltdown" }, { date: d("2025-03-20"), type: "Sick" },
  ...Array.from({ length: 5 }, (_, i) => ({ date: d(`2026-05-0${i + 1}`), type: "Meltdown" })),
  ...Array.from({ length: 9 }, (_, i) => ({ date: d(`2026-06-1${i}`), type: i % 3 ? "Rage" : "Meltdown" })),
  { date: d("2026-09-20"), type: "Rude" }, { date: d("2026-09-21"), type: "Rude" }, { date: d("2026-10-02"), type: "Meltdown" },
]
const effects = medicationEffects(events, obs, now)
const ins = medicationInsights(lanes, events, effects, obs, now)

describe("medicationInsights", () => {
  it("lists what is taken now, most recently changed first", () => {
    expect(ins.current.map((c) => `${c.name} ${c.dosage}`)).toEqual(["Simvastatin 25 mg", "Qelbree 150 mg"])
    expect(ins.lastChangeAt).toBe(d("2026-10-01").getTime())
  })
  it("counts drugs tried (not one-day items) and changes in the last year", () => {
    expect(ins.tried).toBe(3)
    // Famotidine 20→40 and its stop, Qelbree and Simvastatin starts.
    expect(ins.changesLastYear).toBe(4)
  })
  it("compares the last 90 days with the 90 before", () => {
    // The 90 days before run Apr 19 – Jul 18: May's five and June's nine.
    expect(ins.observations).toMatchObject({ total: 19, last90: 3, prior90: 14, perWeek90: 0.2 })
  })
  it("finds the busiest month", () => {
    expect(ins.observations.busiestMonth).toEqual({ label: "Jun 2026", count: 9 })
  })
  it("dates regular logging from the unbroken run up to last month, not an old busy month", () => {
    // Here July and September are thin, so there is no current run.
    expect(ins.observations.regularFrom).toBeNull()
    const steady = [
      ...Array.from({ length: 6 }, (_, i) => ({ date: d(`2022-12-0${i + 1}`), type: "Sick" })),
      ...["2026-07", "2026-08", "2026-09"].flatMap((m) => Array.from({ length: 4 }, (_, i) => ({ date: d(`${m}-1${i}`), type: "Meltdown" }))),
    ]
    expect(medicationInsights(lanes, events, effects, steady, now).observations.regularFrom).toBe(d("2026-07-01").getTime())
  })
  it("keeps only types logged at least twice in the last 90 days", () => {
    expect(ins.observations.topTypes90).toEqual([{ type: "Rude", count: 2 }])
  })
  it("rates the last 90 days by their worst entries", () => {
    // Three unrated entries on three days in the last 90: mild days.
    expect(ins.observations).toMatchObject({ avgDay90: 0, severeDays90: 0 })
    const rated = medicationInsights(lanes, events, effects, [
      { date: d("2026-10-02"), type: "Rage", severity: 5 }, { date: d("2026-10-02"), type: "Rude", severity: 1 },
      { date: d("2026-09-20"), type: "Rude", severity: 4 }, { date: d("2026-07-01"), type: "Old", severity: 5 },
    ], now)
    expect(rated.observations).toMatchObject({ avgDay90: 0.1, severeDays90: 2 })
  })
  it("picks the largest readable rise and drop", () => {
    expect(ins.biggestRise?.name).toBe("Famotidine")
    expect(ins.biggestRise?.kind).toBe("up")
    // Nothing in this record was followed by fewer entries.
    expect(ins.biggestDrop).toBeNull()
  })
})
