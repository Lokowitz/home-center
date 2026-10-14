import { describe, expect, it } from "vitest"
import { statusTone } from "./overview"

describe("statusTone", () => {
  it("none before any backup with no schedule", () => expect(statusTone({ newestAt: null, lastStatus: null, stale: false })).toBe("none"))
  it("failed when the last run failed", () => expect(statusTone({ newestAt: new Date(), lastStatus: "FAILED", stale: false })).toBe("failed"))
  it("failed when interrupted", () => expect(statusTone({ newestAt: new Date(), lastStatus: "INTERRUPTED", stale: false })).toBe("failed"))
  it("stale on warnings or staleness", () => {
    expect(statusTone({ newestAt: new Date(), lastStatus: "WARN", stale: false })).toBe("stale")
    expect(statusTone({ newestAt: new Date(), lastStatus: "OK", stale: true })).toBe("stale")
  })
  it("ok otherwise", () => expect(statusTone({ newestAt: new Date(), lastStatus: "OK", stale: false })).toBe("ok"))
})
