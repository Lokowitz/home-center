import { describe, expect, it } from "vitest"
import path from "node:path"
import { createMigratedDb, tempDir } from "./test-support"
import { openDb } from "./snapshot"
import { rawProtection, readRawSettings } from "./raw-settings"

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
