import { describe, expect, it } from "vitest"
import { CAPTURE_OPTIONS, captureOption, captureParserAllowed, effectiveCaptureParser } from "./capture-options"

describe("CAPTURE_OPTIONS", () => {
  it("runs Off, Basic, Local AI with strength rising 0 → 3", () => {
    expect(CAPTURE_OPTIONS.map((o) => o.value)).toEqual(["OFF", "BASIC", "LLM"])
    expect(CAPTURE_OPTIONS.map((o) => o.strength)).toEqual([0, 2, 3])
  })

  it("each step fills at least as much as the one before", () => {
    const rank = { no: 0, sometimes: 1, yes: 2 } as const
    for (let i = 1; i < CAPTURE_OPTIONS.length; i++) {
      const prev = CAPTURE_OPTIONS[i - 1].fills
      for (const f of CAPTURE_OPTIONS[i].fills) {
        const before = prev.find((p) => p.field === f.field)!
        expect(rank[f.level]).toBeGreaterThanOrEqual(rank[before.level])
      }
    }
  })

  it("Basic only sometimes finds the shop; Local AI fills everything and is marked best", () => {
    expect(captureOption("BASIC").fills.find((f) => f.field === "Shop")?.level).toBe("sometimes")
    expect(captureOption("LLM").fills.every((f) => f.level === "yes")).toBe(true)
    expect(CAPTURE_OPTIONS.filter((o) => o.best).map((o) => o.value)).toEqual(["LLM"])
  })

  it("Local AI can only be chosen while the assistant's model is ready", () => {
    expect(captureParserAllowed("LLM", false)).toBe(false)
    expect(captureParserAllowed("LLM", true)).toBe(true)
    expect(captureParserAllowed("BASIC", false)).toBe(true)
    expect(captureParserAllowed("OFF", false)).toBe(true)
  })

  it("a saved Local AI choice shows as Basic while the model isn't ready (that's what runs)", () => {
    expect(effectiveCaptureParser("LLM", false)).toBe("BASIC")
    expect(effectiveCaptureParser("LLM", true)).toBe("LLM")
    expect(effectiveCaptureParser("OFF", false)).toBe("OFF")
  })

  it("Off fills nothing", () => {
    expect(captureOption("OFF").fills.every((f) => f.level === "no")).toBe(true)
  })
})
