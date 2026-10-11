import { describe, expect, it } from "vitest"
import { TIP_IDS, isTipDismissed, isTipId, tipStorageKey, TIP_DISMISSED } from "./tips"

describe("tips", () => {
  it("knows its tip ids", () => {
    expect(TIP_IDS).toEqual(["drop-anywhere-dashboard", "manual-record-receipt", "intake-page-drop-anywhere"])
    expect(isTipId("manual-record-receipt")).toBe(true)
    expect(isTipId("nope")).toBe(false)
    expect(isTipId(undefined)).toBe(false)
  })
  it("keeps each tip under its own namespaced key", () => {
    expect(tipStorageKey("drop-anywhere-dashboard")).toBe("homecenter.tip.drop-anywhere-dashboard")
    const keys = TIP_IDS.map(tipStorageKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it("treats only the stored marker as dismissed", () => {
    expect(isTipDismissed(TIP_DISMISSED)).toBe(true)
    expect(isTipDismissed(null)).toBe(false)
    expect(isTipDismissed("")).toBe(false)
    expect(isTipDismissed("0")).toBe(false)
  })
})
