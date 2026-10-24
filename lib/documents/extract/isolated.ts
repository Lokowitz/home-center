import path from "path"
import { Worker } from "worker_threads"
import { EXTRACT_HEAP_MB, EXTRACT_TIMEOUT_MS, EXTRACT_WORKER_GRACE_MS, OCR_TIMEOUT_MS } from "../limits"
import { ExtractError, type Extracted } from "../types"
import { kindFor } from "./kinds"

// extractFile, run in workers/extract-worker.mjs. In-process, a zip bomb could
// exhaust the server's memory, and a synchronous parser blocked the event loop
// so withTimeout never fired. In a worker the heap is capped and a timeout
// terminates the thread, whatever it is doing.

type Reply = { ok: true; result: Extracted } | { ok: false; name: string; message?: string }

export type IsolatedOptions = { workerPath: string; entry: string; heapMb: number; graceMs: number }

function defaults(): IsolatedOptions {
  return {
    workerPath: path.join(process.cwd(), "workers", "extract-worker.mjs"),
    entry: path.join(process.cwd(), "lib", "documents", "extract", "index.ts"),
    heapMb: EXTRACT_HEAP_MB,
    graceMs: EXTRACT_WORKER_GRACE_MS,
  }
}

export function extractInWorker(
  filePath: string,
  ext: string | null,
  opts: { ocr: boolean },
  over: Partial<IsolatedOptions> = {}
): Promise<Extracted> {
  const kind = kindFor(ext)
  if (!kind || !ext) return Promise.resolve({ kind: "unsupported" })
  const o = { ...defaults(), ...over }
  const slow = opts.ocr && (kind === "pdf" || kind === "image")
  const limitMs = (slow ? OCR_TIMEOUT_MS : EXTRACT_TIMEOUT_MS) + o.graceMs

  return new Promise<Extracted>((resolve, reject) => {
    const worker = new Worker(o.workerPath, {
      workerData: { entry: o.entry },
      resourceLimits: { maxOldGenerationSizeMb: o.heapMb },
    })
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      void worker.terminate()
    }
    const timer = setTimeout(
      () => finish(() => reject(new ExtractError(`Timed out after ${Math.round(limitMs / 1000)}s`))),
      limitMs
    )
    worker.on("message", (reply: Reply) =>
      finish(() => {
        if (reply.ok) resolve(reply.result)
        else if (reply.name === "ExtractError") reject(new ExtractError(reply.message ?? "Couldn't read this file"))
        else reject(Object.assign(new Error("Extraction failed"), { name: reply.name }))
      })
    )
    worker.on("error", (error: NodeJS.ErrnoException) =>
      finish(() =>
        reject(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? new ExtractError("Too large to read") : error)
      )
    )
    worker.on("exit", (code) => finish(() => reject(new ExtractError(`Reader stopped (exit ${code})`))))
    worker.postMessage({ filePath, ext, opts })
  })
}
