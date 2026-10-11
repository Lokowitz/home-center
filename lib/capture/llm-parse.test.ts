import { describe, expect, it } from "vitest"
import type { ChatFn, ChatRequest, ChatResult } from "@/lib/llm/types"
import { LlmError } from "@/lib/llm/errors"
import {
  MAX_TEXT_CHARS, PROMPT, RECEIPT_MAX_TOKENS, fillFromBasic, llmFailureDetail, parseLlmReply, readReceiptByLlm, receiptChatOptions,
} from "./llm-parse"

describe("fillFromBasic", () => {
  const basic = { date: "2025-03-14", total: 45, vendor: "Oakridge Heating" }
  it("keeps every field the model answered", () => {
    expect(fillFromBasic({ date: "2025-03-15", total: 46, vendor: "Oakridge" }, basic)).toEqual({ date: "2025-03-15", total: 46, vendor: "Oakridge" })
  })
  it("fills only the fields the model left empty", () => {
    expect(fillFromBasic({ date: null, total: 46, vendor: null }, basic)).toEqual({ date: "2025-03-14", total: 46, vendor: "Oakridge Heating" })
  })
  it("keeps the model's 0 total: that's an answer, not a gap", () => {
    expect(fillFromBasic({ date: null, total: 0, vendor: null }, basic).total).toBe(0)
  })
  it("stays empty when neither has it", () => {
    expect(fillFromBasic({ date: null, total: null, vendor: null }, { date: null, total: null, vendor: null })).toEqual({ date: null, total: null, vendor: null })
  })
})

describe("PROMPT", () => {
  it("asks for the date things happened, not a print date or date of birth", () => {
    expect(PROMPT).toMatch(/visit or test/)
    expect(PROMPT).toMatch(/date of birth/)
  })
})

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

describe("receiptChatOptions", () => {
  it("asks for a short, repeatable answer whatever the chat settings say", () => {
    const o = receiptChatOptions(null, { thinkingOff: false })
    expect(o).toEqual({ temperature: 0, maxTokens: RECEIPT_MAX_TOKENS, extraBody: null })
    expect(RECEIPT_MAX_TOKENS).toBeGreaterThanOrEqual(300)
  })
  it("turns thinking off for this call, keeping the user's other request fields", () => {
    const o = receiptChatOptions({ top_k: 20, chat_template_kwargs: { enable_thinking: true, foo: 1 } }, { thinkingOff: true })
    expect(o.extraBody).toEqual({ top_k: 20, chat_template_kwargs: { enable_thinking: false, foo: 1 } })
    expect(receiptChatOptions(null, { thinkingOff: true }).extraBody).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  })
  it("replaces a chat_template_kwargs that isn't an object", () => {
    expect(receiptChatOptions({ chat_template_kwargs: "x" }, { thinkingOff: true }).extraBody).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  })
  it("leaves the user's request fields alone without thinkingOff", () => {
    const extra = { chat_template_kwargs: { enable_thinking: true } }
    expect(receiptChatOptions(extra, { thinkingOff: false }).extraBody).toBe(extra)
  })
})

describe("llmFailureDetail", () => {
  it("names the kind of failure without the provider's text", () => {
    expect(llmFailureDetail(new LlmError("The LLM provider returned 400: <echo of the receipt>", 400))).toBe("http 400")
    expect(llmFailureDetail(new LlmError("Couldn't reach the LLM server at ai.local.")))
      .toBe("unreachable")
    expect(llmFailureDetail(new LlmError("Couldn't reach the LLM server at ai.local: secret text")))
      .toBe("unreachable")
    expect(llmFailureDetail(new LlmError("The LLM server stopped responding for 60 seconds — it may be busy. Try again."))).toBe("stalled")
    expect(llmFailureDetail(new DOMException("timed out", "TimeoutError"))).toBe("timeout")
    expect(llmFailureDetail(new DOMException("aborted", "AbortError"))).toBe("timeout")
    expect(llmFailureDetail(new TypeError("receipt text here"))).toBe("TypeError")
    expect(llmFailureDetail("str")).toBe("string")
  })
})

/** A fake ChatFn that records its options and answers with `reply`. */
function fakeChats(reply: (o: { thinkingOff: boolean }) => Promise<ChatResult> | ChatResult) {
  const seen: { thinkingOff: boolean; req: ChatRequest }[] = []
  const make = (o: { thinkingOff: boolean }): ChatFn => async (req) => {
    seen.push({ ...o, req })
    return reply(o)
  }
  return { make, seen }
}
const ok = (content: string, finishReason: string | null = "stop"): ChatResult => ({ content, toolCalls: [], finishReason })

describe("readReceiptByLlm", () => {
  it("sends the prompt and truncated text with thinking off, then parses the reply", async () => {
    const { make, seen } = fakeChats(() => ok('{"date":"2026-10-05","total":10,"vendor":"Acme"}'))
    const r = await readReceiptByLlm("a".repeat(20000), make)
    expect(r).toEqual({ parsed: { date: "2026-10-05", total: 10, vendor: "Acme" } })
    expect(seen).toHaveLength(1)
    expect(seen[0].thinkingOff).toBe(true)
    expect(seen[0].req.messages).toEqual([{ role: "system", content: PROMPT }, { role: "user", content: "a".repeat(MAX_TEXT_CHARS) }])
    expect(seen[0].req.tools).toBeUndefined()
  })
  it("uses streamed text when the result's content is empty", async () => {
    const make = (): ChatFn => async (_req, onText) => {
      onText('{"total":')
      onText("5}")
      return { content: "", toolCalls: [] }
    }
    expect(await readReceiptByLlm("x", make)).toEqual({ parsed: { date: null, total: 5, vendor: null } })
  })
  it("says so when the reply has no usable JSON: cut off while thinking", async () => {
    const { make } = fakeChats(() => ok("", "length"))
    expect(await readReceiptByLlm("x", make)).toEqual({ note: "llm-no-answer", detail: "no JSON in reply (finish: length, 0 chars)" })
  })
  it("says so when the reply is prose, without repeating it", async () => {
    const { make } = fakeChats(() => ok("I can't read this receipt from Acme.", null))
    const r = await readReceiptByLlm("x", make)
    expect(r).toEqual({ note: "llm-no-answer", detail: "no JSON in reply (finish: unknown, 36 chars)" })
    expect(JSON.stringify(r)).not.toContain("Acme")
  })
  it("says so when the request fails", async () => {
    const { make } = fakeChats(() => {
      throw new LlmError("Couldn't reach the LLM server at ai.local.")
    })
    expect(await readReceiptByLlm("x", make)).toEqual({ note: "llm-failed", detail: "unreachable" })
  })
  it("retries once with the user's own request fields when the server rejects the thinking switch", async () => {
    const { make, seen } = fakeChats(({ thinkingOff }) => {
      if (thinkingOff) throw new LlmError("The LLM provider returned 400: unknown field", 400)
      return ok('{"total":7}')
    })
    expect(await readReceiptByLlm("x", make)).toEqual({ parsed: { date: null, total: 7, vendor: null } })
    expect(seen.map((s) => s.thinkingOff)).toEqual([true, false])
  })
  it("doesn't retry other failures", async () => {
    const { make, seen } = fakeChats(() => {
      throw new LlmError("The LLM provider had an error — try again.", 500)
    })
    expect(await readReceiptByLlm("x", make)).toEqual({ note: "llm-failed", detail: "http 500" })
    expect(seen).toHaveLength(1)
  })
  it("reports the retry's failure", async () => {
    const { make } = fakeChats(({ thinkingOff }) => {
      throw new LlmError("bad", thinkingOff ? 400 : 404)
    })
    expect(await readReceiptByLlm("x", make)).toEqual({ note: "llm-failed", detail: "http 404" })
  })
  it("passes the signal through", async () => {
    const ctl = new AbortController()
    let got: AbortSignal | undefined
    const make = (): ChatFn => async (_req, _onText, signal) => {
      got = signal
      return ok("{}")
    }
    await readReceiptByLlm("x", make, ctl.signal)
    expect(got).toBe(ctl.signal)
  })
})
