import { describe, expect, it, vi } from "vitest"
import { createChatClient, type ClientConfig } from "./client"
import { LlmError } from "./errors"

const config: ClientConfig = { baseUrl: "http://llm/v1", apiKey: "sk-test", model: "m", temperature: 0.1, maxTokens: null }

function sseResponse(payloads: string[]) {
  const body = payloads.map((p) => `data: ${p}\n\n`).join("")
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(c) {
        // Odd-sized chunks so lines and JSON split mid-way.
        for (let i = 0; i < body.length; i += 7) c.enqueue(enc.encode(body.slice(i, i + 7)))
        c.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  )
}

const delta = (d: object) => JSON.stringify({ choices: [{ delta: d }] })
const signal = () => new AbortController().signal

describe("createChatClient", () => {
  it("posts an OpenAI-shaped streaming request", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([delta({ content: "hi" }), "[DONE]"]))
    const chat = createChatClient(config, fetchImpl as unknown as typeof fetch)
    const tools = [{ type: "function" as const, function: { name: "t", description: "d", parameters: {} } }]
    await chat({ messages: [{ role: "user", content: "q" }], tools, toolChoice: "none" }, () => {}, signal())

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://llm/v1/chat/completions")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test")
    expect(JSON.parse(init.body as string)).toEqual({
      model: "m",
      messages: [{ role: "user", content: "q" }],
      stream: true,
      tools,
      tool_choice: "none",
      temperature: 0.1,
    })
  })

  it("omits Authorization and tools when not needed", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(["[DONE]"]))
    const chat = createChatClient({ ...config, apiKey: null }, fetchImpl as unknown as typeof fetch)
    await chat({ messages: [] }, () => {}, signal())
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(JSON.parse(init.body as string).tools).toBeUndefined()
  })

  it("merges extra body fields without letting them override the core request", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(["[DONE]"]))
    const extraBody = { chat_template_kwargs: { enable_thinking: true }, model: "hijack", stream: false }
    const chat = createChatClient({ ...config, extraBody }, fetchImpl as unknown as typeof fetch)
    await chat({ messages: [] }, () => {}, signal())
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(body.model).toBe("m")
    expect(body.stream).toBe(true)
  })

  describe("no-output timeout", () => {
    const enc = new TextEncoder()
    const chunk = (text: string) => enc.encode(`data: ${delta({ content: text })}\n\n`)
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

    it("keeps going while a slow stream keeps sending", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(
          new ReadableStream({
            async start(c) {
              for (const t of ["a", "b", "c", "d"]) {
                await wait(30)
                c.enqueue(chunk(t))
              }
              c.close()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
      )
      const chat = createChatClient({ ...config, idleTimeoutMs: 60 }, fetchImpl as unknown as typeof fetch)
      expect((await chat({ messages: [] }, () => {}, signal())).content).toBe("abcd")
    })

    it("fails when the stream goes quiet", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(new ReadableStream({ start: (c) => c.enqueue(chunk("a")) }), {
          headers: { "Content-Type": "text/event-stream" },
        })
      )
      const chat = createChatClient({ ...config, idleTimeoutMs: 50 }, fetchImpl as unknown as typeof fetch)
      await expect(chat({ messages: [] }, () => {}, signal())).rejects.toThrow(/stopped responding/)
    })

    it("waits past the no-output limit for the first byte", async () => {
      const fetchImpl = vi.fn(async () => {
        await wait(120) // prompt processing / model load: no bytes yet
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(chunk("hi"))
              c.close()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
      })
      const chat = createChatClient({ ...config, idleTimeoutMs: 50 }, fetchImpl as unknown as typeof fetch)
      expect((await chat({ messages: [] }, () => {}, signal())).content).toBe("hi")
    })

    it("leaves a server that never answers to the caller's time limit", async () => {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))
      )
      const chat = createChatClient({ ...config, idleTimeoutMs: 50 }, fetchImpl as unknown as typeof fetch)
      const limit = AbortSignal.timeout(150)
      await expect(chat({ messages: [] }, () => {}, limit)).rejects.not.toBeInstanceOf(LlmError)
      expect(limit.aborted).toBe(true)
    })
  })

  it("streams text and assembles tool calls", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        delta({ content: "Let me " }),
        delta({ content: "check." }),
        delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: '{"query":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"civic"}' } }] }),
        "[DONE]",
      ])
    )
    const live: string[] = []
    const chat = createChatClient(config, fetchImpl as unknown as typeof fetch)
    const result = await chat({ messages: [] }, (t) => live.push(t), signal())
    expect(live.join("")).toBe("Let me check.")
    expect(result).toEqual({
      content: "Let me check.",
      toolCalls: [{ id: "c1", name: "search", arguments: '{"query":"civic"}' }],
    })
  })

  it("accepts a non-streaming JSON reply", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: "x", function: { name: "search", arguments: "{}" } }] } }],
      })
    )
    const chat = createChatClient(config, fetchImpl as unknown as typeof fetch)
    expect(await chat({ messages: [] }, () => {}, signal())).toEqual({
      content: "",
      toolCalls: [{ id: "x", name: "search", arguments: "{}" }],
    })
  })

  it("reports why a reply ended, streamed or not", async () => {
    const streamed = vi.fn(async () => sseResponse([delta({ content: "{" }), JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] }), "[DONE]"]))
    expect((await createChatClient(config, streamed as unknown as typeof fetch)({ messages: [] }, () => {}, signal())).finishReason).toBe("length")
    const json = vi.fn(async () => Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }] }))
    expect((await createChatClient(config, json as unknown as typeof fetch)({ messages: [] }, () => {}, signal())).finishReason).toBe("length")
  })

  it("translates HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }))
    const chat = createChatClient(config, fetchImpl as unknown as typeof fetch)
    await expect(chat({ messages: [] }, () => {}, signal())).rejects.toThrow(/API key/)
    await expect(chat({ messages: [] }, () => {}, signal())).rejects.toBeInstanceOf(LlmError)
  })

  it("translates network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })
    })
    const chat = createChatClient(config, fetchImpl as unknown as typeof fetch)
    await expect(chat({ messages: [] }, () => {}, signal())).rejects.toThrow("Couldn't reach the LLM server at llm.")
  })

  it("rethrows aborts untranslated", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError")
    })
    const chat = createChatClient(config, fetchImpl as unknown as typeof fetch)
    await expect(chat({ messages: [] }, () => {}, controller.signal)).rejects.not.toBeInstanceOf(LlmError)
  })
})
