// Local-AI receipt reading: the prompt, reply validation, and an adapter from
// the streaming ChatFn. Pure — the chat function is injected by the caller.
import type { ChatFn } from "@/lib/llm/types"
import type { ParsedReceipt } from "./parse"

export const PROMPT = `You read one household document (receipt, invoice, estimate or similar).
Reply with JSON only: {"date": "YYYY-MM-DD" or null, "total": number or null, "vendor": string or null}
date: the invoice/service/purchase date (not a due date or print date).
total: the final amount charged (grand total incl. tax; negative for a refund). null if the document shows no charge.
vendor: the business that issued it.`

export const MAX_TEXT_CHARS = 12000
const MAX_VENDOR_CHARS = 80

export type AskFn = (system: string, user: string) => Promise<string>

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
  if (typeof v !== "string") return null
  const s = v.replace(/[$,\s]/g, "")
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
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

/** Ask the model to read a receipt. Errors from `ask` propagate so the caller can fall back. */
export async function llmParseReceipt(text: string, ask: AskFn): Promise<ParsedReceipt | null> {
  return parseLlmReply(await ask(PROMPT, text.slice(0, MAX_TEXT_CHARS)))
}

/** Adapt the streaming ChatFn to a one-shot AskFn (the model is fixed by the chat client's config). */
export function askViaChat(chat: ChatFn, signal: AbortSignal = new AbortController().signal): AskFn {
  return async (system, user) => {
    let streamed = ""
    const result = await chat(
      { messages: [{ role: "system", content: system }, { role: "user", content: user }] },
      (t) => {
        streamed += t
      },
      signal,
    )
    return result.content || streamed
  }
}
