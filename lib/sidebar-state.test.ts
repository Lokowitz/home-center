import { describe, expect, it } from "vitest"
import { SIDEBAR_COOKIE, readSidebarCollapsed, sidebarCookie } from "./sidebar-state"

describe("sidebar state cookie", () => {
  it("is collapsed only when the cookie says so", () => {
    expect(readSidebarCollapsed("collapsed")).toBe(true)
    expect(readSidebarCollapsed("expanded")).toBe(false)
    expect(readSidebarCollapsed(undefined)).toBe(false)
    expect(readSidebarCollapsed("")).toBe(false)
    expect(readSidebarCollapsed("COLLAPSED ")).toBe(false)
  })

  it("writes a site-wide cookie that lasts a year", () => {
    expect(sidebarCookie(true)).toBe(`${SIDEBAR_COOKIE}=collapsed; path=/; max-age=31536000; samesite=lax`)
    expect(sidebarCookie(false)).toBe(`${SIDEBAR_COOKIE}=expanded; path=/; max-age=31536000; samesite=lax`)
  })

  it("round-trips", () => {
    for (const c of [true, false]) {
      const value = sidebarCookie(c).split(";")[0].split("=")[1]
      expect(readSidebarCollapsed(value)).toBe(c)
    }
  })
})
