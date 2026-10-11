import { readFile } from "fs/promises"
import { EXTRACT_TIMEOUT_MS, OCR_TIMEOUT_MS } from "../limits"
import { ExtractError, type Extracted } from "../types"
import { kindFor, type ExtractKind } from "./kinds"
import { decodeText, rtfToText } from "./plain"

// One entry point for the indexer. Heavy libraries are imported lazily so a
// text file never loads pdf.js or Tesseract.

export async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => Promise<void>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The work can't be cancelled; make sure its late failure isn't unhandled.
  p.catch(() => {})
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onTimeout?.()
      reject(new ExtractError(`Timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function run(kind: ExtractKind, ext: string, data: Buffer, opts: { ocr: boolean }): Promise<Extracted> {
  switch (kind) {
    case "pdf":
      return (await import("./pdf")).extractPdf(new Uint8Array(data), opts)
    case "office":
      return { kind: "text", method: "TEXT", pages: await (await import("./office")).extractOffice(data, ext) }
    case "doc":
      return { kind: "text", method: "TEXT", pages: await (await import("./office")).extractDoc(data) }
    case "eml":
      return { kind: "text", method: "TEXT", pages: await (await import("./mail")).extractEml(data) }
    case "msg":
      return { kind: "text", method: "TEXT", pages: await (await import("./mail")).extractMsg(data) }
    case "sheet":
      return { kind: "text", method: "TEXT", pages: await (await import("./mail")).extractSheet(data) }
    case "ppt":
      return { kind: "text", method: "TEXT", pages: await (await import("./mail")).extractPpt(data) }
    case "text":
      return { kind: "text", method: "TEXT", pages: [decodeText(data)] }
    case "rtf":
      return { kind: "text", method: "TEXT", pages: [rtfToText(decodeText(data))] }
    case "image":
      // OCR off: an image has no text we can read, so it ends up EMPTY and is
      // re-queued if OCR is switched on later.
      if (!opts.ocr) return { kind: "text", method: "TEXT", pages: [] }
      return { kind: "text", method: "OCR", pages: [await (await import("./ocr")).ocrImage(data)] }
  }
}

export async function extractFile(filePath: string, ext: string | null, opts: { ocr: boolean }): Promise<Extracted> {
  const kind = kindFor(ext)
  if (!kind || !ext) return { kind: "unsupported" }
  const data = await readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new ExtractError("File missing on disk")
    throw error
  })
  const slow = opts.ocr && (kind === "pdf" || kind === "image")
  return withTimeout(run(kind, ext, data, opts), slow ? OCR_TIMEOUT_MS : EXTRACT_TIMEOUT_MS, async () => {
    if (slow) await (await import("./ocr")).terminateOcr()
  })
}
