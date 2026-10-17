import type { ToolContext } from "./query"
import { DEFAULT_TOOL_ROUNDS } from "./settings-schema"
import { EMPTY_ANSWER, FINAL_NUDGE, recheckNudge } from "./prompt"
import { impossibleLinks, unlink, unverifiedLinks } from "./link-check"
import { runToolCall, toOpenAiTools, toolLabel, type RegisteredTool } from "./tools/registry"
import type { AgentEvent, ChatFn, ChatMessage, HistoryMessage } from "./types"
import type { ChatRequest, ChatResult } from "./types"

export const MAX_TOOL_ROUNDS = DEFAULT_TOOL_ROUNDS
export const HISTORY_LIMIT = 20
export const MAX_CALLS_PER_ROUND = 8
const TOO_MANY_CALLS = JSON.stringify({ error: `Too many tool calls in one turn — at most ${MAX_CALLS_PER_ROUND}.` })

export type AgentOptions = {
  history: HistoryMessage[]
  systemPrompt: string
  chat: ChatFn
  tools: RegisteredTool[]
  ctx: ToolContext
  emit: (event: AgentEvent) => void
  signal: AbortSignal
  model: string
  maxRounds?: number
}

/**
 * Runs one streamed chat call and tracks whether text was emitted.
 */
async function runStreamedCall(chat: ChatFn, req: ChatRequest, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<{ result: ChatResult; streamed: boolean }> {
  let streamed = false
  const result = await chat(
    req,
    (text) => {
      streamed = true
      emit({ type: "delta", text })
    },
    signal
  )
  return { result, streamed }
}

/**
 * Finishes a turn. Links to records no tool returned are turned into plain text
 * (the streamed answer is replaced), and a blank answer gets the fallback text.
 */
function finishTurn(emit: (e: AgentEvent) => void, content: string, streamed: boolean, rounds: number, model: string, toolOutputs: string[]): void {
  const bad = unverifiedLinks(content, toolOutputs)
  const text = bad.length ? unlink(content, bad) : content
  if (!text.trim()) {
    if (streamed) emit({ type: "reset" })
    emit({ type: "delta", text: EMPTY_ANSWER })
  } else if (text !== content) {
    if (streamed) emit({ type: "reset" })
    emit({ type: "delta", text })
  }
  emit({ type: "done", rounds, model })
}

/**
 * Up to maxRounds of "model picks tools → we run them", stopping early as soon
 * as a round comes back with text only. If the model still wants tools after
 * the last round, one more call with tool_choice "none" forces an answer from
 * what was gathered. Provider errors throw; the route turns them into an event.
 */
export async function runAgent(o: AgentOptions): Promise<void> {
  const maxRounds = o.maxRounds ?? MAX_TOOL_ROUNDS
  const tools = toOpenAiTools(o.tools)
  const messages: ChatMessage[] = [{ role: "system", content: o.systemPrompt }, ...o.history.slice(-HISTORY_LIMIT)]
  // Everything tools returned during this question; answer links are checked against it.
  const toolOutputs: string[] = []
  let rechecked = false

  for (let round = 1; round <= maxRounds; round++) {
    const { result, streamed } = await runStreamedCall(o.chat, { messages, tools, toolChoice: "auto" }, o.emit, o.signal)

    if (result.toolCalls.length === 0) {
      let bad = unverifiedLinks(result.content, toolOutputs)
      // A link to a page type that doesn't exist (a medication, a provider, a
      // service record), in an answer written after looking the data up, is a
      // formatting slip — measured: the facts around it were right every time.
      // Those links are just dropped when the turn finishes; re-asking costs a
      // round for nothing.
      if (toolOutputs.length) bad = bad.filter((h) => !impossibleLinks([h]).length)
      // A made-up record link usually means made-up facts around it: give the
      // model one chance to look the records up, while rounds remain.
      if (bad.length && !rechecked && round < maxRounds) {
        rechecked = true
        if (streamed) o.emit({ type: "reset", reason: "recheck" })
        o.emit({ type: "status", tool: "verify", label: "Double-checking the answer…", round })
        messages.push({ role: "assistant", content: result.content }, { role: "user", content: recheckNudge(bad) })
        continue
      }
      finishTurn(o.emit, result.content, streamed, round, o.model, toolOutputs)
      return
    }

    // A "let me check" preface was streamed before the model decided to call tools.
    if (streamed) o.emit({ type: "reset" })

    messages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    })
    // Every call id still gets exactly one tool message; calls past the cap get an error.
    const outputs = await Promise.all(
      result.toolCalls.map((call, i) => {
        if (i >= MAX_CALLS_PER_ROUND) return TOO_MANY_CALLS
        o.emit({ type: "status", tool: call.name, label: toolLabel(o.tools, call), round })
        return runToolCall(o.tools, call, { ...o.ctx, emit: o.emit })
      })
    )
    // Returning quietly would end the stream without "done"; the route hides client aborts.
    if (o.signal.aborted) throw o.signal.reason ?? new Error("aborted")
    result.toolCalls.forEach((call, i) => messages.push({ role: "tool", tool_call_id: call.id, content: outputs[i] }))
    toolOutputs.push(...outputs)
  }

  // As a user message: strict chat templates reject a system message mid-conversation.
  messages.push({ role: "user", content: FINAL_NUDGE })
  const { result: final, streamed } = await runStreamedCall(o.chat, { messages, tools, toolChoice: "none" }, o.emit, o.signal)
  finishTurn(o.emit, final.content, streamed, maxRounds + 1, o.model, toolOutputs)
}
