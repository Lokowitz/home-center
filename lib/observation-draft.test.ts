import { describe, expect, it } from "vitest"
import {
  draftSummaryLine, isDraftCard, localDay, matchExistingType, parseSeverity, resolveDraftDate, severityLabel, toFormValues,
  type DraftCard, type ObservationDraft,
} from "./observation-draft"

const draft: ObservationDraft = {
  draftId: "obs-abc123", personId: "p1", personName: "Avery", date: "2026-10-17", time: "15:30",
  type: "Aggression", severity: 4, severitySource: "estimated", durationMinutes: 20,
  notes: "Hit her brother after school", tags: ["school"],
}

describe("parseSeverity", () => {
  it.each([
    [3, 3], ["4", 4], ["4/5", 4], [" 2 / 5 ", 2], ["mild", 1], ["Slight", 1], ["minor", 2], ["mild-moderate", 2],
    ["mild–moderate", 2], ["moderate", 3], ["moderate-severe", 4], ["bad", 4], ["severe", 5], ["EXTREME", 5],
  ])("%s → %i", (input, out) => {
    expect(parseSeverity(input)).toBe(out)
  })
  it.each([0, 6, 2.5, "", "awful-ish", null, undefined, {}])("%s → null", (input) => {
    expect(parseSeverity(input)).toBeNull()
  })
})

describe("resolveDraftDate", () => {
  const today = "2026-10-17" // a Saturday
  it.each([
    ["today", "2026-10-17"], ["Today", "2026-10-17"], ["yesterday", "2026-10-16"],
    ["2026-10-01", "2026-10-01"], ["saturday", "2026-10-17"], ["last saturday", "2026-10-10"],
    ["monday", "2026-10-12"], ["Last Monday", "2026-10-12"],
  ])("%s → %s", (input, date) => {
    expect(resolveDraftDate(input, today)).toEqual({ date })
  })
  it("returns an error instead of throwing when today itself is malformed", () => {
    for (const bad of ["garbage", "", "Oct 17", "2026-02-30"]) {
      expect(() => resolveDraftDate("today", bad)).not.toThrow()
      expect(resolveDraftDate("today", bad)).toMatchObject({ error: expect.any(String) })
    }
  })
  it("rejects the future, dates over a year back and nonsense", () => {
    expect(resolveDraftDate("2026-10-18", today)).toMatchObject({ error: expect.stringMatching(/future/) })
    expect(resolveDraftDate("2025-10-16", today)).toMatchObject({ error: expect.stringMatching(/year/) })
    expect(resolveDraftDate("2026-02-30", today)).toMatchObject({ error: expect.any(String) })
    expect(resolveDraftDate("soonish", today)).toMatchObject({ error: expect.any(String) })
  })
})

describe("matchExistingType", () => {
  it("reuses the person's spelling when it is the same type", () => {
    expect(matchExistingType("  aggression ", ["Meltdown", "Aggression"])).toBe("Aggression")
    expect(matchExistingType("bad  night", ["Bad night"])).toBe("Bad night")
  })
  it("keeps a new type, trimmed", () => {
    expect(matchExistingType(" Hitting ", ["Meltdown"])).toBe("Hitting")
  })
})

describe("toFormValues", () => {
  it("gives the strings createObservation expects and tags an estimate", () => {
    expect(toFormValues(draft)).toEqual({
      date: "2026-10-17", time: "15:30", type: "Aggression", severity: "4", durationMinutes: "20",
      conditionId: "", tags: "school, severity-estimated", notes: "Hit her brother after school",
    })
  })
  it("never tags a stated severity, and blanks empty fields", () => {
    const v = toFormValues({ ...draft, severitySource: "stated", tags: ["Severity-Estimated"], time: null, durationMinutes: null, notes: null })
    expect(v).toMatchObject({ time: "", durationMinutes: "", notes: "", tags: "" })
  })
})

describe("draftSummaryLine", () => {
  it("states id, state and every value", () => {
    expect(draftSummaryLine({ draft, state: "draft" })).toBe(
      '[observation draft obs-abc123, not saved: Avery · 2026-10-17 15:30 · Aggression · severityEstimate 4 · 20 min · tags school · "Hit her brother after school"]'
    )
  })
  it("marks saved and discarded cards as final", () => {
    expect(draftSummaryLine({ draft, state: "saved", savedId: "o1" })).toContain("saved as entry o1")
    expect(draftSummaryLine({ draft, state: "discarded" })).toContain("discarded")
  })
  it("names the saved entry so a change can target it", () => {
    expect(draftSummaryLine({ draft, state: "saved", savedId: "o42" })).toContain("saved as entry o42; to change it, call propose_observation_edit with observationId o42")
  })
  it("keeps notes, type, tags and name on one line", () => {
    const line = draftSummaryLine({ draft: { ...draft, personName: "In\ndy", type: "A\tB", tags: ["x\ny"], notes: "One.\n\nTwo\tthree" }, state: "draft" })
    expect(line).not.toMatch(/[\n\r\t]/)
    expect(line).toContain('"One. Two three"')
  })
  it("keeps a draft card's long notes whole so a revision can resend them", () => {
    const notes = "x".repeat(500)
    expect(draftSummaryLine({ draft: { ...draft, notes }, state: "draft" })).toContain(`"${notes}"`)
  })
  it("truncates long notes on saved and discarded cards", () => {
    for (const state of ["saved", "discarded"] as const) {
      const line = draftSummaryLine({ draft: { ...draft, notes: "x".repeat(500) }, state })
      expect(line.length).toBeLessThan(400)
    }
  })
  it("names the argument to reuse: severity for stated, severityEstimate for estimated", () => {
    expect(draftSummaryLine({ draft: { ...draft, severity: 4, severitySource: "stated" }, state: "draft" })).toContain("· severity 4 ·")
    expect(draftSummaryLine({ draft: { ...draft, severity: 3, severitySource: "estimated" }, state: "draft" })).toContain("· severityEstimate 3 ·")
  })
})

describe("isDraftCard", () => {
  const card: DraftCard = { draft, state: "draft" }
  it("accepts a well-formed card and rejects junk", () => {
    expect(isDraftCard(card)).toBe(true)
    expect(isDraftCard({ ...card, state: "weird" })).toBe(false)
    expect(isDraftCard({ ...card, draft: { ...draft, severity: 9 } })).toBe(false)
    expect(isDraftCard({ ...card, draft: { ...draft, severity: "4" } })).toBe(false)
    expect(isDraftCard({ ...card, draft: { ...draft, severity: "mild" } })).toBe(false)
    expect(isDraftCard({ state: "draft" })).toBe(false)
    expect(isDraftCard(null)).toBe(false)
  })
})

describe("labels", () => {
  it("names a severity and a local day", () => {
    expect(severityLabel(3)).toBe("3 / 5 · Moderate")
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05")
  })
})
