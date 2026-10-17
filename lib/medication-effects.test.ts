import { describe, expect, it } from "vitest"
import { buildTimeline, type TimelineMedication } from "./medication-timeline"
import { medicationEffects, medicationEvents } from "./medication-effects"

const d = (s: string) => new Date(s)
const med = (over: Partial<TimelineMedication> & { name: string }): TimelineMedication => ({
  id: over.name + (over.startDate?.toISOString() ?? ""),
  dosage: null, frequency: null, startDate: null, endDate: null, notes: null, ...over,
})
const now = d("2026-10-16T00:00:00Z")

const lanes = buildTimeline([
  med({ name: "Famotidine", dosage: "40 mg", startDate: d("2026-01-01"), endDate: d("2026-03-02") }),
  med({ name: "Famotidine", dosage: "60 mg", startDate: d("2026-03-03"), endDate: d("2026-08-12") }),
  med({ name: "Strattera", dosage: "10 mg", startDate: d("2026-03-20"), endDate: d("2026-04-10") }),
  med({ name: "Qelbree", dosage: "150 mg", startDate: d("2026-10-09") }),
  med({ name: "Wart remover", startDate: d("2026-03-10"), endDate: d("2026-03-10") }),
], now)

describe("medicationEvents", () => {
  const events = medicationEvents(lanes)
  it("lists starts, dose changes and stops, oldest first, skipping one-day items", () => {
    expect(events.map((e) => `${e.name}:${e.kind}`)).toEqual([
      "Famotidine:start", "Famotidine:up", "Strattera:start", "Strattera:stop", "Famotidine:stop", "Qelbree:start",
    ])
  })
  it("labels a change with both doses and a stop on the day after the last dose", () => {
    expect(events[1].label).toBe("40 mg → 60 mg")
    const stop = events.find((e) => e.name === "Strattera" && e.kind === "stop")!
    expect(stop.at).toBe(d("2026-04-11").getTime())
  })
})

describe("medicationEffects", () => {
  const events = medicationEvents(lanes)
  // Logging starts mid-December: one a week before March 3, three a week after.
  const obs: Date[] = []
  for (let t = d("2025-12-15").getTime(); t < d("2026-03-03").getTime(); t += 7 * 86_400_000) obs.push(new Date(t))
  for (let t = d("2026-03-03").getTime(); t < d("2026-03-31").getTime(); t += 7 * 86_400_000) obs.push(new Date(t), new Date(t + 86_400_000), new Date(t + 2 * 86_400_000))
  const effects = medicationEffects(events, obs, now)
  const up = effects.find((e) => e.kind === "up")!

  it("compares the average day in the four weeks either side", () => {
    expect(up.before).toMatchObject({ avg: 0.1, rough: 4, severe: 0, count: 4, perWeek: 1, days: 28, from: d("2026-02-03").getTime(), to: d("2026-03-03").getTime() })
    expect(up.after).toMatchObject({ avg: 0.4, rough: 12, count: 12, perWeek: 3, days: 28, from: d("2026-03-03").getTime(), to: d("2026-03-31").getTime() })
    // Unrated entries make mild days: (12 − 4) / 28, from the unrounded averages.
    expect(up.delta).toBe(0.3)
    expect(up.status).toBe("ok")
  })
  it("carries the dose period, frequency and notes of the change", () => {
    expect(up.period).toEqual({ start: d("2026-03-03").getTime(), end: d("2026-08-13").getTime(), ongoing: false })
    const stop = effects.find((e) => e.name === "Strattera" && e.kind === "stop")!
    expect(stop.period.end).toBe(d("2026-04-11").getTime())
  })
  it("ranks the most-logged observation types on each side", () => {
    const typed = medicationEffects(events, [
      { date: d("2026-02-10"), type: "Meltdown" }, { date: d("2026-02-12"), type: "Meltdown" }, { date: d("2026-02-20"), type: "Rude" },
      { date: d("2026-03-05"), type: "Rage" }, d("2026-03-06"),
    ], now)
    const u = typed.find((e) => e.kind === "up")!
    expect(u.before.topTypes).toEqual([{ type: "Meltdown", count: 2 }, { type: "Rude", count: 1 }])
    expect(u.after).toMatchObject({ count: 2, topTypes: [{ type: "Rage", count: 1 }] })
  })
  it("rates each day by its worst entry, so one severe day outweighs many mild entries", () => {
    const rated = medicationEffects(events, [
      ...Array.from({ length: 6 }, () => ({ date: d("2026-02-10"), severity: 1 })),
      { date: d("2026-03-05"), severity: 5 }, { date: d("2026-03-05"), severity: 2 },
    ], now)
    const u = rated.find((e) => e.kind === "up")!
    expect(u.before).toMatchObject({ count: 6, rough: 1, severe: 0, ratingSum: 1 })
    expect(u.after).toMatchObject({ count: 2, rough: 1, severe: 1, ratingSum: 5 })
    expect(u.delta).toBe(0.1)
  })
  it("names other medications that changed in the same window", () => {
    expect(up.nearby.map((n) => `${n.name}:${n.kind}`)).toEqual(["Strattera:start"])
  })
  it("has no baseline when logging hadn't started yet", () => {
    expect(effects.find((e) => e.name === "Famotidine" && e.kind === "start")!.status).toBe("no-baseline")
  })
  it("is too recent with under two weeks after", () => {
    const q = effects.find((e) => e.name === "Qelbree")!
    expect(q.status).toBe("too-recent")
    expect(q.after.days).toBe(7)
  })
})
