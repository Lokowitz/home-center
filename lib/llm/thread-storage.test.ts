import { describe, expect, it } from "vitest"
import { CARD_LOCKED_TEXT, CARD_ONLY_TEXT, CARD_REVISED_TEXT, clearThread, loadThread, mergeCards, requestMessages, saveThread, SEND_LIMIT, shouldPersist, threadKey, updateCard } from "./thread-storage"
import type { HistoryMessage } from "./types"
import { draftSummaryLine, type DraftCard, type ObservationDraft } from "../observation-draft"
import type { EditCard } from "../observation-cards"
import { MAX_MESSAGE_CHARS } from "./request-schema"

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
    removeItem: (k: string) => {
      delete data[k]
    },
  }
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError")
  },
  setItem: () => {
    throw new Error("QuotaExceeded")
  },
  removeItem: () => {
    throw new Error("SecurityError")
  },
}

describe("thread storage", () => {
  it("round-trips per user", () => {
    const s = memory()
    const thread: HistoryMessage[] = [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }]
    saveThread(s, "u1", thread)
    expect(loadThread(s, "u1")).toEqual(thread)
    expect(loadThread(s, "u2")).toEqual([])
    clearThread(s, "u1")
    expect(loadThread(s, "u1")).toEqual([])
  })

  it("keeps a replaced first answer for display but never sends it", () => {
    const s = memory()
    saveThread(s, "u1", [
      { role: "user", content: "vin?" },
      { role: "assistant", content: "VIN is Y", discarded: "VIN is X [T](/assets/vehicles/fake)" },
    ])
    const loaded = loadThread(s, "u1")
    expect(loaded[1]).toEqual({ role: "assistant", content: "VIN is Y", discarded: "VIN is X [T](/assets/vehicles/fake)" })
    expect(requestMessages(loaded)).toEqual([{ role: "user", content: "vin?" }, { role: "assistant", content: "VIN is Y" }])
  })

  it("drops malformed data and junk entries", () => {
    expect(loadThread(memory({ [threadKey("u1")]: "{nope" }), "u1")).toEqual([])
    expect(loadThread(memory({ [threadKey("u1")]: '{"a":1}' }), "u1")).toEqual([])
    const mixed = JSON.stringify([
      { role: "user", content: "ok" },
      { role: "system", content: "evil" },
      { role: "assistant", content: "" },
      { role: "assistant", content: 5 },
      null,
      { role: "assistant", content: "fine", extra: true },
    ])
    expect(loadThread(memory({ [threadKey("u1")]: mixed }), "u1")).toEqual([
      { role: "user", content: "ok" },
      { role: "assistant", content: "fine" },
    ])
  })

  it("survives unavailable storage", () => {
    expect(loadThread(throwing, "u1")).toEqual([])
    expect(() => saveThread(throwing, "u1", [])).not.toThrow()
    expect(() => clearThread(throwing, "u1")).not.toThrow()
    expect(loadThread(null, "u1")).toEqual([])
  })
})

describe("requestMessages", () => {
  it("sends the last 20, starting at a user message, each capped", () => {
    const thread: HistoryMessage[] = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: i === 59 ? "x".repeat(9000) : `m${i}`,
    }))
    thread.push({ role: "user", content: "last" })
    const out = requestMessages(thread)
    expect(out.length).toBeLessThanOrEqual(SEND_LIMIT)
    expect(out[0].role).toBe("user")
    expect(out.at(-1)).toEqual({ role: "user", content: "last" })
    expect(out.every((m) => m.content.length <= 8000)).toBe(true)
  })
})

describe("requestMessages limits", () => {
  it("keeps the total within 64,000 chars, starting on a user and ending on the last user message", () => {
    const thread: HistoryMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${i}`.padEnd(7000, "x"),
    }))
    thread.push({ role: "user", content: "last" })
    const out = requestMessages(thread)
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(64000)
    expect(out[0].role).toBe("user")
    expect(out.at(-1)).toEqual({ role: "user", content: "last" })
  })

  it("merges adjacent same-role messages so roles alternate", () => {
    const out = requestMessages([
      { role: "user", content: "first try" },
      { role: "user", content: "again" },
      { role: "assistant", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "q" },
    ])
    expect(out).toEqual([
      { role: "user", content: "first try\n\nagain" },
      { role: "assistant", content: "a\n\nb" },
      { role: "user", content: "q" },
    ])
  })
})

describe("shouldPersist", () => {
  it("only persists a turn from the current thread generation", () => {
    expect(shouldPersist(3, 3)).toBe(true)
    expect(shouldPersist(3, 4)).toBe(false)
  })
})

const d = (id: string, over: Partial<ObservationDraft> = {}): ObservationDraft => ({
  draftId: id, personId: "p1", personName: "Avery", date: "2026-10-17", time: null, type: "Aggression",
  severity: 3, severitySource: "estimated", durationMinutes: null, notes: null, tags: [], ...over,
})
const card = (id: string, over: Partial<DraftCard> = {}): DraftCard => ({ draft: d(id), state: "draft", ...over })

describe("draft cards", () => {
  const q = { role: "user" as const, content: "Avery hit her brother" }
  const a1 = { role: "assistant" as const, content: "Drafted it.", cards: [card("obs-aaaaaa")] }

  it("attach new cards to the answer, and keep a card-only answer", () => {
    const t = mergeCards([q], { role: "assistant", content: "" }, [card("obs-aaaaaa")])
    expect(t).toEqual([q, { role: "assistant", content: CARD_ONLY_TEXT, cards: [card("obs-aaaaaa")] }])
  })
  it("revise an earlier unsaved card in place instead of adding one", () => {
    const revised = { draft: d("obs-aaaaaa", { severity: 4, severitySource: "stated" }), state: "draft" as const }
    const t = mergeCards([q, a1, { role: "user", content: "make it a 4" }], { role: "assistant", content: "Changed." }, [revised])
    expect(t[1].cards).toEqual([revised])
    expect(t[3]).toEqual({ role: "assistant", content: "Changed." })
  })
  it("never revise a saved or discarded card", () => {
    const saved = { ...a1, cards: [card("obs-aaaaaa", { state: "saved", savedId: "o1" })] }
    const t = mergeCards([q, saved], { role: "assistant", content: "ok" }, [card("obs-aaaaaa", { draft: d("obs-aaaaaa", { severity: 5 }) })])
    expect(t[1].cards![0]).toMatchObject({ state: "saved", draft: { severity: 3 } })
    expect(t[2].cards).toBeUndefined()
  })
  it("updates a card's state by id", () => {
    const t = updateCard([q, a1], "obs-aaaaaa", { state: "saved", savedId: "o9" })
    expect(t[1].cards![0]).toMatchObject({ state: "saved", savedId: "o9" })
  })
  it("round-trips cards through storage and drops malformed ones", () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    saveThread(s, "u", [q, { ...a1, cards: [card("obs-aaaaaa"), { junk: true } as unknown as DraftCard] }])
    expect(loadThread(s, "u")[1].cards).toEqual([card("obs-aaaaaa")])
  })
  it("sends each card's summary with its message", () => {
    const sent = requestMessages([q, a1])
    expect(sent[1].content).toBe("Drafted it.\n\n[observation draft obs-aaaaaa, not saved: Avery · 2026-10-17 · Aggression · severityEstimate 3]")
  })
})

describe("draft card fixes", () => {
  const q = { role: "user" as const, content: "Avery hit her brother" }

  it("keeps one card when the same draft id appears twice in one answer, the last one winning", () => {
    const t = mergeCards([q], { role: "assistant", content: "Drafted" }, [card("obs-aaaaaa"), { draft: d("obs-aaaaaa", { severity: 5 }), state: "draft" }])
    expect(t[1].cards).toHaveLength(1)
    expect((t[1].cards![0] as DraftCard).draft.severity).toBe(5)
  })

  it("keeps the card summary when the answer is longer than the message cap", () => {
    const thread = [q, { role: "assistant" as const, content: "x".repeat(MAX_MESSAGE_CHARS), cards: [card("obs-aaaaaa")] }]
    const sent = requestMessages(thread)[1].content
    expect(sent.endsWith("[observation draft obs-aaaaaa, not saved: Avery · 2026-10-17 · Aggression · severityEstimate 3]")).toBe(true)
    expect(sent.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
  })

  it("says the draft was updated, not drafted, when an empty answer only revises a card", () => {
    const a1 = { role: "assistant" as const, content: "Drafted it.", cards: [card("obs-aaaaaa")] }
    const revised = { draft: d("obs-aaaaaa", { severity: 4 }), state: "draft" as const }
    const t = mergeCards([q, a1], { role: "assistant", content: "" }, [revised])
    expect(t[2]).toEqual({ role: "assistant", content: CARD_REVISED_TEXT })
  })
})

describe("draft card round 2", () => {
  const q = { role: "user" as const, content: "Avery hit her brother" }

  it("keeps both summaries when adjacent assistant messages with cards merge", () => {
    const a = { role: "assistant" as const, content: "x".repeat(7990), cards: [card("obs-aaaaaa")] }
    const b = { role: "assistant" as const, content: "y".repeat(7990), cards: [card("obs-bbbbbb")] }
    const sent = requestMessages([q, a, b, { role: "user", content: "ok" }])
    expect(sent[1].role).toBe("assistant")
    expect(sent[1].content.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    expect(sent[1].content).toContain("[observation draft obs-aaaaaa,")
    expect(sent[1].content).toContain("[observation draft obs-bbbbbb,")
  })

  it("keeps the newest summaries when they alone exceed the cap", () => {
    const cards = Array.from({ length: 60 }, (_, i) => card(`obs-${String(i).padStart(6, "0")}`, { draft: d(`obs-${String(i).padStart(6, "0")}`, { notes: "n".repeat(190) }) }))
    const sent = requestMessages([q, { role: "assistant", content: "Many.", cards }])[1].content
    expect(sent.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    expect(sent.endsWith(draftSummaryLine(cards[59]))).toBe(true)
  })

  it("says the draft is locked when the only card targets a saved card", () => {
    const saved = { role: "assistant" as const, content: "Saved it.", cards: [card("obs-aaaaaa", { state: "saved", savedId: "o1" })] }
    const t = mergeCards([q, saved], { role: "assistant", content: "" }, [card("obs-aaaaaa", { draft: d("obs-aaaaaa", { severity: 5 }) })])
    expect(t[2]).toEqual({ role: "assistant", content: CARD_LOCKED_TEXT })
    expect(t[1].cards![0]).toMatchObject({ state: "saved", draft: { severity: 3 } })
  })
})

describe("draft card review fixes", () => {
  const q = { role: "user" as const, content: "Avery hit her brother" }
  it("treats a reused id for another person as a new card, not a revision", () => {
    const a1 = { role: "assistant" as const, content: "Drafted it.", cards: [card("obs-aaaaaa")] }
    const other = { draft: d("obs-aaaaaa", { personId: "p2", personName: "Sam" }), state: "draft" as const }
    const t = mergeCards([q, a1], { role: "assistant", content: "Drafted Sam's." }, [other])
    expect(t[1].cards).toEqual([card("obs-aaaaaa")])
    expect(t[2].cards).toEqual([{ ...other, draft: { ...other.draft, draftId: "obs-aaaaaa-2" } }])
  })
})

const editCard = (id: string, observationId = "o1", over: Partial<EditCard> = {}): EditCard => ({
  kind: "edit", id, state: "draft",
  target: { observationId, updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Avery", attachments: 0,
    before: { date: "2026-10-14", time: null, type: "Meltdown", severity: 3, durationMinutes: null, notes: null, tags: [], conditionId: null } },
  after: { date: "2026-10-14", time: null, type: "Meltdown", severity: 4, durationMinutes: null, notes: null, tags: [], conditionId: null },
  ...over,
})

describe("change cards", () => {
  const q2 = { role: "user" as const, content: "make the meltdown a 4" }
  it("store, revise in place and update by id", () => {
    const t1 = mergeCards([q2], { role: "assistant", content: "Proposed." }, [editCard("chg-aaaaaa")])
    expect(t1[1].cards).toEqual([editCard("chg-aaaaaa")])
    const revised = editCard("chg-aaaaaa", "o1", { after: { ...editCard("x").after, severity: 5 } })
    const t2 = mergeCards([...t1, { role: "user", content: "no, 5" }], { role: "assistant", content: "Changed." }, [revised])
    expect(t2[1].cards).toEqual([revised])
    expect(updateCard(t2, "chg-aaaaaa", { state: "saved" })[1].cards![0]).toMatchObject({ state: "saved" })
  })
  it("treat a reused id for another entry as a new card", () => {
    const t1 = mergeCards([q2], { role: "assistant", content: "Proposed." }, [editCard("chg-aaaaaa", "o1")])
    const t2 = mergeCards([...t1, { role: "user", content: "and the other" }], { role: "assistant", content: "Also." }, [editCard("chg-aaaaaa", "o2")])
    expect(t2[1].cards![0]).toMatchObject({ kind: "edit" })
    expect((t2[3].cards![0] as EditCard).target.observationId).toBe("o2")
  })
  it("gives a reused id for another entry a unique id", () => {
    const t1 = mergeCards([q2], { role: "assistant", content: "Proposed." }, [editCard("chg-aaaaaa", "o1")])
    const t2 = mergeCards([...t1, { role: "user", content: "and the other" }], { role: "assistant", content: "Also." }, [editCard("chg-aaaaaa", "o2")])
    expect(t2[1].cards![0]).toMatchObject({ id: "chg-aaaaaa" })
    expect(t2[3].cards![0]).toMatchObject({ id: "chg-aaaaaa-2", target: { observationId: "o2" } })
    const t3 = mergeCards([...t2, { role: "user", content: "and a third" }], { role: "assistant", content: "Also." }, [editCard("chg-aaaaaa", "o3")])
    expect(t3[5].cards![0]).toMatchObject({ id: "chg-aaaaaa-3" })
  })
  it("revising an applied edit makes a new draft card and leaves the applied one", () => {
    const t1 = mergeCards([q2], { role: "assistant", content: "Proposed." }, [editCard("chg-aaaaaa")])
    const applied = updateCard(t1, "chg-aaaaaa", { state: "saved" })
    const t2 = mergeCards([...applied, { role: "user", content: "make it 5" }], { role: "assistant", content: "Again." }, [editCard("chg-aaaaaa")])
    expect(t2[1].cards).toEqual([editCard("chg-aaaaaa", "o1", { state: "saved" })])
    expect(t2[3].cards).toEqual([editCard("chg-aaaaaa-2")])
  })
  it("updates only the later of two cards that share an id", () => {
    const t = updateCard(
      [q2, { role: "assistant", content: "a", cards: [editCard("chg-aaaaaa")] }, { role: "user", content: "b" }, { role: "assistant", content: "c", cards: [editCard("chg-aaaaaa")] }],
      "chg-aaaaaa", { state: "saved" },
    )
    expect(t[1].cards![0]).toMatchObject({ state: "draft" })
    expect(t[3].cards![0]).toMatchObject({ state: "saved" })
  })
  it("round-trip mixed cards and send their summaries", () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    saveThread(s, "u", [q2, { role: "assistant", content: "Two cards.", cards: [card("obs-aaaaaa"), editCard("chg-bbbbbb")] }])
    const loaded = loadThread(s, "u")
    expect(loaded[1].cards).toHaveLength(2)
    expect(requestMessages(loaded)[1].content).toContain("[observation edit chg-bbbbbb, not applied:")
  })
})
