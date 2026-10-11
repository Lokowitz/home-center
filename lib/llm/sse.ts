import { LlmError } from "./errors"
import type { ChatResult } from "./types"

/** Splits decoded SSE text into `data:` payloads, however the chunks fall. */
export function createSseParser(onData: (data: string) => void) {
  let buffer = ""
  const line = (l: string) => {
    if (l.startsWith("data:")) onData(l.slice(5).trimStart())
  }
  return {
    feed(chunk: string) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      lines.forEach(line)
    },
    flush() {
      line(buffer)
      buffer = ""
    },
  }
}

type DeltaChunk = {
  error?: { message?: string }
  choices?: {
    finish_reason?: string | null
    delta?: {
      content?: string | null
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
    }
  }[]
}

/**
 * Folds streamed chat.completion.chunk payloads into one result. Tool calls
 * arrive as fragments keyed by `index`; some local servers omit the index and
 * send each call whole, so a new id (or no calls yet) starts a new call.
 */
export function createDeltaAccumulator(onText: (text: string) => void) {
  let content = ""
  let finishReason: string | undefined
  const calls: { id: string; name: string; arguments: string }[] = []

  return {
    /** Returns true once the stream's [DONE] marker arrives. */
    push(data: string): boolean {
      if (data === "[DONE]") return true
      let chunk: DeltaChunk
      try {
        chunk = JSON.parse(data)
      } catch {
        return false
      }
      if (chunk.error) throw new LlmError(chunk.error.message ?? "The LLM provider reported an error.")
      if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
      const delta = chunk.choices?.[0]?.delta
      if (!delta) return false
      if (delta.content) {
        content += delta.content
        onText(delta.content)
      }
      for (const tc of delta.tool_calls ?? []) {
        const i =
          tc.index ??
          (calls.length === 0 || (tc.id && !calls.some((c) => c.id === tc.id)) ? calls.length : calls.length - 1)
        const call = (calls[i] ??= { id: "", name: "", arguments: "" })
        if (tc.id) call.id = tc.id
        if (tc.function?.name) call.name = tc.function.name
        if (tc.function?.arguments) call.arguments += tc.function.arguments
      }
      return false
    },
    result(): ChatResult {
      return {
        content,
        toolCalls: calls
          .filter((c) => c && c.name)
          .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments })),
        ...(finishReason ? { finishReason } : {}),
      }
    },
  }
}
