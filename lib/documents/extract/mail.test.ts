import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import * as XLSX from "@e965/xlsx"
import { extractFile } from "./index"

const utf16 = (s: string) => Buffer.from(s, "utf16le")
const u8 = (b: Buffer) => new Uint8Array(b)

async function extract(name: string, data: Buffer | string) {
  const dir = mkdtempSync(path.join(tmpdir(), "hc-mail-"))
  try {
    const p = path.join(dir, name)
    writeFileSync(p, data)
    return await extractFile(p, path.extname(name), { ocr: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function text(name: string, data: Buffer | string): Promise<string[]> {
  const r = await extract(name, data)
  if (r.kind !== "text") throw new Error(`expected text, got ${r.kind}`)
  return r.pages
}

describe("extractFile — email and legacy formats", () => {
  it("reads an .eml: headers, body and attachment name", async () => {
    const eml = [
      "From: Pat Smith <pat@example.com>",
      "To: sam@example.com",
      "Subject: Dishwasher warranty claim",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("Claim number 88214 approved.").toString("base64"),
    ].join("\r\n")
    const [page] = await text("a.eml", eml)
    expect(page).toContain("Subject: Dishwasher warranty claim")
    expect(page).toContain("Pat Smith <pat@example.com>")
    expect(page).toContain("Claim number 88214 approved.")
  })

  it("falls back to the html part of an .eml", async () => {
    const eml = ["Subject: Hi", "Content-Type: text/html", "", "<p>Serial <b>XJ-77</b></p>"].join("\r\n")
    expect((await text("h.eml", eml))[0]).toContain("Serial XJ-77")
  })

  it("reads an Outlook .msg", async () => {
    const cfb = XLSX.CFB.utils.cfb_new()
    XLSX.CFB.utils.cfb_add(cfb, "__properties_version1.0", u8(Buffer.alloc(32)))
    XLSX.CFB.utils.cfb_add(cfb, "__substg1.0_0037001F", u8(utf16("Fridge compressor warranty")))
    XLSX.CFB.utils.cfb_add(cfb, "__substg1.0_1000001F", u8(utf16("Order 5521 is covered until 2027.")))
    const msg = Buffer.from(XLSX.CFB.write(cfb, { type: "buffer" }) as Uint8Array)
    const [page] = await text("a.msg", msg)
    expect(page).toContain("Subject: Fridge compressor warranty")
    expect(page).toContain("Order 5521 is covered until 2027.")
  })

  it("reads every sheet of an .xls", async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Cost"], ["Water heater", "1200"]]), "Costs")
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Roof", "2031"]]), "Dates")
    const xls = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Uint8Array)
    const pages = await text("a.xls", xls)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain("Water heater\t1200")
    expect(pages[1]).toContain("Roof\t2031")
  })

  it("reads text atoms of an old .ppt", async () => {
    const atom = (type: number, body: Buffer) => {
      const h = Buffer.alloc(8)
      h.writeUInt16LE(0, 0)
      h.writeUInt16LE(type, 2)
      h.writeUInt32LE(body.length, 4)
      return Buffer.concat([h, body])
    }
    const inner = Buffer.concat([atom(4000, utf16("Winter shutoff checklist")), atom(4008, Buffer.from("Drain outdoor taps", "latin1"))])
    const container = Buffer.alloc(8)
    container.writeUInt16LE(0x000f, 0)
    container.writeUInt16LE(1006, 2)
    container.writeUInt32LE(inner.length, 4)
    const stream = Buffer.concat([container, inner])
    const cfb = XLSX.CFB.utils.cfb_new()
    XLSX.CFB.utils.cfb_add(cfb, "PowerPoint Document", u8(stream))
    const ppt = Buffer.from(XLSX.CFB.write(cfb, { type: "buffer" }) as Uint8Array)
    const [page] = await text("a.ppt", ppt)
    expect(page).toBe("Winter shutoff checklist\n\nDrain outdoor taps")
  })

  it("fails with a fixed phrase on garbage", async () => {
    for (const name of ["x.msg", "x.ppt", "x.xls"]) {
      await expect(extract(name, "this is not that kind of file")).rejects.toThrow(/Not a readable/)
    }
  })
})
