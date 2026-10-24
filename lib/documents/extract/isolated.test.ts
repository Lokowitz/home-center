import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { extractInWorker } from "./isolated"
import { ExtractError } from "../types"
import { docx } from "./test-fixtures"

let dir: string
const put = (name: string, data: Buffer | string) => {
  const p = path.join(dir, name)
  writeFileSync(p, data)
  return p
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hc-isolated-"))
})
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // leftovers in the temp folder are harmless
  }
})

describe("extractInWorker", () => {
  it("reads a file through the real worker", async () => {
    const file = put("a.docx", docx(["Replace the furnace filter every 90 days."]))
    expect(await extractInWorker(file, ".docx", { ocr: false })).toEqual({
      kind: "text",
      method: "TEXT",
      pages: ["Replace the furnace filter every 90 days."],
    })
  }, 60_000)

  it("passes a fixed-phrase failure back as an ExtractError", async () => {
    const error = await extractInWorker(path.join(dir, "missing.docx"), ".docx", { ocr: false }).catch((e) => e)
    expect(error).toBeInstanceOf(ExtractError)
    expect(error.message).toBe("File missing on disk")
  }, 60_000)

  it("answers unsupported types without starting a worker", async () => {
    const r = await extractInWorker("x.exe", ".exe", { ocr: false }, { workerPath: path.join(dir, "no-such-worker.mjs") })
    expect(r).toEqual({ kind: "unsupported" })
  })

  it("terminates a worker stuck in a synchronous loop", async () => {
    const stuck = put("stuck.mjs", "while (true) {}\n")
    const error = await extractInWorker("a.txt", ".txt", { ocr: false }, { workerPath: stuck, graceMs: -119_000 }).catch((e) => e)
    expect(error).toBeInstanceOf(ExtractError)
    expect(error.message).toMatch(/^Timed out/)
  }, 10_000)

  it("contains a worker that runs out of memory", async () => {
    const hog = put("hog.mjs", "const a = []; for (;;) a.push({ s: 'x'.repeat(64) + Math.random() })\n")
    const error = await extractInWorker("a.txt", ".txt", { ocr: false }, { workerPath: hog, heapMb: 32 }).catch((e) => e)
    expect(error).toBeInstanceOf(ExtractError)
    expect(error.message).toBe("Too large to read")
  }, 60_000)
})
