import { describe, expect, it } from "vitest"
import { recoveryKitText } from "@/components/settings/data/recovery-kit"
import { parseIdentity } from "./protect-shared"

const kit = { identity: "AGE-SECRET-KEY-1QQQQ", recipient: "age1qqqq", fingerprint: "ab12-cd34", created: new Date("2026-01-01T00:00:00Z") }

describe("recovery kit file", () => {
  it("is a valid age identity file: every line is blank, a # comment, or the key", () => {
    const lines = recoveryKitText(kit).split("\n")
    for (const l of lines) expect(l === "" || l.startsWith("#") || l === kit.identity).toBe(true)
    expect(lines.filter((l) => l === kit.identity)).toHaveLength(1)
  })
  it("still reads back in HomeCenter and keeps its instructions", () => {
    const text = recoveryKitText(kit)
    expect(parseIdentity(text)).toBe(kit.identity)
    expect(text).toContain("ab12-cd34")
    expect(text).toContain("age -d -i homecenter-recovery-key.txt")
  })
})
