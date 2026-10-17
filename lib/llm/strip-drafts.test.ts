import { describe, expect, it } from "vitest"
import { stripDraftLines } from "./strip-drafts"
import { cardSummaryLine, type EditCard } from "../observation-cards"

describe("stripDraftLines", () => {
  it("removes observation draft lines and drops messages left empty", () => {
    const line = '[observation draft obs-aaaaaa, not saved: Avery · 2026-10-17 · Aggression · severity 3 · "hi"]'
    const out = stripDraftLines([
      { role: "user", content: "Avery hit her brother" },
      { role: "assistant", content: `Drafted it.\n\n${line}` },
      { role: "assistant", content: line },
      { role: "user", content: "what else?" },
    ])
    expect(out).toEqual([
      { role: "user", content: "Avery hit her brother" },
      { role: "assistant", content: "Drafted it." },
      { role: "user", content: "what else?" },
    ])
  })
  it("keeps the last user message even if it was only a draft line", () => {
    const out = stripDraftLines([{ role: "user", content: "[observation draft obs-aaaaaa, saved: x]" }])
    expect(out).toHaveLength(1)
  })
  it("strips an edit line whose notes had line breaks", () => {
    const before = { date: "2026-10-14", time: null, type: "Meltdown", severity: 3 as const, durationMinutes: null, notes: "At bedtime.\n\nScreamed\tfor 20 min", tags: [], conditionId: null }
    const card: EditCard = {
      kind: "edit", id: "chg-aaaaaa", state: "draft", after: { ...before, notes: "Calmer.\nLater" },
      target: { observationId: "o1", updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Avery", attachments: 0, before },
    }
    const out = stripDraftLines([
      { role: "user", content: "hi" },
      { role: "assistant", content: `Ok.\n\n${cardSummaryLine(card)}` },
      { role: "user", content: "thanks" },
    ])
    expect(out[1].content).toBe("Ok.")
  })
  it("keeps ordinary bracketed text", () => {
    const out = stripDraftLines([{ role: "user", content: "hi" }, { role: "assistant", content: "[note] hello" }, { role: "user", content: "ok" }])
    expect(out[1].content).toBe("[note] hello")
  })
  it("also strips edit and delete lines", () => {
    const out = stripDraftLines([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Ok.\n\n[observation edit chg-a, not applied: Avery · entry o1 (2026-10-14 Meltdown) · severity 3 → 4]\n[observation delete chg-b, not deleted: Avery · entry o2 (2026-10-13 Rude)]" },
      { role: "user", content: "thanks" },
    ])
    expect(out[1].content).toBe("Ok.")
  })
})
