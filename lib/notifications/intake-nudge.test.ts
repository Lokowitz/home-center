import { describe, expect, it } from "vitest"
import { decideIntakeNudge, type IntakeNudgeItem, type PriorNudge } from "./intake-nudge"

const NOW = new Date("2026-10-10T12:00:00Z")
const DAY = 86_400_000
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY)
const item = (age: number, over: Partial<IntakeNudgeItem> = {}): IntakeNudgeItem => ({ createdAt: daysAgo(age), suggestedAssetType: null, ...over })
const nudge = (over: Partial<PriorNudge> = {}): PriorNudge => ({
  id: "n1",
  title: "1 item waiting in Intake",
  message: "Added more than a week ago. File, keep or discard it.",
  cycleKey: daysAgo(8).toISOString(),
  dismissedAt: null,
  ...over,
})
const run = (items: IntakeNudgeItem[], prior: PriorNudge[] = [], health = true) => decideIntakeNudge({ items, now: NOW, prior, health })

describe("decideIntakeNudge", () => {
  it("does nothing when no item is over a week old", () => {
    expect(run([item(1), item(6.9)])).toEqual({ action: "none" })
  })

  it("does nothing when Intake is empty and no nudge is open", () => {
    expect(run([])).toEqual({ action: "none" })
  })

  it("waits until an item is more than 7 days old (exactly 7 days is not yet)", () => {
    expect(run([item(7)])).toEqual({ action: "none" })
    expect(run([item(7 + 1 / 1440)])).toMatchObject({ action: "create" })
  })

  it("creates one nudge for one old item, in the singular", () => {
    expect(run([item(8), item(2)])).toEqual({
      action: "create",
      title: "1 item waiting in Intake",
      message: "Added more than a week ago. File, keep or discard it.",
      cycleKey: daysAgo(8).toISOString(),
    })
  })

  it("counts several old items and keys on the newest of them", () => {
    expect(run([item(30), item(9), item(12), item(1)])).toEqual({
      action: "create",
      title: "3 items waiting in Intake",
      message: "Added more than a week ago. File, keep or discard them.",
      cycleKey: daysAgo(9).toISOString(),
    })
  })

  it("leaves out items suggested for a person while Health is off", () => {
    const items = [item(10, { suggestedAssetType: "PERSON" }), item(9, { suggestedAssetType: "VEHICLE" })]
    expect(run(items, [], false)).toMatchObject({ action: "create", title: "1 item waiting in Intake", cycleKey: daysAgo(9).toISOString() })
    expect(run(items, [], true)).toMatchObject({ action: "create", title: "2 items waiting in Intake" })
    expect(run([item(10, { suggestedAssetType: "PERSON" })], [], false)).toEqual({ action: "none" })
  })

  it("leaves an open nudge alone when nothing changed", () => {
    expect(run([item(8)], [nudge()])).toEqual({ action: "none" })
  })

  it("updates the open nudge instead of creating another", () => {
    expect(run([item(8), item(7.5)], [nudge()])).toEqual({
      action: "update",
      id: "n1",
      title: "2 items waiting in Intake",
      message: "Added more than a week ago. File, keep or discard them.",
      cycleKey: daysAgo(7.5).toISOString(),
    })
  })

  it("updates the open nudge's count when some were filed", () => {
    const open = nudge({ title: "3 items waiting in Intake", message: "Added more than a week ago. File, keep or discard them.", cycleKey: daysAgo(8).toISOString() })
    expect(run([item(8)], [open])).toMatchObject({ action: "update", id: "n1", title: "1 item waiting in Intake" })
  })

  it("stays quiet after a dismissal while no newer item has crossed the mark", () => {
    const dismissed = nudge({ dismissedAt: daysAgo(0.5) })
    expect(run([item(8)], [dismissed])).toEqual({ action: "none" })
    // An older straggler doesn't count as new either.
    expect(run([item(8), item(20)], [dismissed])).toEqual({ action: "none" })
  })

  it("nudges again once a newer item crosses the mark after a dismissal", () => {
    const dismissed = nudge({ dismissedAt: daysAgo(0.5) })
    expect(run([item(8), item(7.2)], [dismissed])).toEqual({
      action: "create",
      title: "2 items waiting in Intake",
      message: "Added more than a week ago. File, keep or discard them.",
      cycleKey: daysAgo(7.2).toISOString(),
    })
  })

  it("remembers the newest marker across several dismissed nudges", () => {
    const older = nudge({ id: "a", cycleKey: daysAgo(20).toISOString(), dismissedAt: daysAgo(10) })
    const newer = nudge({ id: "b", cycleKey: daysAgo(8).toISOString(), dismissedAt: daysAgo(1) })
    expect(run([item(9)], [older, newer])).toEqual({ action: "none" })
  })

  it("resolves the open nudge when Intake is empty", () => {
    expect(run([], [nudge()])).toEqual({ action: "resolve", id: "n1" })
  })

  it("resolves the open nudge when nothing left is over a week old", () => {
    expect(run([item(3)], [nudge()])).toEqual({ action: "resolve", id: "n1" })
  })

  it("resolves when the only old items are a person's and Health is off", () => {
    expect(run([item(9, { suggestedAssetType: "PERSON" })], [nudge()], false)).toEqual({ action: "resolve", id: "n1" })
  })

  it("leaves dismissed nudges alone when Intake empties", () => {
    expect(run([], [nudge({ dismissedAt: daysAgo(1) })])).toEqual({ action: "none" })
  })
})
