import { describe, expect, it } from "vitest"
import { PLACEMENTS, placementCookie, readPlacement, type PlacementKey } from "./placement"

describe("placement cookies", () => {
  it("defaults the assistant to floating and Intake to the top bar", () => {
    expect(readPlacement("assistant", undefined)).toBe("floating")
    expect(readPlacement("intake", undefined)).toBe("header")
  })

  it("accepts only a known option", () => {
    expect(readPlacement("assistant", "header")).toBe("header")
    expect(readPlacement("intake", "sidebar")).toBe("sidebar")
    expect(readPlacement("assistant", "sidebar")).toBe("floating")
    expect(readPlacement("intake", "floating")).toBe("header")
    expect(readPlacement("assistant", "")).toBe("floating")
    expect(readPlacement("intake", "SIDEBAR ")).toBe("header")
  })

  it("writes a site-wide cookie that lasts a year", () => {
    expect(placementCookie("intake", "sidebar")).toBe("hc-intake=sidebar; path=/; max-age=31536000; samesite=lax")
    expect(placementCookie("assistant", "header")).toBe("hc-assistant=header; path=/; max-age=31536000; samesite=lax")
  })

  it("round-trips every option", () => {
    for (const key of Object.keys(PLACEMENTS) as PlacementKey[]) {
      for (const { value } of PLACEMENTS[key].options) {
        const [name, stored] = placementCookie(key, value as never).split(";")[0].split("=")
        expect(name).toBe(PLACEMENTS[key].cookie)
        expect(readPlacement(key, stored)).toBe(value)
      }
    }
  })
})
