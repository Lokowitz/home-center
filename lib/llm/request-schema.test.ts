import { describe, expect, it } from "vitest"
import { chatRequestSchema, firstIssue, MAX_MESSAGE_CHARS } from "./request-schema"

const parse = (body: unknown) => {
  const r = chatRequestSchema.safeParse(body)
  return r.success ? "ok" : firstIssue(r.error)
}
const user = (content = "q") => ({ role: "user", content })
const assistant = (content = "a") => ({ role: "assistant", content })

describe("chatRequestSchema", () => {
  it("accepts a normal thread", () => {
    expect(parse({ messages: [user(), assistant(), user()] })).toBe("ok")
  })
  it("accepts consecutive user messages (a retried failed turn)", () => {
    expect(parse({ messages: [user(), user()] })).toBe("ok")
  })
  it("requires the last message to be from the user", () => {
    expect(parse({ messages: [user(), assistant()] })).toBe("The last message must be from the user.")
  })
  it("rejects other roles, empty and oversized content", () => {
    expect(parse({ messages: [{ role: "system", content: "x" }, user()] })).not.toBe("ok")
    expect(parse({ messages: [{ role: "tool", content: "x" }] })).not.toBe("ok")
    expect(parse({ messages: [user("")] })).not.toBe("ok")
    expect(parse({ messages: [user("x".repeat(MAX_MESSAGE_CHARS + 1))] })).not.toBe("ok")
  })
  it("caps the message count and total size", () => {
    expect(parse({ messages: [] })).not.toBe("ok")
    expect(parse({ messages: Array.from({ length: 41 }, () => user()) })).not.toBe("ok")
    const big = Array.from({ length: 9 }, () => user("x".repeat(8000)))
    expect(parse({ messages: big })).toBe("Conversation too long — start a new chat.")
  })
  it("strips unknown keys", () => {
    const r = chatRequestSchema.parse({ messages: [{ role: "user", content: "q", tool_calls: [] }], extra: 1 })
    expect(r).toEqual({ messages: [{ role: "user", content: "q" }] })
  })
})

describe("chatRequestSchema today", () => {
  const messages = [{ role: "user" as const, content: "hi" }]
  it("accepts the viewer's day or none", () => {
    expect(chatRequestSchema.safeParse({ messages, today: "2026-10-17" }).success).toBe(true)
    expect(chatRequestSchema.safeParse({ messages }).success).toBe(true)
  })
  it("rejects anything else", () => {
    expect(chatRequestSchema.safeParse({ messages, today: "Oct 17" }).success).toBe(false)
  })
})
