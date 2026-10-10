import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { loadLlmConfig } from "@/lib/llm/config"
import { createChatClient } from "@/lib/llm/client"
import { isLlmReady, parseExtraBody } from "@/lib/llm/settings-schema"
import { DOCUMENT_SETTINGS_ID, loadDocumentSettings } from "@/lib/documents/settings"
import { parseReceipt, type ParsedReceipt } from "@/lib/capture/parse"
import { askViaChat, llmParseReceipt } from "@/lib/capture/llm-parse"
import { buildIdentifiers, matchAsset, type CandidateAsset } from "@/lib/capture/match"
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
  // Matching is local, so it runs first: a person's file then never reaches the LLM unless allowed.
  const match = read.text.trim() ? matchAsset(read.text, await loadCaptureCandidates(features.health)) : null
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
