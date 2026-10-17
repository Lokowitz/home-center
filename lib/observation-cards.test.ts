import { describe, expect, it } from "vitest"
import {
  cardId, cardSubject, cardSummaryLine, changedFields, formatValue, isChatCard, valuesToForm,
  type DeleteCard, type EditCard, type ObservationValues,
} from "./observation-cards"
import type { DraftCard } from "./observation-draft"

const before: ObservationValues = {
  date: "2026-10-14", time: null, type: "Meltdown", severity: 3, durationMinutes: 15,
  notes: "At bedtime", tags: ["bedtime", "severity-estimated"], conditionId: "c1",
}
const target = { observationId: "o1", updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Avery", attachments: 0, before }
const edit: EditCard = { kind: "edit", id: "chg-aaaaaa", target, after: { ...before, severity: 4, tags: ["bedtime"] }, state: "draft" }
const del: DeleteCard = { kind: "delete", id: "chg-bbbbbb", target, state: "draft" }
const add: DraftCard = {
  draft: { draftId: "obs-cccccc", personId: "p1", personName: "Avery", date: "2026-10-17", time: null, type: "Aggression", severity: 4, severitySource: "estimated", durationMinutes: null, notes: null, tags: [] },
  state: "draft",
}

describe("ids and subjects", () => {
  it("names every kind of card", () => {
    expect([add, edit, del].map(cardId)).toEqual(["obs-cccccc", "chg-aaaaaa", "chg-bbbbbb"])
    expect([add, edit, del].map(cardSubject)).toEqual(["person:p1", "entry:o1:edit", "entry:o1:delete"])
  })
})

describe("changedFields", () => {
  it("lists only what differs, tags by value", () => {
    expect(changedFields(before, edit.after)).toEqual(["severity", "tags"])
    expect(changedFields(before, { ...before, tags: ["bedtime", "severity-estimated"] })).toEqual([])
  })
  it("handles an entry without severity", () => {
    const none = { ...before, severity: null }
    expect(changedFields(none, none)).toEqual([])
    expect(formatValue("severity", none)).toBe("—")
  })
})

describe("formatValue", () => {
  it("reads like the card", () => {
    expect(formatValue("severity", before)).toBe("3 / 5 · Moderate")
    expect(formatValue("durationMinutes", before)).toBe("15 min")
    expect(formatValue("time", before)).toBe("—")
    expect(formatValue("tags", before)).toBe("bedtime, severity-estimated")
  })
})

describe("valuesToForm", () => {
  it("gives the strings the observation schema takes, keeping the condition", () => {
    expect(valuesToForm({ ...before, severity: null, durationMinutes: null, notes: null })).toEqual({
      date: "2026-10-14", time: "", type: "Meltdown", severity: "", durationMinutes: "", conditionId: "c1",
      tags: "bedtime, severity-estimated", notes: "",
    })
  })
})

describe("summary lines", () => {
  it("describes an edit by entry and change", () => {
    expect(cardSummaryLine(edit)).toBe(
      "[observation edit chg-aaaaaa, not applied: Avery · entry o1 (2026-10-14 Meltdown) · severity 3 → 4 · tags bedtime, severity-estimated → bedtime]"
    )
    expect(cardSummaryLine({ ...edit, state: "saved" })).toContain("applied; to change this entry again, call propose_observation_edit with observationId o1 and no proposalId")
  })
  it("keeps notes, type, tags and names on one line", () => {
    const messy = { ...before, type: "Melt\ndown", tags: ["a\tb", "c\nd"], notes: "At bedtime.\n\nScreamed\tfor 20 min" }
    const line = cardSummaryLine({ ...edit, target: { ...target, personName: "In\ndy", before: messy }, after: { ...messy, notes: "New\r\nnote" } })
    expect(line).not.toMatch(/[\n\r\t]/)
    expect(line).toContain('"At bedtime. Screamed for 20 min"')
  })
  it("describes a delete", () => {
    expect(cardSummaryLine(del)).toBe("[observation delete chg-bbbbbb, not deleted: Avery · entry o1 (2026-10-14 Meltdown)]")
    expect(cardSummaryLine({ ...del, state: "saved" })).toContain("deleted")
  })
  it("still describes adds", () => {
    expect(cardSummaryLine(add)).toMatch(/^\[observation draft obs-cccccc, not saved:/)
  })
})

describe("isChatCard", () => {
  it("accepts every kind, including stored adds without a kind", () => {
    expect([add, edit, del].every(isChatCard)).toBe(true)
  })
  it("rejects malformed change cards", () => {
    expect(isChatCard({ ...edit, target: { ...target, updatedAt: 5 } })).toBe(false)
    expect(isChatCard({ ...edit, after: { ...edit.after, severity: "4" } })).toBe(false)
    expect(isChatCard({ ...del, kind: "rename" })).toBe(false)
    expect(isChatCard(null)).toBe(false)
  })
})
