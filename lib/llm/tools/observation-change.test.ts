import { describe, expect, it, vi } from "vitest"

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { observation: { findUnique, findMany: async () => [{ type: "Meltdown" }] } } }))
import { buildDelete, buildEdit, proposeDeleteTool, proposeEditTool, type ChangeDeps } from "./observation-change"
import type { EntryRef } from "@/lib/observation-cards"

const entry: EntryRef = {
  observationId: "o1", updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Avery", attachments: 1,
  before: { date: "2026-10-14", time: null, type: "Meltdown", severity: 3, durationMinutes: 15, notes: "At bedtime", tags: ["severity-estimated"], conditionId: null },
}
const deps = (over: Partial<ChangeDeps> = {}): ChangeDeps => ({
  loadEntry: async (id) => (id === "o1" ? entry : null),
  knownTypes: async () => ["Meltdown", "Aggression"],
  today: "2026-10-17",
  newId: () => "chg-new001",
  ...over,
})

describe("buildEdit", () => {
  it("changes only what was asked; a stated severity drops the estimate tag", async () => {
    const out = await buildEdit({ observationId: "o1", severity: "4" }, deps())
    expect(out).toMatchObject({ card: { kind: "edit", id: "chg-new001", target: entry, state: "draft", after: { ...entry.before, severity: 4, tags: [] } } })
  })
  it("keeps untouched severity, including none", async () => {
    const none = { ...entry, before: { ...entry.before, severity: null, tags: [] } }
    const out = await buildEdit({ observationId: "o1", date: "yesterday" }, deps({ loadEntry: async () => none }))
    expect(out).toMatchObject({ card: { after: { date: "2026-10-16", severity: null } } })
  })
  it("clears fields on request and reuses the person's type spelling", async () => {
    const out = await buildEdit({ observationId: "o1", type: "aggression", clear: ["durationMinutes", "notes"] }, deps())
    expect(out).toMatchObject({ card: { after: { type: "Aggression", durationMinutes: null, notes: null } } })
  })
  it("keeps the proposal id on a revision", async () => {
    expect(await buildEdit({ observationId: "o1", severity: 2, proposalId: "chg-abc123" }, deps())).toMatchObject({ card: { id: "chg-abc123" } })
  })
  it("ignores a proposal id that is not one of ours", async () => {
    expect(await buildEdit({ observationId: "o1", severity: 2, proposalId: "chg-abc123-2" }, deps())).toMatchObject({ card: { id: "chg-abc123-2" } })
    expect(await buildEdit({ observationId: "o1", severity: 2, proposalId: "obs-abc123" }, deps())).toMatchObject({ card: { id: "chg-new001" } })
    expect(await buildEdit({ observationId: "o1", severity: 2, proposalId: "chg-ab\n]" }, deps())).toMatchObject({ card: { id: "chg-new001" } })
  })
  it("refuses unknown entries, no-op edits, bad values and future dates", async () => {
    expect(await buildEdit({ observationId: "nope", severity: 4 }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/observation_log/) } })
    expect(await buildEdit({ observationId: "o1", severity: 3 }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/Nothing would change/) } })
    expect(await buildEdit({ observationId: "o1", time: "25:99" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/wouldn't save/) } })
    expect(await buildEdit({ observationId: "o1", date: "2026-10-20" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/future/) } })
    expect(await buildEdit({ observationId: "o1", severity: "kinda" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/isn't a severity/) } })
  })
})

describe("buildDelete", () => {
  it("uses a well-formed proposal id and ignores any other", async () => {
    expect(await buildDelete({ observationId: "o1", proposalId: "chg-abc123" }, deps())).toMatchObject({ card: { id: "chg-abc123" } })
    expect(await buildDelete({ observationId: "o1", proposalId: "o1" }, deps())).toMatchObject({ card: { id: "chg-new001" } })
  })
  it("proposes deleting a known entry", async () => {
    expect(await buildDelete({ observationId: "o1" }, deps())).toEqual({ card: { kind: "delete", id: "chg-new001", target: entry, state: "draft" } })
    expect(await buildDelete({ observationId: "nope" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/observation_log/) } })
  })
})

describe("tools", () => {
  const row = {
    id: "o1", updatedAt: new Date("2026-10-15T10:00:00.000Z"), date: new Date("2026-10-14T00:00:00Z"), time: null, type: "Meltdown",
    severity: 3, durationMinutes: 15, notes: "At bedtime", tags: "severity-estimated", conditionId: null,
    personId: "p1", person: { name: "Avery" }, _count: { attachments: 1 },
  }
  const ctx = (emit = vi.fn()) => ({ userId: "u", now: new Date("2026-10-17T12:00:00Z"), today: "2026-10-17", emit })

  it("emit one change event and say nothing was changed", async () => {
    findUnique.mockResolvedValue(row)
    const emit = vi.fn()
    const out = await proposeEditTool.execute({ observationId: "o1", severity: 4 }, ctx(emit))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toMatchObject({ type: "change", card: { kind: "edit", target: { observationId: "o1", attachments: 1 } } })
    expect(out).toMatch(/NOT applied/)
    const emit2 = vi.fn()
    await proposeDeleteTool.execute({ observationId: "o1" }, ctx(emit2))
    expect(emit2.mock.calls[0][0]).toMatchObject({ type: "change", card: { kind: "delete" } })
  })
  it("emit nothing for an unknown entry", async () => {
    findUnique.mockResolvedValue(null)
    const emit = vi.fn()
    expect(await proposeDeleteTool.execute({ observationId: "x" }, ctx(emit))).toMatch(/observation_log/)
    expect(emit).not.toHaveBeenCalled()
  })
  it("refuse with Health off", async () => {
    const off = { userId: "u", now: new Date(), health: false }
    expect(await proposeEditTool.execute({ observationId: "o1", severity: 4 }, off)).toMatch(/Health is turned off/)
    expect(await proposeDeleteTool.execute({ observationId: "o1" }, off)).toMatch(/Health is turned off/)
  })
})
