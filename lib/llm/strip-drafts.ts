import type { HistoryMessage } from "./types"

const DRAFT_LINE = /^\[observation (?:draft|edit|delete) [^\n]*\]$/gm

/**
 * History with the [observation draft|edit|delete …] summary lines removed, for when Health
 * has been turned off since the thread was written. Messages left empty are
 * dropped, except the last one, which the model must answer.
 */
export function stripDraftLines(messages: HistoryMessage[]): HistoryMessage[] {
  return messages
    .map((m, i) => {
      const content = m.content.replace(DRAFT_LINE, "").trim()
      return { m, content: content || (i === messages.length - 1 ? m.content : "") }
    })
    .filter((x) => x.content)
    .map((x) => ({ ...x.m, content: x.content }))
}
