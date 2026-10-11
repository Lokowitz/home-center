import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { extractFile, withTimeout } from "./index"
import { terminateOcr } from "./ocr"
import { ExtractError } from "../types"
import { docx, odt, pptx, scannedPdf, textImage, textPdf, xlsx } from "./test-fixtures"

let dir: string
const put = (name: string, data: Buffer | string) => {
  const p = path.join(dir, name)
  writeFileSync(p, data)
  return p
}
const pages = async (name: string, data: Buffer | string, ocr = false) => {
  const r = await extractFile(put(name, data), path.extname(name), { ocr })
  if (r.kind !== "text") throw new Error(`expected text, got ${r.kind}`)
  return r
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hc-extract-"))
})
afterAll(async () => {
  await terminateOcr()
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // leftovers in the temp folder are harmless
  }
})

describe("extractFile — native text", () => {
  it("reads docx and dotx paragraphs as one page", async () => {
    const data = docx(["Replace the furnace filter every 90 days.", "Filter size 16x25x1."])
    expect((await pages("a.docx", data)).pages).toEqual(["Replace the furnace filter every 90 days.\nFilter size 16x25x1."])
    expect((await pages("a.dotx", data)).pages).toEqual(["Replace the furnace filter every 90 days.\nFilter size 16x25x1."])
    // The first docx parse loads the parser cold; in a full parallel run that has passed 5s.
  }, 60_000)

  it("reads xlsx as one titled page per sheet", async () => {
    const data = xlsx([{ name: "Parts", rows: [["Air filter", "16x25x1"]] }, { name: "Costs", rows: [["Total", "42"]] }])
    expect((await pages("b.xlsx", data)).pages).toEqual(["Parts\nAir filter\t16x25x1", "Costs\nTotal\t42"])
  })

  it("reads pptx as one page per slide", async () => {
    expect((await pages("c.pptx", pptx(["Welcome to the lake cabin", "Water shutoff is under the stairs"]))).pages)
      .toEqual(["Welcome to the lake cabin", "Water shutoff is under the stairs"])
  })

  it("reads odt", async () => {
    expect((await pages("d.odt", odt(["Roof replaced in 2019 by Acme Roofing."]))).pages).toEqual(["Roof replaced in 2019 by Acme Roofing."])
  })

  it("reads txt, csv and rtf", async () => {
    expect((await pages("e.txt", "hello\nworld")).pages).toEqual(["hello\nworld"])
    expect((await pages("f.csv", "part,size\nfilter,16x25x1")).pages).toEqual(["part,size\nfilter,16x25x1"])
    expect((await pages("g.rtf", "{\\rtf1\\ansi\\pard Oil change.\\par}")).pages).toEqual(["Oil change.\n"])
  })

  it("reads a PDF page by page and leaves blank pages blank with OCR off", async () => {
    const r = await pages("h.pdf", textPdf(["Deductible is 500 dollars", "", "Page three text"]))
    expect(r).toEqual({ kind: "text", method: "TEXT", pages: ["Deductible is 500 dollars", "", "Page three text"] })
  })

  it("returns no pages for an image when OCR is off", async () => {
    expect((await pages("i.png", textImage("Receipt total 42.17").data)).pages).toEqual([])
  })
})

describe("extractFile — OCR", () => {
  it("reads text from a photo", async () => {
    const r = await pages("j.png", textImage("Receipt total 42.17").data, true)
    expect(r.method).toBe("OCR")
    expect(r.pages[0]).toContain("Receipt total 42.17")
  }, 60_000)

  it("OCRs a scanned PDF page", async () => {
    const r = await pages("k.pdf", scannedPdf("Policy number AB12345"), true)
    expect(r.method).toBe("OCR")
    expect(r.pages[0]).toContain("AB12345")
  }, 60_000)
})

describe("extractFile — failures", () => {
  it("reports unsupported types", async () => {
    expect(await extractFile(put("x.heic", "x"), ".heic", { ocr: true })).toEqual({ kind: "unsupported" })
    expect(await extractFile(put("x.zip", "x"), ".zip", { ocr: true })).toEqual({ kind: "unsupported" })
  })

  it.each([
    ["bad.pdf", "Not a readable PDF"],
    ["bad.docx", "Not a readable document"],
    ["bad.doc", "Not a readable Word document"],
  ])("turns a corrupt %s into a fixed phrase", async (name, message) => {
    await expect(extractFile(put(name, "this is not really that kind of file"), path.extname(name), { ocr: false }))
      .rejects.toEqual(new ExtractError(message))
  })

  it("says when the file is missing", async () => {
    await expect(extractFile(path.join(dir, "nope.pdf"), ".pdf", { ocr: false })).rejects.toEqual(new ExtractError("File missing on disk"))
  })

  it("times out with a fixed phrase and runs the cleanup", async () => {
    let cleaned = false
    const never = new Promise<string>(() => {})
    await expect(withTimeout(never, 20, async () => { cleaned = true })).rejects.toEqual(new ExtractError("Timed out after 0s"))
    expect(cleaned).toBe(true)
  })
})
