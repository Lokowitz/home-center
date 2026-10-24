import { describe, expect, it, vi } from "vitest"

// The tools module reaches Prisma at import; nothing here queries it.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { compileInclude, compileWhere, entityDef, ToolInputError } from "./query"
import { describeOntology } from "./ontology"
import { buildSystemPrompt } from "./prompt"
import { chatTools } from "./tools"

const off = { userId: "u1", now: new Date("2026-10-01T00:00:00Z"), health: false }
const on = { ...off, health: true }

describe("assistant with Health off", () => {
  it("refuses health entities", () => {
    expect(() => entityDef("person", off)).toThrow(ToolInputError)
    expect(() => entityDef("medications", off)).toThrow(/Health is turned off/)
    expect(entityDef("person", on).key).toBe("person")
    expect(entityDef("serviceRecord", off).key).toBe("serviceRecord")
  })

  it("leaves people's records out of polymorphic queries", () => {
    expect(JSON.stringify(compileWhere("serviceRecord", [], off).where)).toContain('"assetType":{"not":"PERSON"}')
    expect(JSON.stringify(compileWhere("serviceRecord", [], on).where)).not.toContain("PERSON")
  })

  it("leaves health notifications out", () => {
    expect(JSON.stringify(compileWhere("notification", [], off).where)).toContain("MEDICATION_REFILL")
  })

  it("refuses filters and includes that reach health entities", () => {
    expect(() => compileWhere("serviceRecord", [{ field: "provider.name", op: "eq", value: "Dr. A" }], off)).toThrow(ToolInputError)
    expect(() => compileInclude("serviceRecord", ["provider"], undefined, off)).toThrow(ToolInputError)
    expect(() => compileInclude("serviceRecord", ["provider"], undefined, on)).not.toThrow()
  })

  it("reaches non-health insurance with Health off", () => {
    expect(entityDef("insurancePolicy", off).key).toBe("insurancePolicy")
    expect(JSON.stringify(compileWhere("insurancePolicy", [], off).where)).toContain('"kind":{"notIn":["MEDICAL","DENTAL","VISION","OTHER"]}')
    expect(JSON.stringify(compileWhere("insurancePolicy", [], on).where)).not.toContain("notIn")
    expect(JSON.stringify(compileWhere("insurancePremium", [], off).where)).toContain('"policy":{"kind":{"notIn"')
    expect(JSON.stringify(compileWhere("insuranceCoverage", [], off).where)).toContain('"policy":{"kind":{"notIn"')
    expect(() => compileWhere("insurancePolicy", [{ field: "members.name", op: "eq", value: "Anna" }], off)).toThrow(ToolInputError)
    expect(() => compileInclude("insurancePolicy", ["members"], undefined, off)).toThrow(ToolInputError)
    expect(describeOntology(false)).toMatch(/^- insurancePolicy:/m)
    expect(describeOntology(false)).toContain("properties→property[]")
    expect(describeOntology(false)).not.toContain("members→person[]")
  })

  it("keeps health out of the prompt and the tools", () => {
    expect(describeOntology(false)).not.toMatch(/^- person:/m)
    expect(describeOntology(true)).toMatch(/^- person:/m)
    const prompt = buildSystemPrompt({ now: off.now, health: false })
    expect(prompt).toContain("turned off")
    expect(prompt).not.toContain("health_alerts")
    const names = chatTools({ enabled: false, includeHealth: false }, false).map((t) => t.name)
    expect(names).not.toContain("health_alerts")
    expect(names).not.toContain("observation_log")
    expect(names).not.toContain("draft_observation")
    expect(names).not.toContain("propose_observation_edit")
    expect(names).not.toContain("propose_observation_delete")
    expect(buildSystemPrompt({ now: off.now, health: false })).not.toContain("propose_observation")
    expect(chatTools({ enabled: false, includeHealth: false }).map((t) => t.name)).toContain("health_alerts")
    expect(chatTools({ enabled: false, includeHealth: false }).map((t) => t.name)).toContain("draft_observation")
    expect(buildSystemPrompt({ now: off.now, health: false })).not.toContain("draft_observation")
  })

  it("offers the intake tool with Health on or off", () => {
    expect(chatTools({ enabled: false, includeHealth: false }, false).map((t) => t.name)).toContain("intake")
    expect(chatTools({ enabled: true, includeHealth: true }).map((t) => t.name)).toContain("intake")
  })
})
