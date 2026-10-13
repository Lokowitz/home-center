import { describe, expect, it } from "vitest"
import path from "node:path"
import { createMigratedDb, seedSample, tempDir } from "./test-support"
import { openDb, releaseDbHandles } from "./snapshot"
import { csvTables, exportPlacement, loadReadable, rawPlacement, toCsv } from "./readable"

async function snap() {
  const dir = await tempDir()
  const db = path.join(dir, "x.db")
  await createMigratedDb(db)
  await seedSample(db, path.join(dir, "uploads"))
  return db
}

describe("readable", () => {
  it("everything: assets, records with file links, health", async () => {
    const { data, files } = await loadReadable(await snap(), { kind: "all", includeHealth: true }, rawPlacement)
    expect(data.assets.map((a) => a.name).sort()).toEqual(["Daily Driver", "Main House", "Pat"])
    const oil = data.serviceRecords.find((r) => r.title === "Oil change")!
    expect(oil).toMatchObject({ assetId: "v1", cost: 49.5 })
    expect(oil.files[0]).toMatchObject({ name: "receipt.pdf", path: "../files/service/s1/f-a1.pdf" })
    expect(data.health?.medications.map((m) => m.name)).toEqual(["Ibuprofen"])
    expect(files.map((f) => f.rel).sort()).toEqual(["properties/p1/img-p1.jpg", "service/s1/f-a1.pdf", "service/s2/f-a2.pdf"])
  })

  it("excluding health drops people, their records and their files", async () => {
    const { data, files } = await loadReadable(await snap(), { kind: "all", includeHealth: false }, rawPlacement)
    expect(data.assets.some((a) => a.type === "person")).toBe(false)
    expect(data.serviceRecords.map((r) => r.title)).toEqual(["Oil change"])
    expect(data.health).toBeNull()
    expect(files.map((f) => f.rel)).not.toContain("service/s2/f-a2.pdf")
  })

  it("one asset", async () => {
    const { data } = await loadReadable(await snap(), { kind: "asset", assetType: "VEHICLE", assetId: "v1" }, rawPlacement)
    expect(data.assets.map((a) => a.id)).toEqual(["v1"])
    expect(data.serviceRecords).toHaveLength(1)
  })

  const asset = (name: string) => ({ id: "v1", type: "vehicle" as const, name, details: {}, photo: null, propertyId: null })

  it("export paths are flattened and never escape", () => {
    const place = exportPlacement()
    const a = asset("../../Daily/Driver")
    const first = place({ rel: "x", asset: a, section: "service", originalName: "../../etc/passwd" })
    expect(first).toBe("files/Vehicles/_._Daily_Driver/service/_._etc_passwd")
    expect(place({ rel: "y", asset: a, section: "service", originalName: "../../etc/passwd" })).toBe(`${first} (2)`)
    expect(place({ rel: "z", asset: null, section: "insurance", originalName: "CON" })).toBe("files/Other/insurance/_CON")
  })

  it("odd asset names stay inside files/ with safe segments", () => {
    const place = exportPlacement()
    const names = ["../../x", "CON", "", "a".repeat(500), "🚗".repeat(200), "  ..hidden. ", 'a:b*c?d"e<f>g|h', "nul.txt", "x\u0000y\tz", "COM1", "lpt9.log"]
    for (const [i, name] of names.entries()) {
      for (const originalName of ["ok.pdf", "..", "", "AUX.pdf", "b".repeat(400) + ".pdf", "\\server\\share"]) {
        const p = place({ rel: `r${i}`, asset: asset(name), section: "service", originalName })
        expect(p.startsWith("files/Vehicles/")).toBe(true)
        const segs = p.split("/")
        expect(segs).toHaveLength(5)
        for (const seg of segs) {
          expect(seg).not.toBe("")
          expect(seg).not.toMatch(/[\\:*?"<>|\u0000-\u001f]/)
          expect(seg).not.toMatch(/\.\./)
          expect(seg).not.toMatch(/[. ]$/)
          expect(seg).not.toMatch(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i)
          expect(Buffer.byteLength(seg)).toBeLessThanOrEqual(150)
        }
        expect(segs[2]).not.toMatch(/^\./)
        expect(segs[4]).not.toMatch(/^\./)
      }
    }
    expect(place({ rel: "e", asset: asset(""), section: "service", originalName: "k.pdf" })).toBe("files/Vehicles/_/service/k.pdf")
  })

  it("numbers duplicate file names, keeping the extension, ignoring case", () => {
    const place = exportPlacement()
    const a = asset("Car")
    const f = (rel: string, originalName: string) => place({ rel, asset: a, section: "service", originalName })
    expect(f("1", "receipt.pdf")).toBe("files/Vehicles/Car/service/receipt.pdf")
    expect(f("2", "receipt.pdf")).toBe("files/Vehicles/Car/service/receipt (2).pdf")
    expect(f("3", "RECEIPT.PDF")).toBe("files/Vehicles/Car/service/RECEIPT (3).PDF")
    expect(f("4", "receipt (2).pdf")).toBe("files/Vehicles/Car/service/receipt (2) (2).pdf")
  })

  it("rawPlacement paths from unsafe DB values are skipped, not planned", async () => {
    const db = await snap()
    const c = openDb(db)
    try {
      await c.execute(`UPDATE "Attachment" SET filename = '../../outside.pdf' WHERE id = 'a1'`)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data, files } = await loadReadable(db, { kind: "all", includeHealth: true }, rawPlacement)
    expect(files.map((f) => f.rel)).not.toContain("service/s1/../../outside.pdf")
    expect(files.every((f) => !f.archivePath.includes(".."))).toBe(true)
    expect(data.serviceRecords.find((r) => r.id === "s1")!.files).toEqual([])
  })

  it("csv quotes, escapes and starts with a BOM", () => {
    const csv = toCsv([{ a: 'say "hi"', b: "x,y", c: null }], ["a", "b", "c"])
    expect(csv).toBe('\uFEFFa,b,c\r\n"say ""hi""","x,y",\r\n')
  })

  it("csv quotes embedded newlines and neutralises formulas", () => {
    const row = { a: "line1\nline2", b: "=SUM(A1)", c: "+1", d: "-2x", e: "@cmd", f: "\tx", g: "\rx", h: -5, i: "ok=fine", j: '="q",z' }
    const csv = toCsv([row], ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])
    expect(csv).toBe("\uFEFFa,b,c,d,e,f,g,h,i,j\r\n" + [`"line1\nline2"`, "'=SUM(A1)", "'+1", "'-2x", "'@cmd", "'\tx", `"'\rx"`, "-5", "ok=fine", `"'=""q"",z"`].join(",") + "\r\n")
  })

  it("builds the csv set", async () => {
    const { data } = await loadReadable(await snap(), { kind: "all", includeHealth: true }, rawPlacement)
    expect(Object.keys(csvTables(data)).sort()).toEqual(
      ["allergies.csv", "assets.csv", "conditions.csv", "documents.csv", "immunizations.csv", "insurance.csv", "medications.csv", "observations.csv", "providers.csv", "reminders.csv", "service-records.csv", "warranties.csv"])
  })
})
