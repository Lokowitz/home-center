// Local-AI receipt reading: the prompt, the request options, reply validation,
// and the one-shot call with its fallbacks. Pure — the caller injects the chat
// function (built from the user's LLM settings).
import { LlmError } from "@/lib/llm/errors"
import type { ChatFn } from "@/lib/llm/types"
import type { ParseNote } from "@/lib/inbox"
import type { ParsedReceipt } from "./parse"
import { DEFAULT_REGIONAL } from "@/lib/regional"
import { parseAmount } from "./amount"

export function receiptPrompt(currency: string): string {
  return `You read one household document (receipt, invoice, estimate or similar).
Reply with JSON only: {"date": "YYYY-MM-DD" or null, "total": number or null, "vendor": string or null}
date: the date the purchase, service, visit or test happened (not a due date, print date or date of birth).
total: the final amount charged as a plain number with a dot for decimals (grand total incl. tax; negative for a refund). The household's currency is ${currency}. null if the document shows no charge.
vendor: the business, clinic or provider that issued it.`
}
export const PROMPT = receiptPrompt(DEFAULT_REGIONAL.currency)

export const MAX_TEXT_CHARS = 12000
const MAX_VENDOR_CHARS = 80

/**
 * The answer is about 50 tokens. The cap is the chat setting's business for
 * chat, not here: a low one cuts the JSON short, and with thinking on a
 * reasoning model can spend any cap before it answers (seen with Qwen 3.5:
 * finish "length", empty content). Generous enough for a model that thinks
 * anyway, small enough that a runaway reply ends.
 */
export const RECEIPT_MAX_TOKENS = 1024

function validDate(v: unknown): string | null {
  if (typeof v !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return null
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? v.trim() : null
}

function validTotal(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  return typeof v === "string" ? parseAmount(v) : null
}

function validVendor(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s && s.length <= MAX_VENDOR_CHARS ? s : null
}

/** Pull {date,total,vendor} out of a model reply; null when it holds no JSON object. */
export function parseLlmReply(reply: string): ParsedReceipt | null {
  // Reasoning models may think aloud first, and braces in that text would
  // otherwise be taken for the answer.
  const body = reply.replace(/<think>[\s\S]*?<\/think>/gi, "")
  const m = body.match(/\{[\s\S]*\}/)
  if (!m) return null
  let obj: unknown
  try {
    obj = JSON.parse(m[0])
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  const o = obj as Record<string, unknown>
  return { date: validDate(o.date), total: validTotal(o.total), vendor: validVendor(o.vendor) }
}

/**
 * The model's answer, with any field it left empty taken from the built-in
 * parser. A model often answers null where the parser has a fair guess (a lab
 * report's date), and an empty field helps no one.
 */
export function fillFromBasic(llm: ParsedReceipt, basic: ParsedReceipt): ParsedReceipt {
  return { date: llm.date ?? basic.date, total: llm.total ?? basic.total, vendor: llm.vendor ?? basic.vendor }
}

/**
 * The chat client options for one receipt read, whatever the chat settings
 * say: temperature 0 and RECEIPT_MAX_TOKENS. With `thinkingOff`, also asks
 * chat-template servers (llama.cpp, vLLM) not to think, keeping the user's
 * other extra request fields.
 */
export function receiptChatOptions(extraBody: Record<string, unknown> | null, opts: { thinkingOff: boolean }) {
  let body = extraBody
  if (opts.thinkingOff) {
    const kwargs = extraBody?.chat_template_kwargs
    const own = kwargs && typeof kwargs === "object" && !Array.isArray(kwargs) ? (kwargs as Record<string, unknown>) : {}
    body = { ...extraBody, chat_template_kwargs: { ...own, enable_thinking: false } }
  }
  return { temperature: 0, maxTokens: RECEIPT_MAX_TOKENS, extraBody: body }
}

/** A short, fixed description of a failed request for the log. Never the provider's text (it may echo the receipt). */
export function llmFailureDetail(error: unknown): string {
  if (error instanceof LlmError) {
    if (error.status) return `http ${error.status}`
    if (error.message.startsWith("Couldn't reach the LLM server")) return "unreachable"
    if (error.message.startsWith("The LLM server stopped responding")) return "stalled"
    if (error.message.startsWith("The LLM server took too long")) return "timeout"
    return "LlmError"
  }
  if (error instanceof Error || error instanceof DOMException) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout"
    return error.name
  }
  return typeof error
}

export type LlmReceiptRead = { parsed: ParsedReceipt } | { note: Extract<ParseNote, "llm-failed" | "llm-no-answer">; detail: string }

async function ask(chat: ChatFn, text: string, signal: AbortSignal, currency: string) {
  let streamed = ""
  const result = await chat(
    { messages: [{ role: "system", content: receiptPrompt(currency) }, { role: "user", content: text.slice(0, MAX_TEXT_CHARS) }] },
    (t) => {
      streamed += t
    },
    signal,
  )
  return { reply: result.content || streamed, finishReason: result.finishReason ?? null }
}

/**
 * Read a receipt with the LLM. `makeChat` builds the chat function for the
 * request options (see receiptChatOptions); thinking is asked off first, and
 * if the server rejects that (HTTP 400) the read is retried once without it.
 * Never throws: a failure says why, in words safe to log and store.
 */
export async function readReceiptByLlm(
  text: string,
  makeChat: (opts: { thinkingOff: boolean }) => ChatFn,
  signal: AbortSignal = new AbortController().signal,
  currency: string = DEFAULT_REGIONAL.currency,
): Promise<LlmReceiptRead> {
  let answer: { reply: string; finishReason: string | null }
  try {
    try {
      answer = await ask(makeChat({ thinkingOff: true }), text, signal, currency)
    } catch (error) {
      if (!(error instanceof LlmError && error.status === 400)) throw error
      answer = await ask(makeChat({ thinkingOff: false }), text, signal, currency)
    }
  } catch (error) {
    return { note: "llm-failed", detail: llmFailureDetail(error) }
  }
  const parsed = parseLlmReply(answer.reply)
  if (parsed) return { parsed }
  return { note: "llm-no-answer", detail: `no JSON in reply (finish: ${answer.finishReason ?? "unknown"}, ${answer.reply.length} chars)` }
}
