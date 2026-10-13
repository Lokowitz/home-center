import { describe, expect, it } from "vitest"
import path from "node:path"
import { createMigratedDb, tempDir } from "./test-support"
import { openDb } from "./snapshot"
import { rawProtection, readRawSecrets, readRawSettings } from "./raw-settings"

describe("raw settings", () => {
  it("defaults when no row exists", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    expect(await readRawSettings(db)).toMatchObject({ folder: null, keep: 14, protection: "NONE" })
  })
  it("reads a saved row", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute(`INSERT INTO "BackupSettings" (id, folder, keep, protection, publicKey, keyFingerprint, updatedAt) VALUES ('singleton', '/backups', 5, 'KEY', 'age1abc', 'ab12', CURRENT_TIMESTAMP)`)
    c.close()
    const s = await readRawSettings(db)
    expect(s).toMatchObject({ folder: "/backups", keep: 5, protection: "KEY" })
    expect(rawProtection(s)).toEqual({ mode: "key", recipient: "age1abc", fingerprint: "ab12" })
  })
})

describe("raw settings errors", () => {
  it("treats a missing table as defaults", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute(`DROP TABLE "BackupSettings"`)
    c.close()
    expect(await readRawSettings(db)).toMatchObject({ protection: "NONE", keep: 14 })
  })
  it("rethrows other read failures instead of defaulting to unprotected", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute(`DROP TABLE "BackupSettings"`)
    await c.execute(`CREATE TABLE "BackupSettings" (id TEXT PRIMARY KEY)`)
    c.close()
    await expect(readRawSettings(db)).rejects.toThrow(/no such column/i)
  })
  it("rethrows a non-missing-table error when reading secrets", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute(`DROP TABLE "MailSettings"`)
    await c.execute(`CREATE TABLE "MailSettings" (id TEXT PRIMARY KEY)`)
    c.close()
    await expect(readRawSecrets(db)).rejects.toThrow(/no such column/i)
  })
})
