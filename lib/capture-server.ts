import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { loadLlmConfig } from "@/lib/llm/config"
import { createChatClient } from "@/lib/llm/client"
import { isLlmReady, parseExtraBody } from "@/lib/llm/settings-schema"
import { DOCUMENT_SETTINGS_ID, loadDocumentSettings } from "@/lib/documents/settings"
import { parseReceipt, type ParsedReceipt } from "@/lib/capture/parse"
import { askViaChat, llmParseReceipt } from "@/lib/capture/llm-parse"
import { buildIdentifiers, matchAsset, type AssetMatch, type CandidateAsset } from "@/lib/capture/match"
import { RECORD_KINDS, semanticQueryText, suggestByMeaning, toAssetHits, type OwnerRef } from "@/lib/capture/semantic"
import { searchIndex, semanticSearchModel } from "@/lib/documents/indexer-server"
import { embedderFor } from "@/lib/documents/embed/server"
import { chooseParser, inboxText, parsedFields, type ParserChoice } from "@/lib/inbox"
import type { CaptureParser } from "@/app/generated/prisma/client"

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

async function readWithLlm(text: string): Promise<ParsedReceipt | null> {
  const config = await loadLlmConfig()
  if (!isLlmReady(config) || !config.baseUrl || !config.model) return null
  const chat = createChatClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    extraBody: parseExtraBody(config.extraBody),
  })
  return llmParseReceipt(text, askViaChat(chat, AbortSignal.timeout(LLM_TIMEOUT_MS)))
}

/** The receipt fields, LLM first when chosen, the built-in parser whenever the LLM can't answer. */
async function readReceipt(text: string, choice: ParserChoice): Promise<{ parsed: ParsedReceipt | null; method: "basic" | "llm" | null }> {
  if (choice === "none" || !text.trim()) return { parsed: null, method: null }
  if (choice === "llm") {
    try {
      const parsed = await readWithLlm(text)
      if (parsed) return { parsed, method: "llm" }
    } catch (error) {
      // Never log the error text: some servers echo the prompt (the receipt) back.
      console.error("[inbox] LLM read failed, using the built-in parser:", error instanceof Error ? error.name : typeof error)
    }
  }
  return { parsed: parseReceipt(text), method: "basic" }
}

/**
 * Fills in an item's suggestions once every file is read. Leaves it PENDING
 * while any file is still waiting; FAILED when nothing could be read. Never
 * throws for a missing item (it may have been filed or discarded meanwhile).
 */
export async function processInboxItem(itemId: string): Promise<void> {
  const item = await prisma.inboxItem.findUnique({
    where: { id: itemId },
    select: { id: true, attachments: { select: { text: { select: { status: true, text: true, error: true } } } } },
  })
  if (!item) return
  const { indexingEnabled } = await loadDocumentSettings()
  const read = inboxText(
    item.attachments.map((a) => a.text ?? { status: "PENDING" as const, text: null, error: null }),
    { indexing: indexingEnabled }
  )
  if (read.kind === "wait") return

  if (read.kind === "failed") {
    await prisma.inboxItem.updateMany({
      where: { id: itemId },
      data: { status: "FAILED", error: read.error, ...parsedFields(null, null), suggestedAssetType: null, suggestedAssetId: null },
    })
    return
  }

  const [mode, features, llm] = await Promise.all([loadCaptureParser(), loadFeatures(), loadLlmConfig()])
  // Matching is local (identifiers, then the local embedding model), so it runs
  // first: a person's file then never reaches the LLM unless allowed.
  let match: AssetMatch | null = null
  if (read.text.trim()) {
    const candidates = await loadCaptureCandidates(features.health)
    match = matchAsset(read.text, candidates) ?? (await suggestFromMeaning(read.text, candidates, features.health))
  }
  const choice = chooseParser({
    mode,
    llmReady: isLlmReady(llm),
    suggestedAssetType: match?.assetType ?? null,
    healthDocumentsEnabled: features.health && llm.healthDocumentsEnabled,
  })
  const { parsed, method } = await readReceipt(read.text, choice)

  await prisma.inboxItem.updateMany({
    where: { id: itemId },
    data: {
      status: "READY",
      error: null,
      ...parsedFields(parsed, method),
      suggestedAssetType: match?.assetType ?? null,
      suggestedAssetId: match?.assetId ?? null,
    },
  })
}

/** For the indexer's processed hook: an INBOX file finished, so its item may be ready. */
export async function processInboxAttachment(attachmentId: string): Promise<void> {
  const a = await prisma.attachment.findUnique({ where: { id: attachmentId }, select: { recordType: true, inboxItemId: true } })
  if (a?.recordType === "INBOX" && a.inboxItemId) await processInboxItem(a.inboxItemId)
}
