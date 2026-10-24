import { describe, expect, it, vi } from "vitest"
import { createHash } from "crypto"
import { createLoginThrottle } from "./login-throttle"
import {
  RESET_REQUEST_LIMITS, RESET_TOKEN_MS, RESET_USE_LIMITS,
  completePasswordReset, requestPasswordReset, resetEmail,
  type CompleteDeps, type RequestDeps,
} from "./password-reset"

const NOW = new Date("2026-10-21T12:00:00Z")
const hash = (t: string) => createHash("sha256").update(t).digest("hex")
// The link is sent in the background; lets it finish before checking.
const settle = () => new Promise((r) => setTimeout(r, 0))

function requestDeps(over: Partial<RequestDeps> = {}): RequestDeps {
  return {
    mailReady: async () => true,
    findUser: async () => ({ id: "u1", email: "a@b.co", name: "Ann" }),
    storeToken: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    generateToken: () => "tok_abc",
    hashToken: hash,
    appUrl: async () => "https://home.example",
    now: () => NOW,
    throttle: createLoginThrottle(RESET_REQUEST_LIMITS),
    ...over,
  }
}

describe("requestPasswordReset", () => {
  it("emails a link and stores only the token's hash, valid for 15 minutes", async () => {
    const d = requestDeps()
    expect(await requestPasswordReset("a@b.co", "1.1.1.1", d)).toBe("sent")
    await settle()
    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.co", text: expect.stringContaining("https://home.example/reset-password?token=tok_abc") })
    )
    expect(d.storeToken).toHaveBeenCalledWith("u1", hash("tok_abc"), new Date(NOW.getTime() + 15 * 60_000))
    expect(RESET_TOKEN_MS).toBe(15 * 60_000)
  })

  it("sends the code instead of a link when AUTH_URL isn't set", () => {
    const { text } = resetEmail("Ann", "tok_abc", null)
    expect(text).toContain("tok_abc")
    expect(text).not.toContain("http")
    expect(text).toContain("15 minutes")
  })

  it("does nothing when mail isn't set up", async () => {
    const d = requestDeps({ mailReady: async () => false })
    expect(await requestPasswordReset("a@b.co", "1.1.1.1", d)).toBe("unavailable")
    expect(d.send).not.toHaveBeenCalled()
  })

  it("answers 'sent' for an unknown address without sending", async () => {
    const d = requestDeps({ findUser: async () => null })
    expect(await requestPasswordReset("x@y.co", "1.1.1.1", d)).toBe("sent")
    expect(d.send).not.toHaveBeenCalled()
    expect(d.storeToken).not.toHaveBeenCalled()
  })

  it("stores nothing when the email can't be sent", async () => {
    const d = requestDeps({ send: vi.fn(async () => { throw new Error("smtp down") }) })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await requestPasswordReset("a@b.co", "1.1.1.1", d)).toBe("sent")
    await settle()
    expect(d.storeToken).not.toHaveBeenCalled()
  })

  it("answers without waiting for the mail server, so a real account isn't slower", async () => {
    let release!: () => void
    const d = requestDeps({ send: vi.fn(() => new Promise<void>((r) => (release = r))) })
    expect(await requestPasswordReset("a@b.co", "1.1.1.1", d)).toBe("sent")
    expect(d.storeToken).not.toHaveBeenCalled()
    release()
    await settle()
    expect(d.storeToken).toHaveBeenCalled()
  })

  it("rejects a malformed address", async () => {
    expect(await requestPasswordReset("nope", "1.1.1.1", requestDeps())).toBe("invalid")
    expect(await requestPasswordReset(undefined, "1.1.1.1", requestDeps())).toBe("invalid")
  })

  it("throttles repeated requests for one address", async () => {
    const d = requestDeps()
    for (let i = 0; i < RESET_REQUEST_LIMITS.perEmail; i++) expect(await requestPasswordReset("a@b.co", `10.0.0.${i}`, d)).toBe("sent")
    expect(await requestPasswordReset("a@b.co", "10.0.0.99", d)).toBe("throttled")
    await settle()
    expect(d.send).toHaveBeenCalledTimes(RESET_REQUEST_LIMITS.perEmail)
  })
})

function completeDeps(over: Partial<CompleteDeps> = {}): CompleteDeps {
  return {
    hashToken: hash,
    consumeToken: vi.fn(async () => ({ userId: "u1" })),
    setPassword: vi.fn(async () => {}),
    now: () => NOW,
    throttle: createLoginThrottle(RESET_USE_LIMITS),
    ...over,
  }
}

const good = { token: "tok_abc", next: "newpass1", confirm: "newpass1" }

describe("completePasswordReset", () => {
  it("sets the password for a valid link, looking it up by hash", async () => {
    const d = completeDeps()
    expect(await completePasswordReset(good, "1.1.1.1", d)).toBe("ok")
    expect(d.consumeToken).toHaveBeenCalledWith(hash("tok_abc"), NOW)
    expect(d.setPassword).toHaveBeenCalledWith("u1", "newpass1")
  })

  it("rejects an unknown, used or expired link", async () => {
    const d = completeDeps({ consumeToken: vi.fn(async () => null) })
    expect(await completePasswordReset(good, "1.1.1.1", d)).toBe("invalid")
    expect(d.setPassword).not.toHaveBeenCalled()
    expect(await completePasswordReset({ ...good, token: "" }, "1.1.1.1", d)).toBe("invalid")
  })

  it("doesn't use up the link on a short or mismatched password", async () => {
    const d = completeDeps()
    expect(await completePasswordReset({ ...good, next: "ab", confirm: "ab" }, "1.1.1.1", d)).toBe("short")
    expect(await completePasswordReset({ ...good, confirm: "different" }, "1.1.1.1", d)).toBe("mismatch")
    expect(d.consumeToken).not.toHaveBeenCalled()
  })

  it("blocks a visitor after repeated bad links", async () => {
    const d = completeDeps({ consumeToken: vi.fn(async () => null) })
    for (let i = 0; i < RESET_USE_LIMITS.perIp; i++) await completePasswordReset(good, "9.9.9.9", d)
    expect(await completePasswordReset(good, "9.9.9.9", d)).toBe("throttled")
  })
})
