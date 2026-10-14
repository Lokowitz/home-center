import { describe, expect, it, vi } from "vitest"
import { rm } from "node:fs/promises"
import path from "node:path"
import { createClient } from "@libsql/client"
import { fileUrl } from "./paths"
import { createMigratedDb, seedSample, tempDir } from "./test-support"
import { openDb, releaseDbHandles } from "./snapshot"
import { csvTables, exportPlacement, loadReadable, rawPlacement, toCsv } from "./readable"

// Each case builds a migrated SQLite DB and zips it; under a parallel full run that exceeds the 5s default.
vi.setConfig({ testTimeout: 30_000 })

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
    const names = ["../../x", "CON", "", "a".repeat(500), "🚗".repeat(200), "  ..hidden. ", 'a:b*c?d"e<f>g|h', "nul.txt", "x\u0000y\tz", "COM1", "lpt9.log", "CON .txt", "con  ", "Prn. "]
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

  it("loadReadable releases the snapshot so it can be deleted right away", async () => {
    const db = await snap()
    await loadReadable(db, { kind: "all", includeHealth: true }, rawPlacement)
    await rm(db) // EBUSY on Windows if the handle were still held
  })

  it("odd reserved names with spaces or dots are caught", () => {
    const place = exportPlacement()
    expect(place({ rel: "a", asset: asset("CON ."), section: "s", originalName: "con .txt" })).toBe("files/Vehicles/_CON/s/_con.txt")
    expect(place({ rel: "b", asset: asset("con  "), section: "s", originalName: "x" })).toBe("files/Vehicles/_con/s/x")
  })

  it("property scope includes its equipment, their records and files, and nothing out of scope", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Equipment" (id, name, propertyId, updatedAt) VALUES ('e1', 'Furnace', 'p1', '${t}'), ('e2', 'Loose Mower', NULL, '${t}');
        INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('u2', 'Other', 'o@example.test', 'h', 'ADMIN');
        INSERT INTO "ServiceRecord" (id, assetId, assetType, date, title, createdById, updatedAt) VALUES
          ('s3', 'e1', 'EQUIPMENT', '${t}', 'Filter', 'u2', '${t}'), ('s4', 'e2', 'EQUIPMENT', '${t}', 'Blade', 'u2', '${t}');
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, serviceRecordId) VALUES
          ('a3', 'SERVICE', 'f-a3.pdf', 'filter.pdf', 'application/pdf', 1, 'u2', 's3'),
          ('a4', 'SERVICE', 'f-a4.pdf', 'blade.pdf', 'application/pdf', 1, 'u2', 's4');
        INSERT INTO "Warranty" (id, assetId, assetType, productName, updatedAt) VALUES ('w1', 'e1', 'EQUIPMENT', 'Furnace plan', '${t}'), ('w2', 'v1', 'VEHICLE', 'Car plan', '${t}');
        INSERT INTO "MaintenanceSchedule" (id, assetId, assetType, title, updatedAt) VALUES ('m1x', 'e2', 'EQUIPMENT', 'Sharpen', '${t}'), ('m2x', 'e1', 'EQUIPMENT', 'Change filter', '${t}');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data, files } = await loadReadable(db, { kind: "asset", assetType: "PROPERTY", assetId: "p1" }, rawPlacement)
    expect(data.assets.map((a) => a.id).sort()).toEqual(["e1", "p1"])
    expect(data.serviceRecords.map((r) => r.title)).toEqual(["Filter"])
    expect(data.warranties.map((w) => w.id)).toEqual(["w1"])
    expect(data.reminders.map((r) => r.title)).toEqual(["Change filter"])
    expect(files.map((f) => f.rel).sort()).toEqual(["properties/p1/img-p1.jpg", "service/s3/f-a3.pdf"])
    expect(data.health).toBeNull()
  })

  it("person scope gets only that person's health data and files", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Person" (id, name, updatedAt) VALUES ('h2', 'Sam', '${t}');
        INSERT INTO "Medication" (id, name, personId, updatedAt) VALUES ('m2', 'Aspirin', 'h2', '${t}');
        INSERT INTO "InsurancePolicy" (id, carrier, updatedAt) VALUES ('i1', 'Pat Mutual', '${t}'), ('i2', 'Sam Mutual', '${t}'), ('i3', 'Nobody Mutual', '${t}');
        INSERT INTO "_InsurancePolicyToPerson" (A, B) VALUES ('i1', 'h1'), ('i2', 'h2');
        INSERT INTO "Provider" (id, name, updatedAt) VALUES ('pr1', 'Dr Who', '${t}');
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, insurancePolicyId) VALUES
          ('ai1', 'INSURANCE', 'card1.pdf', 'pat-card.pdf', 'application/pdf', 1, 'u1', 'i1'),
          ('ai2', 'INSURANCE', 'card2.pdf', 'sam-card.pdf', 'application/pdf', 1, 'u1', 'i2');
        INSERT INTO "Warranty" (id, assetId, assetType, productName, updatedAt) VALUES ('w2', 'v1', 'VEHICLE', 'Car plan', '${t}');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data, files } = await loadReadable(db, { kind: "asset", assetType: "PERSON", assetId: "h1" }, rawPlacement)
    expect(data.assets.map((a) => a.id)).toEqual(["h1"])
    expect(data.health!.medications.map((m) => m.name)).toEqual(["Ibuprofen"])
    expect(data.health!.insurance.map((p) => p.carrier)).toEqual(["Pat Mutual"])
    expect(data.health!.providers).toEqual([])
    expect(data.warranties).toEqual([])
    expect(files.map((f) => f.rel).sort()).toEqual(["insurance/i1/card1.pdf", "service/s2/f-a2.pdf"])
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
