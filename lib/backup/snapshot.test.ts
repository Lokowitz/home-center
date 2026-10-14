import { describe, expect, it, vi } from "vitest"
import path from "node:path"
import { rename, rm } from "node:fs/promises"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"
import { integrityCheck, latestMigration, modelCounts, referencedFiles, vacuumInto } from "./snapshot"
import { appMigrations } from "./paths"

// Each case builds a migrated SQLite DB and zips it; under a parallel full run that exceeds the 5s default.
vi.setConfig({ testTimeout: 30_000 })

describe("snapshot", () => {
  it("copies a consistent snapshot and reads what it references", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const snap = path.join(dir, "snap.db")
    await vacuumInto(db, snap)
    expect(await integrityCheck(snap)).toBe("ok")
    expect((await referencedFiles(snap)).files).toEqual([...SAMPLE_FILES].sort())
    expect(await latestMigration(snap)).toBe((await appMigrations()).at(-1))
    const counts = await modelCounts(snap)
    expect(counts).toMatchObject({ User: 1, Property: 1, Vehicle: 1, Person: 1, ServiceRecord: 2, Attachment: 2, Medication: 1 })
  })

  it("skips a stored filename that would escape the upload root", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    await c.execute(`UPDATE "Attachment" SET filename = '../../evil' WHERE id = 'a1'`)
    c.close()
    const r = await referencedFiles(db)
    expect(r.files).not.toContain("service/s1/../../evil")
    expect(r.skipped).toEqual(["service/s1/../../evil"])
  })

  it("releases the file so it can be renamed and deleted right after reading", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await modelCounts(db)
    await integrityCheck(db)
    await rename(db, path.join(dir, "moved.db"))
    await vacuumInto(path.join(dir, "moved.db"), db)
    await modelCounts(db)
    await rm(db)
  })
})
