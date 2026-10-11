import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { loadLlmConfig } from "@/lib/llm/config"
import { createChatClient } from "@/lib/llm/client"
import { isLlmReady, parseExtraBody } from "@/lib/llm/settings-schema"
import { DOCUMENT_SETTINGS_ID, loadDocumentSettings } from "@/lib/documents/settings"
import { parseReceipt, type ParsedReceipt } from "@/lib/capture/parse"
import { fillFromBasic, llmFailureDetail, readReceiptByLlm, receiptChatOptions, type LlmReceiptRead } from "@/lib/capture/llm-parse"
import { buildIdentifiers, matchAsset, type AssetMatch, type CandidateAsset } from "@/lib/capture/match"
import { RECORD_KINDS, semanticQueryText, suggestByMeaning, toAssetHits, type OwnerRef } from "@/lib/capture/semantic"
import { searchIndex, semanticSearchModel } from "@/lib/documents/indexer-server"
import { embedderFor } from "@/lib/documents/embed/server"
import { chooseParser, fallbackLogLine, inboxText, keptUserAsset, llmSkipNote, parsedFields, type ParseNote, type ParserChoice } from "@/lib/inbox"
import type { CaptureParser } from "@/app/generated/prisma/client"
import { loadHouseholdNames } from "@/lib/inbox-server"

// Reads a capture-inbox item once its files have been extracted: the receipt
// fields (per the "Receipt reading" setting) and the asset it's probably for.
// Runs from the indexer's processed hook, on upload when indexing is off, and
// from the inbox's "Re-read" button.

/** One receipt read by the LLM should never hold the item for long. */
const LLM_TIMEOUT_MS = 120_000

export async function loadCaptureParser(): Promise<CaptureParser> {
  const row = await prisma.documentSettings.findUnique({ where: { id: DOCUMENT_SETTINGS_ID }, select: { captureParser: true } })
  return row?.captureParser ?? "BASIC"
}

/** Every asset a receipt could be for. People only while Health is on. */
export async function loadCaptureCandidates(includePeople: boolean): Promise<CandidateAsset[]> {
  const [vehicles, properties, equipment, people] = await Promise.all([
    prisma.vehicle.findMany({ select: { id: true, name: true, make: true, model: true, vin: true } }),
    prisma.property.findMany({ select: { id: true, name: true, address: true } }),
    prisma.equipment.findMany({ select: { id: true, name: true, manufacturer: true, modelNumber: true, serialNumber: true } }),
    includePeople ? prisma.person.findMany({ select: { id: true, name: true } }) : Promise.resolve([]),
  ])
  return [
    ...vehicles.map((v): CandidateAsset => ({ assetType: "VEHICLE", id: v.id, name: v.name, identifiers: buildIdentifiers.vehicle(v) })),
    ...properties.map((p): CandidateAsset => ({ assetType: "PROPERTY", id: p.id, name: p.name, identifiers: buildIdentifiers.property(p) })),
    ...equipment.map((e): CandidateAsset => ({ assetType: "EQUIPMENT", id: e.id, name: e.name, identifiers: buildIdentifiers.equipment(e) })),
    ...people.map((p): CandidateAsset => ({ assetType: "PERSON", id: p.id, name: p.name, identifiers: buildIdentifiers.person(p) })),
  ]
}

/** Record chunks fetched by meaning before they vote for their assets. */
const SUGGEST_POOL = 40

/** The asset each SERVICE / WARRANTY / MAINTENANCE hit belongs to, keyed "KIND:id". */
async function loadRecordOwners(hits: { kind: string; entityId: string }[]): Promise<Map<string, OwnerRef>> {
  const ids = (kind: (typeof RECORD_KINDS)[number]) => [...new Set(hits.filter((h) => h.kind === kind).map((h) => h.entityId))]
  const select = { id: true, assetType: true, assetId: true } as const
  const [service, warranty, maintenance] = await Promise.all([
    prisma.serviceRecord.findMany({ where: { id: { in: ids("SERVICE") } }, select }),
    prisma.warranty.findMany({ where: { id: { in: ids("WARRANTY") } }, select }),
    prisma.maintenanceSchedule.findMany({ where: { id: { in: ids("MAINTENANCE") } }, select }),
  ])
  const owners = new Map<string, OwnerRef>()
  const add = (kind: string, rows: { id: string; assetType: OwnerRef["assetType"]; assetId: string }[]) => {
    for (const r of rows) owners.set(`${kind}:${r.id}`, { assetType: r.assetType, assetId: r.assetId })
  }
  add("SERVICE", service)
  add("WARRANTY", warranty)
  add("MAINTENANCE", maintenance)
  return owners
}

/**
 * Fallback when no identifier matched: the asset whose description or past
 * records read most like this receipt. Null when semantic search is off, its
 * vectors don't fit the model, nothing is close enough, or anything fails.
 * Only `candidates` can be suggested, so people stay out while Health is off.
 */
async function suggestFromMeaning(text: string, candidates: CandidateAsset[], allowPeople: boolean): Promise<AssetMatch | null> {
  try {
    const model = await semanticSearchModel()
    if (!model) return null
    const query = semanticQueryText(parseReceipt(text).vendor, text)
    if (!query) return null
    const vector = await embedderFor(model).embedQuery(query)
    const raw = await (await searchIndex()).entityVectorSearch(vector, SUGGEST_POOL)
    const known = new Set(candidates.map((c) => `${c.assetType}:${c.id}`))
    const hits = toAssetHits(raw, await loadRecordOwners(raw)).filter((h) => known.has(`${h.assetType}:${h.assetId}`))
    return suggestByMeaning(hits, { allowPeople })
  } catch (error) {
    // Never log the error text: it could carry the receipt's text.
    console.error("[inbox] suggestion by meaning failed, leaving it empty:", error instanceof Error ? error.name : typeof error)
    return null
  }
}

type ReceiptRead = { parsed: ParsedReceipt | null; method: "basic" | "llm" | null; note: ParseNote | null }

async function readWithLlm(text: string): Promise<LlmReceiptRead | { note: "llm-not-ready"; detail: string }> {
  const config = await loadLlmConfig()
  if (!isLlmReady(config) || !config.baseUrl || !config.model) return { note: "llm-not-ready", detail: "settings changed while reading" }
  const { baseUrl, model } = config
  const extraBody = parseExtraBody(config.extraBody)
  return readReceiptByLlm(
    text,
    (opts) => createChatClient({ baseUrl, apiKey: config.apiKey, model, ...receiptChatOptions(extraBody, opts) }),
    AbortSignal.timeout(LLM_TIMEOUT_MS),
  )
}

/**
 * The receipt fields, LLM first when chosen, the built-in parser whenever the
 * LLM isn't used or can't answer. Every such fallback is logged in one line
 * and comes back as a note for the card. Never logs receipt text.
 */
async function readReceipt(text: string, choice: ParserChoice, skipped: ParseNote | null, householdNames: string[]): Promise<ReceiptRead> {
  if (choice === "none" || !text.trim()) return { parsed: null, method: null, note: null }
  const basic = () => parseReceipt(text, new Date(), { householdNames })
  let note = skipped
  let detail: string | undefined
  if (choice === "llm") {
    try {
      const read = await readWithLlm(text)
      if ("parsed" in read) return { parsed: fillFromBasic(read.parsed, basic()), method: "llm", note: null }
      note = read.note
      detail = read.detail
    } catch (error) {
      // readReceiptByLlm never throws; this is the settings load or client setup.
      note = "llm-failed"
      detail = llmFailureDetail(error)
    }
  }
  if (note) console.error(fallbackLogLine(note, detail))
  return { parsed: basic(), method: "basic", note }
}

/**
 * Fills in an item's suggestions once every file is read. Leaves it PENDING
 * while any file is still waiting; FAILED when nothing could be read. Never
 * throws for a missing item (it may have been filed or discarded meanwhile).
 */
export async function processInboxItem(itemId: string): Promise<void> {
  const item = await prisma.inboxItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      suggestedByUser: true, suggestedAssetType: true, suggestedAssetId: true, suggestedReason: true,
      attachments: { select: { text: { select: { status: true, text: true, error: true } } } },
    },
  })
  if (!item) return
  const { indexingEnabled } = await loadDocumentSettings()
  const read = inboxText(
    item.attachments.map((a) => a.text ?? { status: "PENDING" as const, text: null, error: null }),
    { indexing: indexingEnabled }
  )
  if (read.kind === "wait") return
  // Added from an asset's page: the person's pick stands, no matching.
  const userAsset = keptUserAsset(item)
  // Leaves the person's pick as it is; clears the reader's own suggestion.
  const suggestion = (match: AssetMatch | null) =>
    userAsset
      ? {}
      : { suggestedAssetType: match?.assetType ?? null, suggestedAssetId: match?.assetId ?? null, suggestedReason: match?.shownReason ?? null }

  if (read.kind === "failed") {
    await prisma.inboxItem.updateMany({
      where: { id: itemId },
      data: { status: "FAILED", error: read.error, ...parsedFields(null, null), ...suggestion(null) },
    })
    return
  }

  const [mode, features, llm] = await Promise.all([loadCaptureParser(), loadFeatures(), loadLlmConfig()])
  // The customer's name heads many receipts; the reader skips it for the shop's.
  const householdNames = await loadHouseholdNames(features.health)
  // Matching is local (identifiers, then the local embedding model), so it runs
  // first: a person's file then never reaches the LLM unless allowed.
  let match: AssetMatch | null = userAsset
  if (!userAsset && read.text.trim()) {
    const candidates = await loadCaptureCandidates(features.health)
    match = matchAsset(read.text, candidates) ?? (await suggestFromMeaning(read.text, candidates, features.health))
  }
  const parserInput = {
    mode,
    llmReady: isLlmReady(llm),
    suggestedAssetType: match?.assetType ?? null,
    healthDocumentsEnabled: features.health && llm.healthDocumentsEnabled,
  }
  const { parsed, method, note } = await readReceipt(read.text, chooseParser(parserInput), llmSkipNote(parserInput), householdNames)

  await prisma.inboxItem.updateMany({
    where: { id: itemId },
    data: {
      status: "READY",
      error: null,
      ...parsedFields(parsed, method, note),
      // The plain-words reason ("VIN on the receipt"), never the matched value.
      ...suggestion(match),
    },
  })
}

/** For the indexer's processed hook: an INBOX file finished, so its item may be ready. */
export async function processInboxAttachment(attachmentId: string): Promise<void> {
  const a = await prisma.attachment.findUnique({ where: { id: attachmentId }, select: { recordType: true, inboxItemId: true } })
  if (a?.recordType === "INBOX" && a.inboxItemId) await processInboxItem(a.inboxItemId)
}
