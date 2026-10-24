import { prisma } from "@/lib/prisma"
import { createIndexer, type Indexer } from "./indexer"
import { openSearchIndex, searchIndexPath, type SearchIndex } from "./index-db"
import { prismaIndexerStore } from "./store"
import { loadDocumentSettings } from "./settings"
import { formatIndexStats, type StatusCounts } from "./stats"
import { MAX_ATTEMPTS, OCR_EXTENSIONS } from "./limits"
import { activeModel, embedderFor } from "./embed/server"
import { modelKey, type EmbeddingModel } from "./embed/models"
import { entitiesChanged } from "@/lib/search/entities/changes"
import { chunkPages } from "./chunk"
import { splitPages } from "./normalize"

// instrumentation.ts, route handlers and server actions can each load their
// own copy of this module, so the one indexer and index handle per process
// live on globalThis. HomeCenter is a single container on a single SQLite
// file; this is not meant for several replicas.

type State = { indexer?: Indexer; index?: Promise<SearchIndex>; started?: boolean }
const g = globalThis as unknown as { __hcDocuments?: State }
const state: State = (g.__hcDocuments ??= {})

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error)

export function searchIndex(): Promise<SearchIndex> {
  state.index ??= openSearchIndex(searchIndexPath()).catch((error) => {
    state.index = undefined
    throw error
  })
  return state.index
}

export function documentIndexer(): Indexer {
  state.indexer ??= createIndexer({
    store: prismaIndexerStore,
    index: searchIndex,
    // Uploads are untrusted: each file is read in its own worker thread, which
    // also ends any OCR worker with it, so there's nothing to free when idle.
    extract: async (filePath, ext, opts) => (await import("./extract/isolated")).extractInWorker(filePath, ext, opts),
    // A capture-inbox file is read for its receipt fields once its text is in.
    processed: async (job) => {
      if (job.recordType === "INBOX") await (await import("@/lib/capture-server")).processInboxAttachment(job.attachmentId)
    },
    semantic: {
      async begin() {
        const m = await activeModel()
        if (!m) return null
        const key = modelKey(m)
        await (await searchIndex()).useVectorModel(key, m.dims)
        const embedder = embedderFor(m)
        return {
          key,
          embed: (texts) => embedder.embedPassages(texts),
          stillActive: async () => {
            const now = await activeModel()
            return now !== null && modelKey(now) === key
          },
          end: () => embedder.indexingDrained(),
        }
      },
    },
  })
  return state.indexer
}

/** The active model, if the index's vectors were made with it — otherwise search stays keyword-only. */
export async function semanticSearchModel(): Promise<EmbeddingModel | null> {
  const m = await activeModel()
  if (!m) return null
  return (await (await searchIndex()).vectorModel()) === modelKey(m) ? m : null
}

export function enqueueDocument(id: string): void {
  documentIndexer().enqueue(id)
}

/**
 * Files that changed owner (filed from the capture inbox): the index keeps a
 * record type per chunk, so it's rewritten from the stored text — no second
 * extraction or OCR. Files not read yet just go through the queue.
 */
export async function reindexMovedDocuments(ids: string[]): Promise<void> {
  const { indexingEnabled } = await loadDocumentSettings()
  if (!indexingEnabled || !ids.length) return
  const rows = await prisma.attachmentText.findMany({
    where: { attachmentId: { in: ids } },
    select: { attachmentId: true, status: true, text: true, attachment: { select: { originalName: true, recordType: true } } },
  })
  for (const r of rows) {
    if (r.status !== "DONE" || !r.text) {
      enqueueDocument(r.attachmentId)
      continue
    }
    try {
      await (await searchIndex()).replace(r.attachmentId, r.attachment, chunkPages(splitPages(r.text)))
    } catch (error) {
      // reconcile() re-indexes DONE rows missing from the index.
      console.error(`[documents] reindex ${r.attachmentId} failed:`, nameOf(error))
    }
  }
  // New chunks need vectors.
  documentIndexer().embedNow()
}

const DEFAULT_HOURS = 6
// Long enough to stay clear of the server's own startup work.
const BOOT_DELAY_MS = 20_000

function intervalMs() {
  const raw = process.env.DOCUMENT_REINDEX_HOURS
  if (raw === undefined) return DEFAULT_HOURS * 3_600_000
  const hours = Number(raw)
  if (!Number.isFinite(hours) || hours < 0) {
    console.warn(`[documents] ignoring invalid DOCUMENT_REINDEX_HOURS=${raw}`)
    return DEFAULT_HOURS * 3_600_000
  }
  return hours * 3_600_000 // 0 disables
}

function reconcileNow(trigger: string) {
  // Database records share the index file; re-sync them on the same occasions
  // (boot, the schedule, settings changes, a rebuild).
  entitiesChanged()
  return documentIndexer()
    .reconcile()
    .then(
      ({ queued }) => {
        if (queued) console.info(`[documents] ${trigger}: queued ${queued}`)
      },
      (error) => console.error(`[documents] ${trigger} failed:`, nameOf(error))
    )
}

export function startDocumentIndexer(): void {
  if (state.started) return
  state.started = true
  setTimeout(() => void reconcileNow("boot"), BOOT_DELAY_MS).unref()
  const every = intervalMs()
  // unref so a pending timer never keeps the process alive on shutdown.
  if (every > 0) setInterval(() => void reconcileNow("scheduled"), every).unref()
}

/** Failed files, and files that ran out of attempts (e.g. ones that crashed the process), get another go. */
export async function retryFailed(): Promise<void> {
  await prisma.attachmentText.updateMany({
    where: { OR: [{ status: "FAILED" }, { attempts: { gte: MAX_ATTEMPTS } }] },
    data: { attempts: 0 },
  })
  void reconcileNow("retry failed")
}

/**
 * Marks everything as extracted by an older version rather than PENDING, so
 * existing text stays readable and searchable until each file is re-read.
 */
export async function reextractAll(): Promise<void> {
  await prisma.attachmentText.updateMany({ data: { extractorVersion: 0, attempts: 0 } })
  void reconcileNow("re-extract all")
}

/** From stored text — no file is read again. */
export async function rebuildIndex(): Promise<void> {
  await (await searchIndex()).clear()
  void reconcileNow("rebuild index")
}

/** Deletes every extracted text and the index; rows go back to PENDING. Callers check indexing is off. */
export async function clearAllText(): Promise<void> {
  await prisma.attachmentText.updateMany({
    data: {
      status: "PENDING", method: null, text: null, pageCount: null, charCount: null, truncated: false,
      error: null, attempts: 0, extractorVersion: 0, extractedAt: null,
    },
  })
  await (await searchIndex()).clear()
}

/** Images and PDFs that came back empty with OCR off get another go. */
export async function requeueEmptyForOcr(): Promise<void> {
  await prisma.attachmentText.updateMany({
    where: { status: "EMPTY", attachment: { OR: OCR_EXTENSIONS.map((ext) => ({ filename: { endsWith: ext } })) } },
    data: { status: "PENDING" },
  })
}

export async function documentIndexStats(): Promise<string> {
  const [settings, groups] = await Promise.all([
    loadDocumentSettings(),
    prisma.attachmentText.groupBy({ by: ["status"], _count: { _all: true } }),
  ])
  const counts: StatusCounts = Object.fromEntries(groups.map((g) => [g.status, g._count._all]))
  const vectors =
    settings.semanticEnabled && (await semanticSearchModel()) ? await (await searchIndex()).vectorStats() : null
  return formatIndexStats(counts, settings.indexingEnabled, vectors)
}
