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

  it("lists room files, and still reads a backup made before rooms existed", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    await c.executeMultiple(`
      INSERT INTO "Room" (id, propertyId, name, updatedAt) VALUES ('r1', 'p1', 'Kitchen', '2026-01-01T00:00:00.000Z');
      INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, roomId) VALUES ('a9', 'ROOM', 'f-a9.jpg', 'k.jpg', 'image/jpeg', 1, 'u1', 'r1');
    `)
    expect((await referencedFiles(db)).files).toContain("room/r1/f-a9.jpg")
    expect(await modelCounts(db)).toMatchObject({ Room: 1, RoomPaint: 0 })
    c.close()
    // A database from before rooms: no Room tables, no Attachment.roomId.
    const old = path.join(dir, "old.db")
    await createMigratedDb(old, { upTo: "20261022023010_add_mail_public_url" })
    expect((await referencedFiles(old)).files).toEqual([])
    expect(await modelCounts(old)).toMatchObject({ Room: 0, RoomPaint: 0 })
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
