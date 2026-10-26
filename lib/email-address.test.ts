import { describe, expect, it } from "vitest"
import { emailAddress, isEmailAddress, normalizeEmail, sameEmail } from "./email-address"

describe("emailAddress", () => {
  it("accepts an ordinary address and trims spaces around it", () => {
    expect(emailAddress.parse("  sam@example.com ")).toBe("sam@example.com")
  })

  it("stores the address in lower case", () => {
    expect(emailAddress.parse("Sam@Example.com")).toBe("sam@example.com")
  })

  it("rejects an address that smuggles in another recipient", () => {
    expect(emailAddress.safeParse("victim@x.com>\r\nBcc: attacker@evil.com").success).toBe(false)
    expect(emailAddress.safeParse("a@x.com, attacker@evil.com").success).toBe(false)
    expect(emailAddress.safeParse("Group: attacker@evil.com;").success).toBe(false)
  })

  it("rejects text that isn't an address", () => {
    expect(emailAddress.safeParse("").success).toBe(false)
    expect(emailAddress.safeParse("admin").success).toBe(false)
  })

  it("rejects an address longer than mail allows", () => {
    expect(emailAddress.safeParse(`${"a".repeat(250)}@x.com`).success).toBe(false)
  })
})

describe("isEmailAddress", () => {
  it("is the same rule, for checking a stored address before sending", () => {
    expect(isEmailAddress("sam@example.com")).toBe(true)
    expect(isEmailAddress("a@x.com>\r\nBcc: e@f.g")).toBe(false)
  })
})

describe("normalizeEmail and sameEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  QA-User@Example.TEST ")).toBe("qa-user@example.test")
  })

  it("treats spellings that differ only in case as one address", () => {
    expect(sameEmail("QA-Access-User@example.test", "qa-access-user@example.test")).toBe(true)
    expect(sameEmail("a@x.com", "b@x.com")).toBe(false)
  })
})
