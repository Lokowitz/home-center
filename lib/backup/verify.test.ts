import { describe, expect, it } from "vitest"
import path from "node:path"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { ArchiveWriter } from "./archive"
import { checkCompatibility, verifyArchive } from "./verify"
import { createMigratedDb, tempDir } from "./test-support"
import { vacuumInto } from "./snapshot"
import { DB_ENTRY, FORMAT_VERSION, type Manifest } from "./format"

const meta = (over: Partial<Manifest> = {}): Omit<Manifest, "files"> => ({
  formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: "t", migration: "20260101000000_a",
  createdAt: new Date(0).toISOString(), protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false, ...over,
})

async function goodArchive(dir: string) {
  const db = path.join(dir, "live.db")
  await createMigratedDb(db)
  const snap = path.join(dir, "snap.db")
  await vacuumInto(db, snap)
  const out = path.join(dir, "ok.hcbackup")
  const w = await ArchiveWriter.create(out)
  await w.addFile(DB_ENTRY, snap)
  await w.addBytes("files/x.txt", "x")
  await w.finish(meta())
  return out
}

describe("verifyArchive", () => {
  it("accepts a good archive", async () => {
    const dir = await tempDir()
    const work = path.join(dir, "work")
    await mkdir(work)
    const r = await verifyArchive(await goodArchive(dir), { workDir: work })
    expect(r.ok).toBe(true)
    expect(await readdir(work)).toEqual([])
  })

  it("refuses a zip without a manifest", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "plain.zip")
    // An ordinary zip, written directly with zip.js.
    const { ZipWriter, Uint8ArrayReader } = await import("@zip.js/zip.js")
    const chunks: Uint8Array[] = []
    const zw = new ZipWriter(new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) }))
    await zw.add("a.txt", new Uint8ArrayReader(new TextEncoder().encode("a")))
    await zw.close()
    await writeFile(out, Buffer.concat(chunks))
    expect(await verifyArchive(out, { workDir: dir })).toEqual({ ok: false, error: "No manifest.json: not a HomeCenter archive." })
  })

  it("refuses a file that is not a zip", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "junk.hcbackup")
    await writeFile(out, "not a zip")
    expect(await verifyArchive(out, { workDir: dir })).toMatchObject({ ok: false, error: "Not a HomeCenter archive (it can't be opened as a zip)." })
  })

  it("refuses an archive from a newer format", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "new.hcbackup")
    const w = await ArchiveWriter.create(out)
    await w.finish(meta({ formatVersion: FORMAT_VERSION + 1, kind: "export" }))
    expect(await verifyArchive(out, { workDir: dir })).toMatchObject({ ok: false, error: expect.stringContaining("newer HomeCenter") })
  })
})

describe("checkCompatibility", () => {
  const known = ["20260101000000_a", "20260201000000_b"]
  const m = (over: Partial<Manifest>) => ({ ...meta(over), files: [] }) as Manifest
  it("accepts a known migration", () => expect(checkCompatibility(m({ migration: "20260101000000_a" }), known)).toEqual({ ok: true }))
  it("refuses an export", () => expect(checkCompatibility(m({ kind: "export" }), known)).toMatchObject({ ok: false, reason: expect.stringContaining("export") }))
  it("refuses a newer migration", () =>
    expect(checkCompatibility(m({ migration: "20270101000000_z" }), known)).toMatchObject({ ok: false, reason: expect.stringContaining("Update HomeCenter first") }))
  it("refuses an unknown older migration", () =>
    expect(checkCompatibility(m({ migration: "20260115000000_fork" }), known)).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't know") }))
})
