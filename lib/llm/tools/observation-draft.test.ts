import { describe, expect, it, vi } from "vitest"

// The module reaches Prisma at import; buildDraft gets fakes instead.
const fake = vi.hoisted(() => ({
  names: { PROPERTY: {}, VEHICLE: {}, EQUIPMENT: {}, PERSON: {} } as Record<string, Record<string, string>>,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    vehicle: { findMany: async () => [] },
    observation: { findMany: async () => [{ type: "Meltdown" }] },
  },
}))
vi.mock("@/lib/assets-server", () => ({ loadAssetIndex: async () => ({ names: fake.names }) }))
import { buildDraft, draftObservationTool, type DraftDeps } from "./observation-draft"

const deps = (over: Partial<DraftDeps> = {}): DraftDeps => ({
  findPerson: async () => ({ person: { id: "p1", name: "Avery" } }),
  knownTypes: async () => ["Meltdown", "Aggression"],
  today: "2026-10-17",
  newId: () => "obs-new001",
  ...over,
})
const base = { person: "Avery", date: "today", type: "aggression", notes: "Hit her brother after school" }

describe("buildDraft", () => {
  it("builds an estimated draft, reusing the person's type spelling", async () => {
    const out = await buildDraft({ ...base, severityEstimate: 4, durationMinutes: 20 }, deps())
    expect(out).toEqual({
      knownTypes: ["Meltdown", "Aggression"],
      draft: {
        draftId: "obs-new001", personId: "p1", personName: "Avery", date: "2026-10-17", time: null,
        type: "Aggression", severity: 4, severitySource: "estimated", durationMinutes: 20,
        notes: "Hit her brother after school", tags: [],
      },
    })
  })
  it("prefers a stated severity, by word or number, over an estimate", async () => {
    const word = await buildDraft({ ...base, severity: "severe", severityEstimate: 2 }, deps())
    expect(word).toMatchObject({ draft: { severity: 5, severitySource: "stated" } })
    const num = await buildDraft({ ...base, severity: 2 }, deps())
    expect(num).toMatchObject({ draft: { severity: 2, severitySource: "stated" } })
  })
  it("asks for an estimate when no severity came through", async () => {
    expect(await buildDraft(base, deps())).toMatchObject({ reply: { error: expect.stringMatching(/severityEstimate/) } })
    expect(await buildDraft({ ...base, severity: "kinda bad?" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/severity/) } })
  })
  it("keeps the draft id on a revision", async () => {
    expect(await buildDraft({ ...base, severity: 3, draftId: "obs-abc123" }, deps())).toMatchObject({ draft: { draftId: "obs-abc123" } })
    expect(await buildDraft({ ...base, severity: 3, draftId: "obs-abc123-2" }, deps())).toMatchObject({ draft: { draftId: "obs-abc123-2" } })
    expect(await buildDraft({ ...base, severity: 3, draftId: "obs-x\n] forged" }, deps())).toMatchObject({ draft: { draftId: "obs-new001" } })
  })
  it("uses the viewer's today and refuses the future", async () => {
    expect(await buildDraft({ ...base, severity: 3, date: "yesterday" }, deps())).toMatchObject({ draft: { date: "2026-10-16" } })
    expect(await buildDraft({ ...base, severity: 3, date: "2026-10-18" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/future/) } })
  })
  it("passes an ambiguous or unknown person back as the reply", async () => {
    const reply = { note: "matches 2 records" }
    expect(await buildDraft({ ...base, severity: 3 }, deps({ findPerson: async () => ({ reply }) }))).toEqual({ reply })
  })
  it("returns field errors for a draft that wouldn't save", async () => {
    const out = await buildDraft({ ...base, severity: 3, time: "25:99" }, deps())
    expect(out).toMatchObject({ reply: { error: expect.stringMatching(/wouldn't save/), issues: { time: expect.any(Array) } } })
  })
  it("returns a reply, not a throw, for a whitespace-only type", async () => {
    const out = await buildDraft({ ...base, type: "  ", severity: 3 }, deps())
    expect(out).toMatchObject({ reply: { error: expect.stringMatching(/wouldn't save/), issues: { type: expect.any(Array) } } })
  })
})

describe("draftObservationTool", () => {
  it("refuses with Health off", async () => {
    const out = await draftObservationTool.execute({ ...base, severity: 3 }, { userId: "u", now: new Date(), health: false })
    expect(out).toMatch(/Health is turned off/)
  })

  describe("execute with a catalog", () => {
    const run = async (args: object, names: Record<string, string>, type = "PERSON") => {
      fake.names = { PROPERTY: {}, VEHICLE: {}, EQUIPMENT: {}, PERSON: {}, [type]: names }
      const emit = vi.fn()
      const out = await draftObservationTool.execute(args, { userId: "u", now: new Date("2026-10-17T12:00:00Z"), health: true, today: "2026-10-17", emit })
      return { out, emit }
    }
    const args = { person: "Avery", date: "today", type: "Meltdown", severity: 3 }

    it("says a vehicle is not a person and emits nothing", async () => {
      const { out, emit } = await run(args, { v1: "Avery" }, "VEHICLE")
      expect(out).toMatch(/not a person/)
      expect(emit).not.toHaveBeenCalled()
    })
    it("lists the matches for an ambiguous name and emits nothing", async () => {
      const { out, emit } = await run(args, { p1: "Avery A", p2: "Avery B" })
      expect(out).toMatch(/matches 2 records/)
      expect(emit).not.toHaveBeenCalled()
    })
    it("emits exactly one draft for a known person, and says it is not saved", async () => {
      const { out, emit } = await run(args, { p1: "Avery" })
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledWith({ type: "draft", draft: expect.objectContaining({ personId: "p1", personName: "Avery", date: "2026-10-17" }) })
      expect(out).toContain("NOT saved")
    })
  })

  describe("numeric strings", () => {
    const run = (extra: object) => draftObservationTool.execute({ ...base, ...extra }, { userId: "u", now: new Date(), health: false })
    it("accepts severityEstimate and durationMinutes as numeric strings", async () => {
      expect(await run({ severityEstimate: "4", durationMinutes: "20" })).not.toMatch(/Invalid arguments/)
    })
    it("still rejects empty and non-numeric strings", async () => {
      expect(await run({ severityEstimate: "" })).toMatch(/Invalid arguments/)
      expect(await run({ severityEstimate: "abc" })).toMatch(/Invalid arguments/)
      expect(await run({ severityEstimate: 3, durationMinutes: "abc" })).toMatch(/Invalid arguments/)
    })
    it("keeps description and integer type in the JSON schema", () => {
      const props = (draftObservationTool.parameters as { properties: Record<string, { description?: string; type?: string }> }).properties
      expect(props.severityEstimate.description).toMatch(/estimate/i)
      expect(props.severityEstimate.type).toMatch(/integer|number/)
      expect(props.durationMinutes.description).toMatch(/minutes/)
      expect(props.durationMinutes.type).toMatch(/integer|number/)
    })
  })
})
