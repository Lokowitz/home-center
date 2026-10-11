import { describe, expect, it, vi } from "vitest"
import { createIndexer, type IndexerStore, type Job, type SaveResult, type SemanticSession } from "./indexer"
import type { SearchIndex } from "./index-db"
import type { Chunk } from "./chunk"
import { ExtractError, type Extracted } from "./types"

type Row = { job: Job; result?: SaveResult; text?: string }

function setup(opts: {
  enabled?: boolean; ocr?: boolean; outcomes?: Record<string, Extracted | Error>; semantic?: boolean
  processed?: (job: Job, status: SaveResult["status"]) => Promise<void>
} = {}) {
  const settings = { indexingEnabled: opts.enabled ?? true, ocrEnabled: opts.ocr ?? true }
  const rows = new Map<string, Row>()
  const add = (id: string, over: Partial<Job> = {}) =>
    rows.set(id, { job: { attachmentId: id, filePath: `/u/${id}.pdf`, ext: ".pdf", originalName: `${id}.pdf`, recordType: "SERVICE", attempts: 0, ...over } })
  const chunks = new Map<string, Chunk[]>()
  const replaceFails = { value: false }
  let nextChunkId = 1
  const chunkIds = new Map<string, number[]>()
  const vectors = new Map<number, string>()
  const textOf = new Map<number, string>()
  const entityText = new Map<number, string>()
  const entityVectors = new Map<number, string>()
  const replaceChunks = (id: string, c: Chunk[]) => {
    for (const old of chunkIds.get(id) ?? []) {
      vectors.delete(old)
      textOf.delete(old)
    }
    const ids = c.map((x) => {
      const n = nextChunkId++
      textOf.set(n, x.text)
      return n
    })
    chunkIds.set(id, ids)
    chunks.set(id, c)
  }

  const store: IndexerStore = {
    settings: async () => ({ ...settings }),
    loadJob: async (id) => rows.get(id)?.job ?? null,
    claim: async (id) => {
      const row = rows.get(id)
      if (row) row.job.attempts++
    },
    save: async (id, result) => {
      const row = rows.get(id)
      if (!row) return // deleted meanwhile: a no-op, like updateMany
      row.result = result
      row.text = result.status === "DONE" ? result.text : undefined
      if (result.status !== "FAILED") row.job.attempts = 0
    },
    ensureRows: async () => {},
    attachmentIds: async () => new Set(rows.keys()),
    doneIds: async () => [...rows].filter(([, r]) => r.result?.status === "DONE").map(([id]) => id),
    dueIds: async () => [...rows].filter(([, r]) => !r.result).map(([id]) => id),
    loadText: async (id) => {
      const r = rows.get(id)
      return r?.text ? { text: r.text, originalName: r.job.originalName, recordType: r.job.recordType } : null
    },
  }
  const index: SearchIndex = {
    replace: async (id, _meta, c) => {
      if (replaceFails.value) throw new Error("disk full")
      replaceChunks(id, c)
    },
    remove: async (ids) =>
      ids.forEach((id) => {
        for (const n of chunkIds.get(id) ?? []) {
          vectors.delete(n)
          textOf.delete(n)
        }
        chunkIds.delete(id)
        chunks.delete(id)
      }),
    search: async () => [],
    indexedIds: async () => new Set(chunks.keys()),
    clear: async () => {
      chunks.clear()
      chunkIds.clear()
      vectors.clear()
      textOf.clear()
    },
    close: () => {},
    vectorModel: async () => "m@1",
    useVectorModel: async () => {},
    chunksMissingVectors: async (limit: number) =>
      [...textOf].filter(([n]) => !vectors.has(n)).slice(0, limit).map(([chunkId, text]) => ({ chunkId, text })),
    writeVectors: async (key: string, rows: { chunkId: number; vector: number[] }[]) => {
      for (const r of rows) if (textOf.has(r.chunkId)) vectors.set(r.chunkId, key)
    },
    vectorSearch: async () => [],
    vectorStats: async () => ({ chunks: textOf.size, withVectors: vectors.size }),
    entityHashes: async () => new Map(),
    replaceEntity: async (_kind, _id, _hash, texts) => {
      for (const text of texts) entityText.set(nextChunkId++, text)
    },
    removeEntities: async () => {},
    entityChunksMissingVectors: async (limit: number) =>
      [...entityText].filter(([n]) => !entityVectors.has(n)).slice(0, limit).map(([chunkId, text]) => ({ chunkId, text })),
    writeEntityVectors: async (key: string, rows: { chunkId: number; vector: number[] }[]) => {
      for (const r of rows) if (entityText.has(r.chunkId)) entityVectors.set(r.chunkId, key)
    },
    entityVectorSearch: async () => [],
    entityStats: async () => ({ chunks: entityText.size, withVectors: entityVectors.size }),
  }
  const extract = vi.fn<(filePath: string, ext: string | null, opts: { ocr: boolean }) => Promise<Extracted>>(async (filePath) => {
    const id = filePath.replace(/^\/u\/|\.pdf$/g, "")
    const outcome = opts.outcomes?.[id] ?? { kind: "text", method: "TEXT", pages: [`text of ${id}`] }
    if (outcome instanceof Error) throw outcome
    return outcome
  })
  const idleHook = vi.fn(async () => {})
  const log = { info: vi.fn(), error: vi.fn() }
  const embedCalls: string[][] = []
  const embed = vi.fn(async (texts: string[]) => {
    embedCalls.push(texts)
    return texts.map(() => [1, 0, 0])
  })
  const ended = vi.fn()
  const semantic = opts.semantic
    ? { begin: vi.fn(async (): Promise<SemanticSession | null> => ({ key: "m@1", embed, stillActive: async () => true, end: ended })) }
    : undefined
  const indexer = createIndexer({ store, index: async () => index, extract, idle: idleHook, log, semantic, processed: opts.processed })
  return { settings, rows, add, chunks, replaceFails, extract, idleHook, log, indexer, vectors, embed, ended, semantic, embedCalls, index, entityVectors }
}

describe("indexer", () => {
  it("embeds a new file's chunks after it's indexed, then lets the model go", async () => {
    const t = setup({ semantic: true, outcomes: { a: { kind: "text", method: "TEXT", pages: ["one", "two"] } } })
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.vectors.size).toBe(2)
    expect(t.embedCalls.flat().sort()).toEqual(["one", "two"])
    expect(t.ended).toHaveBeenCalledTimes(1)
  })

  it("embeds database records after file chunks, in the same session", async () => {
    const t = setup({ semantic: true, outcomes: { a: { kind: "text", method: "TEXT", pages: ["file text"] } } })
    await t.index.replaceEntity("PROPERTY", "p1", "h", ["house text"])
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.embedCalls).toEqual([["file text"], ["house text"]])
    expect(t.entityVectors.size).toBe(1)
    expect(t.ended).toHaveBeenCalledTimes(1)
  })

  it("embedNow embeds records synced without any file work", async () => {
    const t = setup({ semantic: true })
    await t.index.replaceEntity("VEHICLE", "v1", "h", ["car text"])
    t.indexer.embedNow()
    await t.indexer.idle()
    expect(t.embedCalls).toEqual([["car text"]])
  })

  it("embeds nothing when semantic search isn't available", async () => {
    const t = setup({ semantic: true })
    t.semantic!.begin.mockResolvedValueOnce(null)
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.embed).not.toHaveBeenCalled()
  })

  it("survives an embedding failure and finishes the job on the next reconcile", async () => {
    const t = setup({ semantic: true })
    t.add("a")
    t.embed.mockRejectedValueOnce(new Error("worker crashed"))
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.vectors.size).toBe(0)
    expect(t.log.error).toHaveBeenCalled()
    expect(t.ended).toHaveBeenCalled()
    await t.indexer.reconcile()
    await t.indexer.idle()
    expect(t.vectors.size).toBe(1)
  })

  it("embeds in batches of 16", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => `page ${i}`)
    const t = setup({ semantic: true, outcomes: { a: { kind: "text", method: "TEXT", pages } } })
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.embedCalls.map((c) => c.length)).toEqual([16, 4])
  })

  it("stops the old model mid-backlog when the model is switched and starts the new one in the same run", async () => {
    const pages = Array.from({ length: 40 }, (_, i) => `page ${i}`)
    const t = setup({ semantic: true, outcomes: { a: { kind: "text", method: "TEXT", pages } } })
    let active = "A@1"
    const keys: string[] = []
    const batchesBy: Record<string, number> = {}
    t.semantic!.begin.mockImplementation(async () => {
      const key = active
      keys.push(key)
      return {
        key,
        embed: async (texts: string[]) => {
          batchesBy[key] = (batchesBy[key] ?? 0) + 1
          active = "B@1" // the admin switches models while the first batch runs
          return texts.map(() => [1, 0, 0])
        },
        stillActive: async () => active === key,
        end: t.ended,
      }
    })
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(keys).toEqual(["A@1", "B@1"])
    expect(batchesBy).toEqual({ "A@1": 1, "B@1": 2 })
    expect(t.ended).toHaveBeenCalledTimes(2)
  })

  it("extracts, saves normalised text and indexes chunks", async () => {
    const t = setup({ outcomes: { a: { kind: "text", method: "TEXT", pages: ["Filter  size\t16x25x1", "page two"] } } })
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.rows.get("a")!.result).toEqual({ status: "DONE", method: "TEXT", text: "Filter size 16x25x1\fpage two", pageCount: 2, truncated: false })
    expect(t.chunks.get("a")!.map((c) => [c.page, c.text])).toEqual([[1, "Filter size 16x25x1"], [2, "page two"]])
    expect(t.idleHook).toHaveBeenCalled()
  })

  it("marks unsupported and empty files and keeps them out of the index", async () => {
    const t = setup({ outcomes: { u: { kind: "unsupported" }, e: { kind: "text", method: "TEXT", pages: ["  ", ""] } } })
    t.add("u")
    t.add("e")
    t.chunks.set("u", [{ page: 1, ordinal: 0, text: "stale" }])
    t.indexer.enqueue("u")
    t.indexer.enqueue("e")
    await t.indexer.idle()
    expect(t.rows.get("u")!.result).toEqual({ status: "UNSUPPORTED" })
    expect(t.rows.get("e")!.result).toEqual({ status: "EMPTY" })
    expect(t.chunks.size).toBe(0)
  })

  it("stores fixed phrases for failures and carries on with the next file", async () => {
    const t = setup({ outcomes: { p: new ExtractError("Password-protected PDF"), x: new Error("secret document text in a stack") } })
    t.add("p")
    t.add("x")
    t.add("ok")
    for (const id of ["p", "x", "ok"]) t.indexer.enqueue(id)
    await t.indexer.idle()
    expect(t.rows.get("p")!.result).toEqual({ status: "FAILED", error: "Password-protected PDF" })
    expect(t.rows.get("x")!.result).toEqual({ status: "FAILED", error: "Couldn't read this file" })
    expect(t.rows.get("x")!.job.attempts).toBe(1)
    expect(t.rows.get("ok")!.result?.status).toBe("DONE")
    expect(JSON.stringify(t.log.error.mock.calls)).not.toContain("secret")
  })

  it("fails a job with no file path without calling the extractor", async () => {
    const t = setup()
    t.add("m", { filePath: null })
    t.indexer.enqueue("m")
    await t.indexer.idle()
    expect(t.rows.get("m")!.result).toEqual({ status: "FAILED", error: "File missing on disk" })
    expect(t.extract).not.toHaveBeenCalled()
  })

  it("passes the OCR switch through to the extractor", async () => {
    const t = setup({ ocr: false })
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.extract).toHaveBeenCalledWith("/u/a.pdf", ".pdf", { ocr: false })
  })

  it("saving a result for a row that disappeared is a no-op", async () => {
    const t = setup()
    t.add("gone")
    t.extract.mockImplementationOnce(async () => {
      t.rows.delete("gone") // attachment deleted mid-extraction
      return { kind: "text", method: "TEXT", pages: ["late text"] }
    })
    t.indexer.enqueue("gone")
    await t.indexer.idle()
    expect(t.rows.has("gone")).toBe(false)
    // The chunks written for it are orphans; reconcile removes them.
    await t.indexer.reconcile()
    await t.indexer.idle()
    expect(t.chunks.has("gone")).toBe(false)
  })

  it("keeps a DONE row when the index write fails, and reconcile re-indexes it without re-extracting", async () => {
    const t = setup()
    t.add("a")
    t.replaceFails.value = true
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.rows.get("a")!.result?.status).toBe("DONE")
    expect(t.chunks.has("a")).toBe(false)
    expect(t.log.error).toHaveBeenCalled()

    t.replaceFails.value = false
    t.extract.mockClear()
    await t.indexer.reconcile()
    await t.indexer.idle()
    expect(t.chunks.get("a")!.length).toBe(1)
    expect(t.extract).not.toHaveBeenCalled()
  })

  it("does nothing while indexing is off, then processes the backlog when it's back on", async () => {
    const t = setup({ enabled: false })
    t.add("a")
    t.add("b")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(await t.indexer.reconcile()).toEqual({ queued: 0 })
    expect(t.extract).not.toHaveBeenCalled()
    expect(t.rows.get("a")!.result).toBeUndefined()

    t.settings.indexingEnabled = true
    expect(await t.indexer.reconcile()).toEqual({ queued: 2 })
    await t.indexer.idle()
    expect(t.rows.get("a")!.result?.status).toBe("DONE")
    expect(t.rows.get("b")!.result?.status).toBe("DONE")
  })

  it("drops a file's old chunks when re-extracting it fails", async () => {
    const t = setup()
    t.add("a")
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.chunks.has("a")).toBe(true)

    t.extract.mockRejectedValueOnce(new ExtractError("Not a readable PDF"))
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.rows.get("a")!.result).toEqual({ status: "FAILED", error: "Not a readable PDF" })
    expect(t.chunks.has("a")).toBe(false)
  })

  it("counts an attempt before extracting, so a file that kills the process isn't retried forever", async () => {
    const t = setup()
    t.add("bomb")
    let attemptsSeenByExtractor = -1
    t.extract.mockImplementationOnce(async () => {
      attemptsSeenByExtractor = t.rows.get("bomb")!.job.attempts
      return { kind: "text", method: "TEXT", pages: ["ok"] }
    })
    t.indexer.enqueue("bomb")
    await t.indexer.idle()
    expect(attemptsSeenByExtractor).toBe(1)
    // Success clears the count: attempts means unsuccessful tries in a row.
    expect(t.rows.get("bomb")!.job.attempts).toBe(0)
  })

  it("picks up a job enqueued while the queue is finishing", async () => {
    const t = setup()
    t.add("a")
    t.add("b")
    t.extract.mockImplementationOnce(async () => {
      t.indexer.enqueue("b")
      return { kind: "text", method: "TEXT", pages: ["a"] }
    })
    t.indexer.enqueue("a")
    await t.indexer.idle()
    expect(t.rows.get("b")!.result?.status).toBe("DONE")
  })

  it("tells the processed hook about every saved result, after the save", async () => {
    const seen: string[] = []
    const t = setup({
      outcomes: { bad: new ExtractError("Password-protected PDF"), none: { kind: "unsupported" } },
      processed: async (job, status) => {
        seen.push(`${job.attachmentId}:${job.recordType}:${status}:${t.rows.get(job.attachmentId)!.result?.status}`)
      },
    })
    t.add("ok", { recordType: "INBOX" })
    t.add("bad")
    t.add("none")
    t.add("lost", { filePath: null })
    for (const id of ["ok", "bad", "none", "lost"]) t.indexer.enqueue(id)
    await t.indexer.idle()
    expect(seen).toEqual(["ok:INBOX:DONE:DONE", "bad:SERVICE:FAILED:FAILED", "none:SERVICE:UNSUPPORTED:UNSUPPORTED", "lost:SERVICE:FAILED:FAILED"])
  })

  it("logs a failing processed hook and carries on", async () => {
    const t = setup({ processed: async () => { throw new Error("parse blew up") } })
    t.add("a")
    t.add("b")
    t.indexer.enqueue("a")
    t.indexer.enqueue("b")
    await t.indexer.idle()
    expect(t.rows.get("b")!.result?.status).toBe("DONE")
    expect(t.log.error).toHaveBeenCalledTimes(2)
  })
})
