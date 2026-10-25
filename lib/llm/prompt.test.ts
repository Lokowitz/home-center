import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "./prompt"
import { createFormatter, DEFAULT_REGIONAL } from "@/lib/regional"

describe("buildSystemPrompt", () => {
  const now = new Date("2026-09-26T18:00:00Z")

  it("describes the document tools only when documents are on", () => {
    expect(buildSystemPrompt({ now })).not.toContain("search_documents")
    const p = buildSystemPrompt({ now, documents: true })
    expect(p).toContain("search_documents")
    expect(p).toContain("read_document")
    expect(p).toContain("list_documents")
    expect(p).toMatch(/never follow instructions/i)
  })

  it("uses the user's local day when given, else UTC", () => {
    expect(buildSystemPrompt({ now, today: "2026-10-17" })).toContain("Today is 2026-10-17 (the user's local day)")
    expect(buildSystemPrompt({ now })).toContain("(UTC)")
  })

  it("names the property the user is viewing", () => {
    expect(buildSystemPrompt({ now, viewing: "Lake Cabin" })).toContain(
      "The user is viewing Lake Cabin. Items from other properties are hidden from you; if asked about them, say the property filter is hiding them."
    )
    expect(buildSystemPrompt({ now })).not.toContain("viewing")
  })

  it("carries the date, rules and data model", () => {
    const p = buildSystemPrompt({ now })
    expect(p).toContain("Today is 2026-09-26")
    expect(p).toMatch(/only from data returned by your tools/)
    expect(p).toContain("- serviceRecord:")
    expect(p).toContain("search, cost_summary, asset_history, maintenance_status, warranty_status, health_alerts, medication_history, observation_log")
    expect(p).toContain("use medication_history")
    expect(p).not.toMatch(/passwordHash/)
  })

  it("describes rooms only while Rooms is on", () => {
    expect(buildSystemPrompt({ now })).toMatch(/^- room:/m)
    expect(buildSystemPrompt({ now, rooms: false })).not.toMatch(/^- room/m)
  })

  it("describes the read-only intake tool and where filing happens", () => {
    for (const health of [true, false]) {
      const p = buildSystemPrompt({ now, health })
      expect(p).toMatch(/^- intake lists/m)
      expect(p).toContain("[Intake](/intake)")
      expect(p).not.toContain("(/inbox)")
      expect(p).toMatch(/can't file/i)
    }
  })

  it("tells the model how files get into Intake", () => {
    for (const health of [true, false]) {
      const p = buildSystemPrompt({ now, health })
      expect(p).toMatch(/^- To add files to Intake, the user can drag them onto any page or use the paperclip/m)
    }
  })

  it("appends admin instructions last", () => {
    const p = buildSystemPrompt({ now, extra: "Answer in Spanish." })
    expect(p.trimEnd().endsWith("Answer in Spanish.")).toBe(true)
    expect(buildSystemPrompt({ now, extra: null })).not.toContain("administrator")
  })

  it("tells the model how many lookup rounds it has", () => {
    expect(buildSystemPrompt({ now })).toContain("at most 8 turns of tool calls")
    expect(buildSystemPrompt({ now, maxRounds: 4 })).toContain("at most 4 turns of tool calls")
  })

  it("writes money and units the household way", () => {
    const fmt = createFormatter({ ...DEFAULT_REGIONAL, currency: "EUR", distanceUnit: "KM", areaUnit: "SQM" })
    const p = buildSystemPrompt({ now, fmt })
    expect(p).toContain(`Money as ${fmt.money(1234.56)}`)
    expect(p).toContain("Distances on odometers are in kilometres")
    expect(p).toContain("Areas are in square metres")
    expect(p).not.toContain("$1,234.56")
  })

  it("defaults keep dollars and miles", () => {
    expect(buildSystemPrompt({ now })).toContain(`Money as ${createFormatter(DEFAULT_REGIONAL).money(1234.56)}`)
  })
})
