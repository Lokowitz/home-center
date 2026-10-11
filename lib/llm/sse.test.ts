import { describe, expect, it } from "vitest"
import { createDeltaAccumulator, createSseParser } from "./sse"
import { LlmError } from "./errors"

const chunk = (delta: object) => JSON.stringify({ choices: [{ delta }] })

describe("createSseParser", () => {
  it("emits data payloads split across chunks and ignores other lines", () => {
    const out: string[] = []
    const p = createSseParser((d) => out.push(d))
    p.feed("event: x\r\ndata: {\"a\"")
    p.feed(":1}\r\n\r\n: comment\ndata: [DONE]")
    p.flush()
    expect(out).toEqual(['{"a":1}', "[DONE]"])
  })
})

describe("createDeltaAccumulator", () => {
  it("collects text and reports it live", () => {
    const live: string[] = []
    const acc = createDeltaAccumulator((t) => live.push(t))
    acc.push(chunk({ role: "assistant", content: "" }))
    acc.push(chunk({ content: "Hel" }))
    acc.push(chunk({ content: "lo" }))
    expect(acc.push("[DONE]")).toBe(true)
    expect(live).toEqual(["Hel", "lo"])
    expect(acc.result()).toEqual({ content: "Hello", toolCalls: [] })
  })

  it("keeps the finish reason, so a cut-off reply can be told apart", () => {
    const acc = createDeltaAccumulator(() => {})
    acc.push(chunk({ reasoning_content: "thinking" }))
    acc.push(JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] }))
    expect(acc.result()).toEqual({ content: "", toolCalls: [], finishReason: "length" })
  })

  it("assembles parallel tool calls from fragments", () => {
    const acc = createDeltaAccumulator(() => {})
    acc.push(chunk({ tool_calls: [{ index: 0, id: "a", type: "function", function: { name: "search", arguments: "" } }] }))
    acc.push(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"que' } }] }))
    acc.push(chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "health_alerts", arguments: "{}" } }] }))
    acc.push(chunk({ tool_calls: [{ index: 0, function: { arguments: 'ry":"civic"}' } }] }))
    expect(acc.result().toolCalls).toEqual([
      { id: "a", name: "search", arguments: '{"query":"civic"}' },
      { id: "b", name: "health_alerts", arguments: "{}" },
    ])
  })

  it("fills in missing ids and indexes", () => {
    const acc = createDeltaAccumulator(() => {})
    acc.push(chunk({ tool_calls: [{ function: { name: "search", arguments: "{}" } }] }))
    expect(acc.result().toolCalls).toEqual([{ id: "call_0", name: "search", arguments: "{}" }])
  })

  it("ignores junk lines", () => {
    const acc = createDeltaAccumulator(() => {})
    expect(acc.push("not json")).toBe(false)
    expect(acc.result()).toEqual({ content: "", toolCalls: [] })
  })

  it("throws on an in-stream error", () => {
    const acc = createDeltaAccumulator(() => {})
    expect(() => acc.push(JSON.stringify({ error: { message: "model overloaded" } }))).toThrow(LlmError)
  })
})
