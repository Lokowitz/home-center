import type { AssetType, CaptureParser, DocumentTextStatus } from "@/app/generated/prisma/client"
import type { MovePlan } from "@/lib/capture/move"

// Rules for the capture inbox that don't need the database or the disk. The
// server side (lib/capture-server.ts, lib/actions/inbox.ts) only wires these up.

/** An item whose upload never arrived is cleaned up after this long. */
export const EMPTY_ITEM_MAX_AGE_MS = 60 * 60 * 1000

export function isStaleEmptyItem(item: { createdAt: Date; attachmentCount: number }, now: Date = new Date()): boolean {
  return item.attachmentCount === 0 && now.getTime() - item.createdAt.getTime() > EMPTY_ITEM_MAX_AGE_MS
}

export type StoredText = { status: DocumentTextStatus; text: string | null; error: string | null }

export type InboxText =
  | { kind: "wait" }
  | { kind: "failed"; error: string }
  | { kind: "text"; text: string }

/**
 * What an item's files say once read. Waits for every file; fails only when
 * nothing was read and something failed. Files with no text (a photo with OCR
 * off) give an empty read, so the item is still ready to file by hand.
 * While indexing is off, unread files count as having no text.
 */
export function inboxText(texts: StoredText[], opts: { indexing: boolean } = { indexing: true }): InboxText {
  // With indexing off nothing will read a PENDING file, so waiting would be forever.
  if (!texts.length || (opts.indexing && texts.some((t) => t.status === "PENDING"))) return { kind: "wait" }
  const read = texts.filter((t) => t.status === "DONE" && t.text).map((t) => t.text as string)
  if (read.length) return { kind: "text", text: read.join("\f") }
  const failed = texts.find((t) => t.status === "FAILED")
  if (failed) return { kind: "failed", error: failed.error ?? "Couldn't read this file" }
  return { kind: "text", text: "" }
}

export type ParserChoice = "none" | "basic" | "llm"

/**
 * Local AI only when the assistant is ready, and never for a file that looks
 * like a person's unless health documents may go to the LLM.
 */
export function chooseParser(c: {
  mode: CaptureParser
  llmReady: boolean
  suggestedAssetType: AssetType | null
  healthDocumentsEnabled: boolean
}): ParserChoice {
  if (c.mode === "OFF") return "none"
  if (c.mode === "BASIC" || !c.llmReady) return "basic"
  if (c.suggestedAssetType === "PERSON" && !c.healthDocumentsEnabled) return "basic"
  return "llm"
}

/**
 * Why an item set to Local AI was read by the built-in parser instead. Stored
 * in InboxItem.parseNote so the card can say so, and logged; never holds
 * receipt text.
 */
export type ParseNote =
  /** The assistant (LLM) is off or missing its URL or model. */
  | "llm-not-ready"
  /** It looks like a person's file and health documents may not go to the LLM. */
  | "llm-health"
  /** The request failed: unreachable, an HTTP error, a timeout. */
  | "llm-failed"
  /** The model answered, but with no usable JSON (e.g. cut off while thinking). */
  | "llm-no-answer"

/** chooseParser's reason for "basic" when Local AI was chosen; null when it wasn't chosen or is used. */
export function llmSkipNote(c: Parameters<typeof chooseParser>[0]): ParseNote | null {
  if (c.mode !== "LLM") return null
  if (!c.llmReady) return "llm-not-ready"
  if (c.suggestedAssetType === "PERSON" && !c.healthDocumentsEnabled) return "llm-health"
  return null
}

/** The one server log line for every fallback from Local AI. `detail` must never carry receipt text. */
export function fallbackLogLine(note: ParseNote, detail?: string): string {
  const why = detail ? `${note}: ${detail.replace(/[\r\n]+/g, " ")}` : note
  return `[inbox] Local AI not used (${why}); read with the built-in parser`
}

export type ParsedReceiptLike = { date: string | null; total: number | null; vendor: string | null }

export function parsedFields(parsed: ParsedReceiptLike | null, method: "basic" | "llm" | null, note: ParseNote | null = null) {
  const date = parsed?.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? new Date(`${parsed.date}T00:00:00Z`) : null
  return {
    // A day like 2026-02-30 rolls over in Date; only keep it if it survives the round trip.
    parsedDate: date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === parsed?.date ? date : null,
    parsedTotal: parsed?.total ?? null,
    parsedVendor: parsed?.vendor ?? null,
    parseMethod: method,
    parseNote: note,
  }
}

/** The existing records an item can be attached to. */
export const ATTACH_KINDS = ["SERVICE", "WARRANTY"] as const
export type AttachKind = (typeof ATTACH_KINDS)[number]

export type FileTarget =
  | { kind: AttachKind; recordId: string }
  | { kind: "DOCUMENT"; assetType: AssetType; assetId: string }

/** The attachment columns once the file leaves the inbox; every other owner key is already null. */
export function filedAttachmentData(t: FileTarget) {
  switch (t.kind) {
    case "SERVICE":
      return { recordType: "SERVICE" as const, serviceRecordId: t.recordId, assetType: null, assetId: null, inboxItemId: null }
    case "WARRANTY":
      return { recordType: "WARRANTY" as const, warrantyId: t.recordId, serviceRecordId: null, assetType: null, assetId: null, inboxItemId: null }
    case "DOCUMENT":
      return { recordType: "DOCUMENT" as const, serviceRecordId: null, assetType: t.assetType, assetId: t.assetId, inboxItemId: null }
  }
}

/** The upload directory a filed file moves to: [recordType, recordId]. */
export function targetDir(t: FileTarget): { recordType: string; recordId: string } {
  return t.kind === "DOCUMENT" ? { recordType: "DOCUMENT", recordId: t.assetId } : { recordType: t.kind, recordId: t.recordId }
}

export type AttachCandidateLike = { id: string; date: Date | null; cost: number | null }

/** A service record (dated, maybe with a cost) or warranty (purchase date, no cost) offered in "Attach to record". */
export type AttachCandidate = AttachCandidateLike & { kind: AttachKind; title: string }

const DAY_MS = 24 * 60 * 60 * 1000
/** A record dated within this many days of the receipt is a plausible match. */
const NEAR_DAYS = 7

/**
 * Which existing record a receipt most likely belongs to, to preselect in
 * "Attach to record": the same total (to the cent) counts most, then the same
 * day, then a day within a week. Ties go to the closer day, then to a record
 * with a cost. Null when nothing matches at all; the user then picks.
 */
export function bestAttachMatch(
  candidates: AttachCandidateLike[],
  parsed: { date: Date | null; total: number | null }
): string | null {
  let best: { id: string; score: number; days: number; hasCost: boolean } | null = null
  for (const c of candidates) {
    const days = c.date && parsed.date ? Math.round(Math.abs(c.date.getTime() - parsed.date.getTime()) / DAY_MS) : Infinity
    const sameTotal = c.cost != null && parsed.total != null && Math.abs(c.cost - parsed.total) < 0.005
    const score = (sameTotal ? 3 : 0) + (days === 0 ? 2 : days <= NEAR_DAYS ? 1 : 0)
    if (score === 0) continue
    const hasCost = c.cost != null
    if (
      !best ||
      score > best.score ||
      (score === best.score && (days < best.days || (days === best.days && hasCost && !best.hasCost)))
    ) {
      best = { id: c.id, score, days, hasCost }
    }
  }
  return best?.id ?? null
}

export type MoveFs = {
  mkdir(dir: string): Promise<unknown>
  rename(from: string, to: string): Promise<void>
}

/**
 * Moves the files, then commits the database change. A failed move or commit
 * moves back whatever had moved (latest first) and rethrows the first error,
 * so the files always end up where the database says they are.
 */
export async function moveWithRollback<T>(
  plans: MovePlan[],
  fs: MoveFs,
  commit: () => Promise<T>,
  onUndoError: (error: unknown, plan: MovePlan) => void = () => {}
): Promise<T> {
  const moved: MovePlan[] = []
  const undo = async () => {
    for (const p of [...moved].reverse()) {
      try {
        await fs.rename(p.toPath, p.fromPath)
      } catch (error) {
        onUndoError(error, p)
      }
    }
  }
  try {
    for (const dir of new Set(plans.map((p) => p.toDir))) await fs.mkdir(dir)
    for (const p of plans) {
      await fs.rename(p.fromPath, p.toPath)
      moved.push(p)
    }
  } catch (error) {
    await undo()
    throw error
  }
  try {
    return await commit()
  } catch (error) {
    await undo()
    throw error
  }
}
