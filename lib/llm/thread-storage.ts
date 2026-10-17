import { MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } from "./request-schema"
import type { HistoryMessage } from "./types"
import { cardId, cardSubject, cardSummaryLine, isChangeCard, isChatCard, type CardPatch, type ChatCard } from "../observation-cards"

// The chat thread lives only in this tab's sessionStorage — never on the
// server. Storage can be missing or throw (private mode, blocked site data), so
// every access is guarded and a failure just means an empty or unsaved thread.

type ThreadStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null

export const SEND_LIMIT = 20

/**
 * A message as the page keeps it. `discarded` is a first answer that was
 * thrown out by the link check; it is shown struck through and never sent.
 * `cards` are the observation cards the answer produced (adds, edits, deletes), with their state.
 */
export type ThreadMessage = HistoryMessage & { discarded?: string; cards?: ChatCard[] }

export const CARD_ONLY_TEXT = "Here's a card. Check it and confirm it, or tell me what to change."
export const CARD_REVISED_TEXT = "Updated the card above. Check it and confirm it."
export const CARD_LOCKED_TEXT = "That card was already used, so it can't be changed here. Ask me for a new change."

export function threadKey(userId: string) {
  return `hc.chat.${userId}`
}

function isMessage(m: unknown): m is ThreadMessage {
  const v = m as ThreadMessage | null
  return !!v && (v.role === "user" || v.role === "assistant") && typeof v.content === "string" && v.content.length > 0
}

export function loadThread(storage: ThreadStorage, userId: string): ThreadMessage[] {
  try {
    const raw = storage?.getItem(threadKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isMessage)
      .map((m) => {
        const cards = Array.isArray(m.cards) ? m.cards.filter(isChatCard) : []
        return {
          role: m.role,
          content: m.content,
          ...(typeof m.discarded === "string" && m.discarded ? { discarded: m.discarded } : {}),
          ...(cards.length ? { cards } : {}),
        }
      })
  } catch {
    return []
  }
}

export function saveThread(storage: ThreadStorage, userId: string, messages: ThreadMessage[]) {
  try {
    storage?.setItem(threadKey(userId), JSON.stringify(messages))
  } catch {
    // quota or blocked — the thread still works for this page view
  }
}

export function clearThread(storage: ThreadStorage, userId: string) {
  try {
    storage?.removeItem(threadKey(userId))
  } catch {
    // nothing to do
  }
}

/**
 * Adds a finished answer and its cards. A card whose id is already in the
 * thread revises that card in place while it is unsaved; a saved or
 * discarded card stays as it is.
 */
export function mergeCards(thread: ThreadMessage[], answer: ThreadMessage, cards: ChatCard[]): ThreadMessage[] {
  const fresh: ChatCard[] = []
  const all = thread.flatMap((m) => m.cards ?? [])
  const existing = new Map(all.map((c) => [cardId(c), cardSubject(c)]))
  const states = new Map(all.map((c) => [cardId(c), c.state]))
  const used = new Set(all.map(cardId))
  const uniqueId = (id: string) => {
    for (let n = 2; ; n++) if (!used.has(`${id}-${n}`)) return `${id}-${n}`
  }
  let next = thread
  const withId = (c: ChatCard, id: string): ChatCard => (isChangeCard(c) ? { ...c, id } : { ...c, draft: { ...c.draft, draftId: id } })
  for (const c of cards) {
    const id = cardId(c)
    // An id reused for another subject, or for a change whose card is already used, is a new card, not a revision.
    const inThread = existing.has(id)
    const otherSubject = inThread && existing.get(id) !== cardSubject(c)
    const usedChange = inThread && !otherSubject && isChangeCard(c) && states.get(id) !== "draft"
    if (otherSubject || usedChange) {
      const fresher = uniqueId(id)
      used.add(fresher)
      fresh.push(withId(c, fresher))
      continue
    }
    if (!inThread) {
      // The same id twice in one answer: the later card replaces the earlier.
      const i = fresh.findIndex((x) => cardId(x) === id)
      if (i < 0) fresh.push(c)
      else fresh[i] = c
      continue
    }
    next = next.map((m) =>
      m.cards?.some((x) => cardId(x) === id)
        ? { ...m, cards: m.cards.map((x) => (cardId(x) === id && x.state === "draft" ? c : x)) }
        : m,
    )
  }
  const unsaved = new Set(thread.flatMap((m) => m.cards ?? []).filter((c) => c.state === "draft").map(cardId))
  const revised = cards.some((c) => unsaved.has(cardId(c)) && existing.get(cardId(c)) === cardSubject(c))
  const content = answer.content.trim()
    ? answer.content
    : fresh.length
      ? CARD_ONLY_TEXT
      : revised
        ? CARD_REVISED_TEXT
        : cards.length
          ? CARD_LOCKED_TEXT
          : answer.content
  return [...next, { ...answer, content, ...(fresh.length ? { cards: fresh } : {}) }]
}

/** Patches the newest card with this id (ids are unique, so that is the card). */
export function updateCard(thread: ThreadMessage[], id: string, patch: CardPatch): ThreadMessage[] {
  const mi = thread.findLastIndex((m) => m.cards?.some((c) => cardId(c) === id))
  if (mi < 0) return thread
  const ci = thread[mi].cards!.findLastIndex((c) => cardId(c) === id)
  return thread.map((m, i) =>
    i === mi ? { ...m, cards: m.cards!.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : m,
  )
}

const startOnUser = <T extends HistoryMessage>(ms: T[]): T[] => {
  const i = ms.findIndex((m) => m.role === "user")
  return i < 0 ? [] : ms.slice(i)
}

/**
 * What to send, within the server's limits: the recent tail, alternating roles
 * (adjacent same-role messages — e.g. a retried question — are merged), each
 * message and the total capped, starting on a user turn.
 */
type Piece = { role: HistoryMessage["role"]; text: string; keepEnd: boolean; summaries: string[] }

/** Cuts text to `room` characters: the start for a single message, the end once merged (the newest words matter most). */
const fit = (text: string, room: number, keepEnd: boolean) => {
  if (room <= 0) return ""
  if (text.length <= room) return text
  return keepEnd ? text.slice(text.length - room) : text.slice(0, room)
}

/**
 * Text, then the card summaries. The summaries carry the draft ids the model
 * revises by, so they are always kept; if they alone exceed the cap, the newest
 * lines that fit are kept and the text is dropped.
 */
function compose({ text, keepEnd, summaries }: Piece): string {
  const kept: string[] = []
  let used = 0
  for (const line of [...summaries].reverse()) {
    const cost = line.length + (kept.length ? 1 : 0)
    if (used + cost > MAX_MESSAGE_CHARS) break
    kept.unshift(line)
    used += cost
  }
  if (!kept.length) return fit(text, MAX_MESSAGE_CHARS, keepEnd)
  const block = kept.join("\n")
  const head = fit(text, MAX_MESSAGE_CHARS - block.length - 2, keepEnd)
  return head ? `${head}\n\n${block}` : block
}

export function requestMessages(thread: ThreadMessage[]): HistoryMessage[] {
  const pieces: Piece[] = []
  for (const m of startOnUser(thread.slice(-SEND_LIMIT))) {
    const text = m.content.slice(0, MAX_MESSAGE_CHARS)
    const summaries = m.cards?.map(cardSummaryLine) ?? []
    const prev = pieces.at(-1)
    if (prev?.role === m.role) {
      prev.text = `${prev.text}\n\n${text}`
      prev.keepEnd = true
      prev.summaries.push(...summaries)
    } else pieces.push({ role: m.role, text, keepEnd: false, summaries })
  }
  const merged: HistoryMessage[] = pieces.map((p) => ({ role: p.role, content: compose(p) }))
  let total = merged.reduce((n, m) => n + m.content.length, 0)
  while (merged.length > 1 && total > MAX_TOTAL_CHARS) total -= merged.shift()!.content.length
  return startOnUser(merged)
}

/** A turn that started before "New chat" must not write into the new thread. */
export function shouldPersist(startedGeneration: number, currentGeneration: number) {
  return startedGeneration === currentGeneration
}
