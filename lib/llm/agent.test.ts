import { describe, expect, it } from "vitest"
import { z } from "zod/v4"
import { MAX_TOOL_ROUNDS, runAgent, type AgentOptions } from "./agent"
import { EMPTY_ANSWER, FINAL_NUDGE, recheckNudge } from "./prompt"
import { defineTool } from "./tools/registry"
import type { AgentEvent, ChatFn, ChatRequest, ChatResult, HistoryMessage } from "./types"

const ctx = { userId: "u1", now: new Date("2026-09-26T12:00:00Z") }

type Scripted = ChatResult & { stream?: string[] }

function scripted(responses: Scripted[]) {
  const requests: ChatRequest[] = []
  const chat: ChatFn = async (req, onText) => {
    requests.push(structuredClone(req))
    const r = responses.shift()
    if (!r) throw new Error("unexpected extra call")
    for (const t of r.stream ?? (r.content ? [r.content] : [])) onText(t)
    return { content: r.content, toolCalls: r.toolCalls }
  }
  return { chat, requests }
}

const lookup = defineTool({
  name: "lookup",
  description: "Looks up q.",
  schema: z.object({ q: z.string() }),
  label: (a) => `Looking up ${a.q}…`,
  run: async (a) => ({ rows: [a.q] }),
})

const toolCall = (id: string, q: string) => ({ id, name: "lookup", arguments: JSON.stringify({ q }) })

async function run(chat: ChatFn, extra: Partial<AgentOptions> = {}) {
  const events: AgentEvent[] = []
  await runAgent({
    history: [{ role: "user", content: "hi" }],
    systemPrompt: "SYS",
    chat,
    tools: [lookup],
    ctx,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
    model: "m",
    ...extra,
  })
  return events
}

describe("runAgent", () => {
  it("answers directly when no tools are needed", async () => {
    const { chat, requests } = scripted([{ content: "Hello", toolCalls: [] }])
    expect(await run(chat)).toEqual([
      { type: "delta", text: "Hello" },
      { type: "done", rounds: 1, model: "m" },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0].toolChoice).toBe("auto")
    expect(requests[0].messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "hi" }])
    expect(requests[0].tools?.[0].function.name).toBe("lookup")
  })

  it("runs tools, feeds results back, then answers", async () => {
    const { chat, requests } = scripted([
      { content: "", toolCalls: [toolCall("c1", "civic")] },
      { content: "Civic done.", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(events).toEqual([
      { type: "status", tool: "lookup", label: "Looking up civic…", round: 1 },
      { type: "delta", text: "Civic done." },
      { type: "done", rounds: 2, model: "m" },
    ])
    expect(requests[1].messages.slice(2)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"civic"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: '{"rows":["civic"]}' },
    ])
  })

  it("runs parallel calls and keeps their order", async () => {
    const { chat, requests } = scripted([
      { content: "", toolCalls: [toolCall("a", "one"), toolCall("b", "two")] },
      { content: "ok", toolCalls: [] },
    ])
    await run(chat)
    const toolMessages = requests[1].messages.filter((m) => m.role === "tool")
    expect(toolMessages).toEqual([
      { role: "tool", tool_call_id: "a", content: '{"rows":["one"]}' },
      { role: "tool", tool_call_id: "b", content: '{"rows":["two"]}' },
    ])
  })

  it("resets text streamed before tool calls", async () => {
    const { chat } = scripted([
      { content: "Let me check.", toolCalls: [toolCall("c1", "x")] },
      { content: "Done.", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(events.slice(0, 3)).toEqual([
      { type: "delta", text: "Let me check." },
      { type: "reset" },
      { type: "status", tool: "lookup", label: "Looking up x…", round: 1 },
    ])
  })

  it("forces a final answer after the default number of tool rounds", async () => {
    const n = MAX_TOOL_ROUNDS
    const rounds = Array.from({ length: n }, (_, i) => ({ content: "", toolCalls: [toolCall(`c${i}`, `q${i}`)] }))
    const { chat, requests } = scripted([...rounds, { content: "Best effort.", toolCalls: [] }])
    const events = await run(chat)
    expect(requests).toHaveLength(n + 1)
    expect(requests[n].toolChoice).toBe("none")
    expect(requests[n].messages.at(-1)).toEqual({ role: "user", content: FINAL_NUDGE })
    expect(events.at(-1)).toEqual({ type: "done", rounds: n + 1, model: "m" })
    expect(events.filter((e) => e.type === "status")).toHaveLength(n)
  })

  it("honours a configured number of rounds", async () => {
    const rounds = Array.from({ length: 3 }, (_, i) => ({ content: "", toolCalls: [toolCall(`c${i}`, `q${i}`)] }))
    const { chat, requests } = scripted([...rounds, { content: "Best effort.", toolCalls: [] }])
    const events = await run(chat, { maxRounds: 3 })
    expect(requests).toHaveLength(4)
    expect(requests[3].toolChoice).toBe("none")
    expect(events.at(-1)).toEqual({ type: "done", rounds: 4, model: "m" })
  })

  it("falls back when the final answer is empty", async () => {
    const rounds = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => ({ content: "", toolCalls: [toolCall(`c${i}`, "q")] }))
    // A server that ignores tool_choice "none" and calls a tool anyway.
    const { chat } = scripted([...rounds, { content: "", toolCalls: [toolCall("c9", "q")] }])
    const events = await run(chat)
    expect(events.slice(-2)).toEqual([
      { type: "delta", text: EMPTY_ANSWER },
      { type: "done", rounds: MAX_TOOL_ROUNDS + 1, model: "m" },
    ])
  })

  it("falls back when a text-only round is blank", async () => {
    const { chat } = scripted([{ content: "  ", toolCalls: [], stream: [] }])
    expect(await run(chat)).toEqual([
      { type: "delta", text: EMPTY_ANSWER },
      { type: "done", rounds: 1, model: "m" },
    ])
  })

  it("sends at most the last 20 history messages", async () => {
    const history: HistoryMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }))
    history.push({ role: "user", content: "last" })
    const { chat, requests } = scripted([{ content: "ok", toolCalls: [] }])
    await run(chat, { history })
    expect(requests[0].messages).toHaveLength(21)
    expect(requests[0].messages.at(-1)).toEqual({ role: "user", content: "last" })
  })

  it("caps tool calls per round at 8, answering the rest with an error", async () => {
    const calls = Array.from({ length: 10 }, (_, i) => toolCall(`c${i}`, `q${i}`))
    const { chat, requests } = scripted([
      { content: "", toolCalls: calls },
      { content: "ok", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(events.filter((e) => e.type === "status")).toHaveLength(8)
    const toolMessages = requests[1].messages.flatMap((m) => (m.role === "tool" ? [m] : []))
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(calls.map((c) => c.id))
    expect(toolMessages[7].content).toBe('{"rows":["q7"]}')
    expect(JSON.parse(toolMessages[8].content)).toEqual({ error: "Too many tool calls in one turn — at most 8." })
    expect(JSON.parse(toolMessages[9].content).error).toMatch(/at most 8/)
  })

  it("rejects without another call when aborted during tools", async () => {
    const controller = new AbortController()
    const aborting = defineTool({
      name: "lookup",
      description: "d",
      schema: z.object({ q: z.string() }),
      label: () => "…",
      run: async () => {
        controller.abort()
        return {}
      },
    })
    const { chat, requests } = scripted([{ content: "", toolCalls: [toolCall("c1", "x")] }])
    const events: AgentEvent[] = []
    await expect(run(chat, { tools: [aborting], signal: controller.signal, emit: (e) => events.push(e) })).rejects.toThrow()
    expect(requests).toHaveLength(1)
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("lets provider errors propagate", async () => {
    const chat: ChatFn = async () => {
      throw new Error("boom")
    }
    await expect(run(chat)).rejects.toThrow("boom")
  })
})

describe("runAgent link check", () => {
  it("asks the model again when an answer links a record no tool returned", async () => {
    const { chat, requests } = scripted([
      { content: "VIN is X, see [Truck](/assets/vehicles/fake9).", toolCalls: [] },
      { content: "", toolCalls: [toolCall("c1", "/assets/vehicles/real1")] },
      { content: "VIN is Y, see [Truck](/assets/vehicles/real1).", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(requests[1].messages.slice(-2)).toEqual([
      { role: "assistant", content: "VIN is X, see [Truck](/assets/vehicles/fake9)." },
      { role: "user", content: recheckNudge(["/assets/vehicles/fake9"]) },
    ])
    expect(events).toContainEqual({ type: "reset", reason: "recheck" })
    expect(events).toContainEqual({ type: "status", tool: "verify", label: "Double-checking the answer…", round: 1 })
    expect(events.at(-2)).toEqual({ type: "delta", text: "VIN is Y, see [Truck](/assets/vehicles/real1)." })
    expect(events.at(-1)).toEqual({ type: "done", rounds: 3, model: "m" })
  })

  it("drops a link to a page type that doesn't exist without re-asking, once data was looked up", async () => {
    const { chat, requests } = scripted([
      { content: "", toolCalls: [toolCall("c1", "/assets/people/p1")] },
      { content: "Refill [Lisinopril](/assets/medications/m1) for [Sam](/assets/people/p1).", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(requests).toHaveLength(2)
    expect(events.some((e) => e.type === "status" && e.tool === "verify")).toBe(false)
    expect(events.slice(-3)).toEqual([
      { type: "reset" },
      { type: "delta", text: "Refill Lisinopril for [Sam](/assets/people/p1)." },
      { type: "done", rounds: 2, model: "m" },
    ])
  })

  it("still re-asks about an impossible link when nothing was looked up", async () => {
    const { chat, requests } = scripted([
      { content: "[Lisinopril](/assets/medications/m1)", toolCalls: [] },
      { content: "Lisinopril", toolCalls: [] },
    ])
    await run(chat)
    expect(requests).toHaveLength(2)
    expect(requests[1].messages.at(-1)).toEqual({ role: "user", content: recheckNudge(["/assets/medications/m1"]) })
  })

  it("re-checks only once, then unlinks what still doesn't check out", async () => {
    const { chat } = scripted([
      { content: "[A](/assets/people/x1)", toolCalls: [] },
      { content: "Still [A](/assets/people/x1)", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(events.slice(-3)).toEqual([
      { type: "reset" },
      { type: "delta", text: "Still A" },
      { type: "done", rounds: 2, model: "m" },
    ])
  })

  it("unlinks instead of re-asking when no rounds are left", async () => {
    const { chat, requests } = scripted([{ content: "[A](/assets/people/x1) ok", toolCalls: [] }])
    const events = await run(chat, { maxRounds: 1 })
    expect(requests).toHaveLength(1)
    expect(events.slice(-2)).toEqual([
      { type: "delta", text: "A ok" },
      { type: "done", rounds: 1, model: "m" },
    ])
  })

  it("leaves verified links alone", async () => {
    const { chat } = scripted([
      { content: "", toolCalls: [toolCall("c1", "/assets/vehicles/real1")] },
      { content: "[A](/assets/vehicles/real1)", toolCalls: [] },
    ])
    const events = await run(chat)
    expect(events.filter((e) => e.type === "reset")).toEqual([])
  })

  it("lets a tool send its own event to the page", async () => {
    const shout = defineTool({
      name: "shout",
      description: "Emits.",
      schema: z.object({}),
      label: () => "Shouting…",
      run: async (_a, c) => {
        c.emit?.({ type: "status", tool: "shout", label: "from the tool", round: 0 })
        return { ok: true }
      },
    })
    const { chat } = scripted([
      { content: "", toolCalls: [{ id: "c1", name: "shout", arguments: "{}" }] },
      { content: "Done", toolCalls: [] },
    ])
    const events = await run(chat, { tools: [shout] })
    expect(events).toContainEqual({ type: "status", tool: "shout", label: "from the tool", round: 0 })
  })
})
