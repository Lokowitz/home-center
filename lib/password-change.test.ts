import { describe, expect, it } from "vitest"
import { checkPasswordChange, MIN_PASSWORD_LENGTH } from "./password-change"

const compare = async (pw: string, hash: string) => hash === `hash:${pw}`
const account = { mustResetPassword: false, passwordHash: "hash:old-password-123" }
const good = "a-long-new-password"

describe("checkPasswordChange", () => {
  it("accepts a long new password with the right current one", async () => {
    expect(await checkPasswordChange({ current: "old-password-123", next: good, confirm: good }, account, compare)).toBeNull()
  })

  it("requires the current password", async () => {
    expect(await checkPasswordChange({ current: "", next: good, confirm: good }, account, compare)).toBe("wrong-current")
  })

  it("rejects a wrong current password", async () => {
    expect(await checkPasswordChange({ current: "guess", next: good, confirm: good }, account, compare)).toBe("wrong-current")
  })

  it("skips the current password on a forced reset, where the temporary one was just used", async () => {
    const forced = { ...account, mustResetPassword: true }
    expect(await checkPasswordChange({ current: "", next: good, confirm: good }, forced, compare)).toBeNull()
  })

  it("rejects a short password", async () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1)
    expect(await checkPasswordChange({ current: "old-password-123", next: short, confirm: short }, account, compare)).toBe("short")
  })

  it("needs at least 6 characters", async () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6)
    const five = "abcde"
    expect(await checkPasswordChange({ current: "old-password-123", next: five, confirm: five }, account, compare)).toBe("short")
  })

  it("accepts any password of the minimum length, with no complexity rules", async () => {
    const simple = "aaaaaa"
    expect(await checkPasswordChange({ current: "old-password-123", next: simple, confirm: simple }, account, compare)).toBeNull()
  })

  it("rejects a confirmation that doesn't match", async () => {
    expect(await checkPasswordChange({ current: "old-password-123", next: good, confirm: `${good}!` }, account, compare)).toBe("mismatch")
  })
})
