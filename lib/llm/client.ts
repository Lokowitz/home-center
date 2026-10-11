import { createDeltaAccumulator, createSseParser } from "./sse"
import { explainHttpError, explainNetworkError, LlmError } from "./errors"
import type { ChatFn, ChatResult } from "./types"

// A thin OpenAI-compatible Chat Completions client. Plain fetch rather than an
// SDK: the surface used is one endpoint, and it has to work against OpenAI,
// Ollama, LM Studio, OpenRouter and vLLM alike.

export type ClientConfig = {
  baseUrl: string
  apiKey: string | null
  model: string
  temperature: number | null
  maxTokens: number | null
  /** Provider-specific request fields, e.g. llama.cpp's chat_template_kwargs. Never overrides the core fields. */
  extraBody?: Record<string, unknown> | null
  /** Fail when the server sends nothing for this long; default IDLE_TIMEOUT_MS. */
  idleTimeoutMs?: number
}

/**
 * Once a reply has started streaming, it fails only if the server then goes
 * quiet this long — not after a fixed total — so a slow local model that keeps
 * streaming (answer or reasoning) is never cut off mid-answer. Waiting for the
 * first byte counts only against the per-question limit in the route.
 */
export const IDLE_TIMEOUT_MS = 60_000

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

type JsonCompletion = {
  choices?: {
    finish_reason?: string | null
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function: { name: string; arguments?: string } }[]
    }
  }[]
}

export function createChatClient(config: ClientConfig, fetchImpl: typeof fetch = fetch): ChatFn {
  const host = hostOf(config.baseUrl)

  const idleMs = config.idleTimeoutMs ?? IDLE_TIMEOUT_MS
  const stalled = () => new LlmError(`The LLM server stopped responding for ${Math.round(idleMs / 1000)} seconds — it may be busy. Try again.`)

  return async (req, onText, signal) => {
    const idle = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const touch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => idle.abort(new DOMException("No output from the server", "TimeoutError")), idleMs)
    }
    // Armed by the first streamed chunk, not here: before the server starts
    // answering (prompt processing, a cold model load) only the caller's
    // per-question limit applies.
    try {
      return await send(req, onText, signal, idle.signal, touch)
    } catch (error) {
      if (!signal.aborted && idle.signal.aborted) throw stalled()
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function send(
    req: Parameters<ChatFn>[0],
    onText: Parameters<ChatFn>[1],
    signal: AbortSignal,
    idleSignal: AbortSignal,
    touch: () => void
  ): Promise<ChatResult> {
    const body = {
      ...config.extraBody,
      model: config.model,
      messages: req.messages,
      stream: true,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" } : {}),
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
      ...(config.maxTokens != null ? { max_tokens: config.maxTokens } : {}),
    }

    let res: Response
    try {
      res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, idleSignal]),
      })
    } catch (error) {
      if (signal.aborted || idleSignal.aborted) throw error
      throw new LlmError(explainNetworkError(error, host))
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new LlmError(explainHttpError(res.status, text), res.status)
    }

    // Some servers ignore stream:true and answer with one JSON body.
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      const data = (await res.json()) as JsonCompletion
      const message = data.choices?.[0]?.message
      const content = message?.content ?? ""
      if (content) onText(content)
      const result: ChatResult = {
        content,
        toolCalls: (message?.tool_calls ?? []).map((c, i) => ({
          id: c.id || `call_${i}`,
          name: c.function.name,
          arguments: c.function.arguments ?? "",
        })),
        ...(data.choices?.[0]?.finish_reason ? { finishReason: data.choices[0].finish_reason } : {}),
      }
      return result
    }

    if (!res.body) throw new LlmError("The LLM server sent an empty response.")

    const acc = createDeltaAccumulator(onText)
    const parser = createSseParser((data) => {
      acc.push(data)
    })
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    // Don't rely on the fetch signal reaching the body: stop reading ourselves.
    const stop = () => void reader.cancel().catch(() => {})
    idleSignal.addEventListener("abort", stop, { once: true })
    signal.addEventListener("abort", stop, { once: true })
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        touch()
        parser.feed(value)
      }
      if (signal.aborted) throw signal.reason
      if (idleSignal.aborted) throw idleSignal.reason
      parser.flush()
    } catch (error) {
      if (signal.aborted || idleSignal.aborted || error instanceof LlmError) throw error
      throw new LlmError(explainNetworkError(error, host))
    } finally {
      idleSignal.removeEventListener("abort", stop)
      signal.removeEventListener("abort", stop)
    }
    return acc.result()
  }
}
