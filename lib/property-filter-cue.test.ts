import { describe, expect, it } from "vitest"
import { CUE_DURATION_MS, CUE_INTERVAL_MS, cueActive } from "./property-filter-cue"

describe("property filter cue", () => {
  it("is active only when selected, visible and motion is allowed", () => {
    expect(cueActive({ selected: true, hidden: false, reducedMotion: false })).toBe(true)
    expect(cueActive({ selected: true, hidden: false, reducedMotion: true })).toBe(false)
    expect(cueActive({ selected: true, hidden: true, reducedMotion: false })).toBe(false)
    expect(cueActive({ selected: true, hidden: true, reducedMotion: true })).toBe(false)
    expect(cueActive({ selected: false, hidden: false, reducedMotion: false })).toBe(false)
    expect(cueActive({ selected: false, hidden: false, reducedMotion: true })).toBe(false)
    expect(cueActive({ selected: false, hidden: true, reducedMotion: false })).toBe(false)
    expect(cueActive({ selected: false, hidden: true, reducedMotion: true })).toBe(false)
  })

  it("runs every 20 seconds for about two seconds", () => {
    expect(CUE_INTERVAL_MS).toBe(20000)
    expect(CUE_DURATION_MS).toBeGreaterThanOrEqual(1500)
    expect(CUE_DURATION_MS).toBeLessThanOrEqual(2000)
  })
})
