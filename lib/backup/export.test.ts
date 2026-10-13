import { describe, expect, it } from "vitest"
import path from "node:path"
import { createExport } from "./export"
import { createBackup } from "./backup"
import { backupReadable } from "./viewer"
import { ArchiveReader } from "./archive"
import { verifyArchive } from "./verify"
import { createMigratedDb, seedSample, tempDir } from "./test-support"

async function setup() {
  const dir = await tempDir()
  const dbPath = path.join(dir, "homecenter.db")
  const uploadDir = path.join(dir, "uploads")
  await createMigratedDb(dbPath)
  await seedSample(dbPath, uploadDir)
  return { dir, dbPath, uploadDir, workDir: path.join(dir, "work") }
}

describe("exports", () => {
  it("everything without health: readable files, no database, refuses restore", async () => {
    const s = await setup()
    const out = await createExport({ ...s, outDir: path.join(s.dir, "out"), appVersion: "t", scope: { kind: "all", includeHealth: false }, now: new Date(2026, 9, 11, 9, 30) })
    expect(out.file).toBe("homecenter-export-2026-10-11-0930.zip")
    const r = await ArchiveReader.open(out.path)
    const names = r.entries()
    expect(names).not.toContain("db/homecenter.db")
    expect(names).toContain("readable/index.html")
    expect(names).toContain("readable/csv/service-records.csv")
    expect(names).toContain("files/Vehicles/Daily Driver/service/receipt.pdf")
    expect(names.some((n) => n.includes("visit.pdf"))).toBe(false)
    expect(names).not.toContain("readable/csv/medications.csv")
    const m = await r.manifest()
    await r.close()
    expect(m).toMatchObject({ kind: "export", scope: { kind: "all", includeHealth: false }, hasReadable: true })
    expect((await verifyArchive(out.path, { workDir: s.workDir })).ok).toBe(true)
  })

  it("password export double-wraps", async () => {
    const s = await setup()
    const out = await createExport({ ...s, outDir: path.join(s.dir, "out"), appVersion: "t", scope: { kind: "all", includeHealth: true }, password: "abcdef" })
    const r = await ArchiveReader.open(out.path)
    expect(r.entries()).toEqual([out.file.replace(/\.zip$/, "-inner.zip")])
    await r.close()
  })

  it("backups carry the readable layer pointing at their own files", async () => {
    const s = await setup()
    const b = await createBackup({ ...s, folder: path.join(s.dir, "b"), appVersion: "t", protection: { mode: "none" }, readable: backupReadable })
    const r = await ArchiveReader.open(b.path)
    const js = await r.readText("readable/data.js")
    expect(js).toContain('"../files/service/s1/f-a1.pdf"')
    expect((await r.manifest()).hasReadable).toBe(true)
    await r.close()
  })
})
