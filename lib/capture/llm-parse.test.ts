import { describe, expect, it } from "vitest"
import type { ChatFn, ChatRequest } from "@/lib/llm/types"
import { PROMPT, askViaChat, llmParseReceipt, parseLlmReply } from "./llm-parse"

describe("parseLlmReply", () => {
  it("reads a plain JSON reply", () => {
    expect(parseLlmReply('{"date":"2026-10-05","total":108.25,"vendor":"Acme"}')).toEqual({
      date: "2026-10-05", total: 108.25, vendor: "Acme",
    })
  })
  it("tolerates code fences and a think preamble", () => {
    const r = '<think>The total is {maybe} 5</think>\n```json\n{"date": "2026-01-02", "total": 5, "vendor": " Bob "}\n```'
    expect(parseLlmReply(r)).toEqual({ date: "2026-01-02", total: 5, vendor: "Bob" })
  })
  it("tolerates prose around the JSON", () => {
    expect(parseLlmReply('Sure! {"date":null,"total":null,"vendor":null} hope that helps')).toEqual({
      date: null, total: null, vendor: null,
    })
  })
  it("accepts numeric strings for total", () => {
    expect(parseLlmReply('{"total":"1,234.56"}')?.total).toBe(1234.56)
    expect(parseLlmReply('{"total":"$-12.50"}')?.total).toBe(-12.5)
    expect(parseLlmReply('{"total":-3}')?.total).toBe(-3)
  })
  it("nulls invalid fields individually", () => {
    expect(parseLlmReply('{"date":"2026-02-30","total":"abc","vendor":"   "}')).toEqual({
      date: null, total: null, vendor: null,
    })
    expect(parseLlmReply('{"date":"10/05/2026","total":true,"vendor":42}')).toEqual({
      date: null, total: null, vendor: null,
    })
    expect(parseLlmReply(`{"vendor":"${"x".repeat(81)}"}`)?.vendor).toBeNull()
    expect(parseLlmReply(`{"vendor":"${"x".repeat(80)}"}`)?.vendor).toHaveLength(80)
  })
  it("returns null without a JSON object", () => {
    expect(parseLlmReply("")).toBeNull()
    expect(parseLlmReply("I could not read it.")).toBeNull()
    expect(parseLlmReply("{not json}")).toBeNull()
    expect(parseLlmReply("[1,2]")).toBeNull()
  })
})

describe("llmParseReceipt", () => {
  it("sends the prompt and truncated text, then parses the reply", async () => {
    const calls: [string, string][] = []
    const r = await llmParseReceipt("a".repeat(20000), async (system, user) => {
      calls.push([system, user])
      return '{"date":"2026-10-05","total":10,"vendor":"Acme"}'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(PROMPT)
    expect(calls[0][1]).toHaveLength(12000)
    expect(r).toEqual({ date: "2026-10-05", total: 10, vendor: "Acme" })
  })
  it("propagates ask errors", async () => {
    await expect(llmParseReceipt("x", async () => { throw new Error("down") })).rejects.toThrow("down")
  })
})

describe("askViaChat", () => {
  it("builds a system+user request without tools and returns the content", async () => {
    let seen: ChatRequest | undefined
    const chat: ChatFn = async (req, onText) => {
      seen = req
      onText('{"a"')
      onText(":1}")
      return { content: '{"a":1}', toolCalls: [] }
    }
    const ask = askViaChat(chat)
    expect(await ask("SYS", "USER")).toBe('{"a":1}')
    expect(seen).toEqual({
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
    })
  })
  it("falls back to streamed text when content is empty", async () => {
    const chat: ChatFn = async (_req, onText) => {
      onText("he")
      onText("llo")
      return { content: "", toolCalls: [] }
    }
    expect(await askViaChat(chat)("s", "u")).toBe("hello")
  })
  it("passes the signal through", async () => {
    const ctl = new AbortController()
    let got: AbortSignal | undefined
    const chat: ChatFn = async (_req, _onText, signal) => {
      got = signal
      return { content: "x", toolCalls: [] }
    }
    await askViaChat(chat, ctl.signal)("s", "u")
    expect(got).toBe(ctl.signal)
  })
})
