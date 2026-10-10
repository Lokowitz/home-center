import { chunkPages } from "./chunk"
import type { SearchIndex } from "./index-db"
import { hasText, joinPages, splitPages } from "./normalize"
import { ExtractError, type Extracted, type ExtractMethod } from "./types"

// Reads uploads one at a time in the server process. Everything it touches is
// passed in, so the rules live here and are tested with fakes; the Prisma
// store and the real extractors are wired up in indexer-server.ts.
//
// The in-memory queue is only a fast path. The database is the source of
// truth: reconcile() finds every PENDING, stale or retryable row, so a restart
// loses nothing.

export type Job = {
  attachmentId: string
  /** null when the attachment's location can't be resolved. */
  filePath: string | null
  ext: string | null
  originalName: string
  recordType: string
  attempts: number
}

export type SaveResult =
  | { status: "DONE"; method: ExtractMethod; text: string; pageCount: number; truncated: boolean }
  | { status: "EMPTY" | "UNSUPPORTED" }
  | { status: "FAILED"; error: string }

export type IndexerStore = {
  settings(): Promise<{ indexingEnabled: boolean; ocrEnabled: boolean }>
  loadJob(id: string): Promise<Job | null>
  /**
   * Counts an attempt before the file is read. A file that kills the process
   * (zip bomb, native crash) never reaches save(), so counting afterwards would
   * retry it on every boot.
   */
  claim(id: string): Promise<void>
  /**
   * Must be a no-op when the row is gone (attachment deleted meanwhile).
   * DONE / EMPTY / UNSUPPORTED reset attempts to 0: attempts means unsuccessful tries in a row.
   */
  save(id: string, result: SaveResult): Promise<void>
  /** Creates PENDING rows for attachments that have none. */
  ensureRows(): Promise<void>
  attachmentIds(): Promise<Set<string>>
  doneIds(): Promise<string[]>
  /** PENDING, extracted by an older EXTRACTOR_VERSION, or FAILED — and in every case with attempts left. */
  dueIds(): Promise<string[]>
  loadText(id: string): Promise<{ text: string; originalName: string; recordType: string } | null>
}

export const EMBED_BATCH = 16

/** An open embedding session for the active model; end() lets the model unload. */
export type SemanticSession = {
  key: string
  embed(texts: string[]): Promise<number[][]>
  /** False once the active model changed or semantic search was turned off. */
  stillActive(): Promise<boolean>
  end(): void
}

/** Bounds model switches handled in one drain, should an admin keep switching. */
const MAX_EMBED_PASSES = 3

export type IndexerDeps = {
  store: IndexerStore
  index: () => Promise<SearchIndex>
  extract: (filePath: string, ext: string | null, opts: { ocr: boolean }) => Promise<Extracted>
  /** Called whenever the queue empties — frees the OCR worker. */
  idle?: () => Promise<void>
  log?: Pick<Console, "info" | "error">
  /**
   * Called after each file's result is saved (any status), e.g. to read a
   * capture-inbox receipt. Errors are logged; they never fail the job.
   */
  processed?: (job: Job, status: SaveResult["status"]) => Promise<void>
  /** Present when the semantic layer is wired up; begin() returns null when it can't run right now. */
  semantic?: { begin(): Promise<SemanticSession | null> }
}

export type Indexer = {
  enqueue(id: string): void
  reconcile(): Promise<{ queued: number }>
  /** Embeds whatever has no vector yet (e.g. records just synced) without a full reconcile. */
  embedNow(): void
  /** Resolves once the queue is empty and nothing is running. */
  idle(): Promise<void>
  pending(): number
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error)

export function createIndexer(deps: IndexerDeps): Indexer {
  const log = deps.log ?? console
  const queue = new Set<string>()
  let draining: Promise<void> | null = null
  let reconciling: Promise<{ queued: number }> | null = null

  async function indexText(id: string, text: string, meta: { originalName: string; recordType: string }) {
    try {
      const index = await deps.index()
      await index.replace(id, meta, chunkPages(splitPages(text)))
    } catch (error) {
      // The text is saved; reconcile() re-indexes DONE rows missing from the index.
      log.error(`[documents] index ${id} failed:`, nameOf(error))
    }
  }

  async function removeFromIndex(id: string) {
    try {
      await (await deps.index()).remove([id])
    } catch (error) {
      log.error(`[documents] unindex ${id} failed:`, nameOf(error))
    }
  }

  async function processOne(id: string, ocr: boolean) {
    const job = await deps.store.loadJob(id)
    if (!job) return
    const status = await extractOne(id, job, ocr)
    if (!deps.processed) return
    try {
      await deps.processed(job, status)
    } catch (error) {
      log.error(`[documents] after ${id} failed:`, nameOf(error))
    }
  }

  async function extractOne(id: string, job: Job, ocr: boolean): Promise<SaveResult["status"]> {
    await deps.store.claim(id)
    // A failed re-read leaves no text behind, so its old chunks must go too.
    if (!job.filePath) {
      await deps.store.save(id, { status: "FAILED", error: "File missing on disk" })
      await removeFromIndex(id)
      return "FAILED"
    }
    let out: Extracted
    try {
      out = await deps.extract(job.filePath, job.ext, { ocr })
    } catch (error) {
      const message = error instanceof ExtractError ? error.message : "Couldn't read this file"
      await deps.store.save(id, { status: "FAILED", error: message })
      await removeFromIndex(id)
      log.error(`[documents] extract ${id} failed:`, nameOf(error))
      return "FAILED"
    }
    if (out.kind === "unsupported") {
      await deps.store.save(id, { status: "UNSUPPORTED" })
      await removeFromIndex(id)
      return "UNSUPPORTED"
    }
    const joined = joinPages(out.pages)
    if (!hasText(joined.text)) {
      await deps.store.save(id, { status: "EMPTY" })
      await removeFromIndex(id)
      return "EMPTY"
    }
    await deps.store.save(id, { status: "DONE", method: out.method, ...joined })
    await indexText(id, joined.text, job)
    return "DONE"
  }

  // Chunks without a vector for the active model get one. Runs after the file
  // queue drains, so extraction (and keyword search) never waits for it. New
  // files arriving meanwhile pause it; drain() starts it again afterwards.
  // A model switch (or semantic off) ends the session between batches, and
  // the next pass begins with whatever is active now.
  async function embedBacklog() {
    if (!deps.semantic) return
    for (let pass = 0; pass < MAX_EMBED_PASSES; pass++) {
      if (!(await embedPass(deps.semantic))) return
    }
  }

  /** True when the session went stale and another pass should begin. */
  async function embedPass(semantic: NonNullable<IndexerDeps["semantic"]>): Promise<boolean> {
    let session: SemanticSession | null = null
    try {
      session = await semantic.begin()
      if (!session) return false
      const index = await deps.index()
      while (!queue.size) {
        const { indexingEnabled } = await deps.store.settings()
        if (!indexingEnabled) return false
        if (!(await session.stillActive())) return true
        // File chunks first, then database records (lib/search/entities).
        let batch = await index.chunksMissingVectors(EMBED_BATCH)
        const records = !batch.length
        if (records) batch = await index.entityChunksMissingVectors(EMBED_BATCH)
        if (!batch.length) return false
        const vectors = await session.embed(batch.map((b) => b.text))
        const rows = batch.map((b, i) => ({ chunkId: b.chunkId, vector: vectors[i] }))
        await (records ? index.writeEntityVectors(session.key, rows) : index.writeVectors(session.key, rows))
        await new Promise((resolve) => setImmediate(resolve))
      }
      return false
    } catch (error) {
      // Left for the next reconcile; keyword search is unaffected.
      log.error("[documents] embedding failed:", nameOf(error))
      return false
    } finally {
      session?.end()
    }
  }

  function drain(): Promise<void> {
    if (draining) return draining
    const current = (async () => {
      // Yield first: with an empty queue the body would otherwise finish
      // before `draining` is assigned, leaving it pointing at a settled run.
      await Promise.resolve()
      try {
        while (queue.size) {
          const id = queue.values().next().value as string
          queue.delete(id)
          const { indexingEnabled, ocrEnabled } = await deps.store.settings()
          if (!indexingEnabled) {
            queue.clear()
            break
          }
          try {
            await processOne(id, ocrEnabled)
          } catch (error) {
            log.error(`[documents] job ${id} failed:`, nameOf(error))
          }
          // Let requests in between files.
          await new Promise((resolve) => setImmediate(resolve))
        }
        await embedBacklog()
      } finally {
        await deps.idle?.().catch(() => {})
      }
    })()
    draining = current
    void current.finally(() => {
      if (draining === current) draining = null
      // Something was enqueued after the loop's last check.
      if (queue.size) void drain()
    })
    return current
  }

  async function runReconcile(): Promise<{ queued: number }> {
    const { indexingEnabled } = await deps.store.settings()
    if (!indexingEnabled) return { queued: 0 }
    await deps.store.ensureRows()
    const index = await deps.index()
    const [known, indexed] = await Promise.all([deps.store.attachmentIds(), index.indexedIds()])
    const orphans = [...indexed].filter((id) => !known.has(id))
    if (orphans.length) await index.remove(orphans)
    for (const id of await deps.store.doneIds()) {
      if (indexed.has(id)) continue
      const stored = await deps.store.loadText(id)
      if (stored) await indexText(id, stored.text, stored)
    }
    const due = await deps.store.dueIds()
    for (const id of due) queue.add(id)
    void drain()
    return { queued: due.length }
  }

  return {
    enqueue(id) {
      queue.add(id)
      void drain()
    },
    embedNow() {
      void drain()
    },
    reconcile() {
      reconciling ??= runReconcile().finally(() => {
        reconciling = null
      })
      return reconciling
    },
    async idle() {
      while (draining || reconciling) await (reconciling ?? draining)
    },
    pending: () => queue.size,
  }
}
