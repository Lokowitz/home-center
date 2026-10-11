import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import manifest from "@/app/manifest"

describe("web app manifest", () => {
  const m = manifest()

  it("launches standalone from the site root", () => {
    expect(m.display).toBe("standalone")
    expect(m.start_url).toBe("/")
  })

  it("only references icon files that exist", () => {
    expect(m.icons?.length).toBeGreaterThan(0)
    for (const icon of m.icons ?? []) {
      expect(existsSync(join(process.cwd(), "public", icon.src)), icon.src).toBe(true)
    }
  })
})
