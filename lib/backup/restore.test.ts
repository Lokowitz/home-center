import { describe, expect, it, beforeAll, vi } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readFile, rename, writeFile } from "node:fs/promises"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { createBackup } from "./backup"
import { appMigrations } from "./paths"
import { applyPending, dryRun, latestPre, readResult, stage, stageUndo, type RestorePaths } from "./restore"
import { modelCounts, openDb, releaseDbHandles } from "./snapshot"
import { fingerprintOf } from "./protect"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"
import { decrypt, encrypt } from "../secret-box"

// Windows handle collection plus zip work is slow under a parallel full run.
vi.setConfig({ testTimeout: 30_000 })

beforeAll(() => {
  process.env.AUTH_SECRET ??= "test-secret-for-restore-tests"
})

/** Source household with a backup; target household with different data. */
async function world(protection: "none" | "key" | "password" = "none") {
  const src = await tempDir("hc-src-")
  const srcDb = path.join(src, "homecenter.db")
  await createMigratedDb(srcDb)
  await seedSample(srcDb, path.join(src, "uploads"))
  let secret = {}
  let cfg: Parameters<typeof createBackup>[0]["protection"] = { mode: "none" }
  if (protection === "key") {
    const id = await generateX25519Identity()
    const recipient = await identityToRecipient(id)
    cfg = { mode: "key", recipient, fingerprint: await fingerprintOf(recipient) }
    secret = { key: id }
  } else if (protection === "password") {
    cfg = { mode: "password", password: "abcdef" }
    secret = { password: "abcdef" }
  }
  const backup = await createBackup({
    dbPath: srcDb, uploadDir: path.join(src, "uploads"), folder: path.join(src, "backups"), workDir: path.join(src, "work"),
    appVersion: "t", protection: cfg, secrets: { mailPassword: "smtp-pw", llmApiKey: null },
  })

  const dst = await tempDir("hc-dst-")
  const paths: RestorePaths = {
    dbPath: path.join(dst, "homecenter.db"), uploadDir: path.join(dst, "uploads"),
    restoreDir: path.join(dst, "restore"), searchIndexPath: path.join(dst, "search-index.db"),
  }
  await createMigratedDb(paths.dbPath)
  await writeFile(paths.searchIndexPath, "index")
  const c = openDb(paths.dbPath)
  await c.execute(`INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('other', 'Other', 'o@example.test', 'h', 'ADMIN')`)
  c.close()
  await releaseDbHandles()
  const { writeFiles } = await import("./test-support")
  await writeFiles(paths.uploadDir, { "service/zz/old.pdf": "old" })
  return { backup, paths, secret }
}

describe("restore", () => {
  it.each(["none", "key", "password"] as const)("round-trips a %s backup into another household", async (protection) => {
    const { backup, paths, secret } = await world(protection)
    const known = await appMigrations()
    const d = await dryRun({ archivePath: backup.path, secret, paths, known })
    expect(d).toMatchObject({ ok: true, secrets: protection === "none" ? "none" : "carried" })
    if (!d.ok) return
    expect(d.backupCounts.ServiceRecord).toBe(2)
    expect(d.currentCounts.User).toBe(1)

    await stage({ paths })
    const r = await applyPending(paths)
    expect(r).toMatchObject({ applied: true, result: { status: "ok" } })

    expect((await modelCounts(paths.dbPath)).ServiceRecord).toBe(2)
    for (const f of SAMPLE_FILES) expect(existsSync(path.join(paths.uploadDir, ...f.split("/")))).toBe(true)
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(false)
    expect(existsSync(paths.searchIndexPath)).toBe(false) // rebuilt on boot
    expect(await latestPre(paths.restoreDir)).not.toBeNull()
    if (protection !== "none") {
      const enc = JSON.parse(await readFile(path.join(paths.restoreDir, "secrets.enc.json"), "utf8"))
      expect(decrypt(enc.mailPasswordEnc)).toBe("smtp-pw")
    }
  })

  it("asks for the key or password, and rejects a wrong one without staging", async () => {
    const { backup, paths } = await world("password")
    const known = await appMigrations()
    expect(await dryRun({ archivePath: backup.path, secret: {}, paths, known })).toMatchObject({ ok: false, needs: "password" })
    expect(await dryRun({ archivePath: backup.path, secret: { password: "nope12" }, paths, known })).toMatchObject({ ok: false, error: expect.stringContaining("doesn't open") })
    await expect(stage({ paths })).rejects.toThrow()
  })

  it("rolls back when apply fails part way", async () => {
    const { backup, paths } = await world()
    await dryRun({ archivePath: backup.path, secret: {}, paths, known: await appMigrations() })
    await stage({ paths })
    let calls = 0
    const flaky = async (a: string, b: string) => {
      if (++calls === 4) throw new Error("disk went away")
      await rename(a, b)
    }
    const r = await applyPending(paths, new Date(), { rename: flaky as typeof rename })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", error: "disk went away" } })
    expect((await modelCounts(paths.dbPath)).User).toBe(1) // the original household
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
    expect(await readResult(paths.restoreDir)).toMatchObject({ status: "failed" })
    expect(await applyPending(paths)).toEqual({ applied: false }) // nothing left pending
  })

  it("undo brings back the household from before the restore", async () => {
    const { backup, paths } = await world()
    await dryRun({ archivePath: backup.path, secret: {}, paths, known: await appMigrations() })
    await stage({ paths })
    await applyPending(paths)
    await stageUndo({ paths })
    await applyPending(paths)
    expect((await modelCounts(paths.dbPath)).ServiceRecord).toBe(0)
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
    expect(await readResult(paths.restoreDir)).toMatchObject({ status: "ok", source: "undo" })
  })

  it("accepts an older-schema backup (migrations upgrade it at boot)", async () => {
    const known = await appMigrations()
    const older = known.at(-2)!
    const src = await tempDir()
    const db = path.join(src, "homecenter.db")
    await createMigratedDb(db, { upTo: older })
    const b = await createBackup({ dbPath: db, uploadDir: path.join(src, "u"), folder: path.join(src, "b"), workDir: path.join(src, "w"), appVersion: "t", protection: { mode: "none" } })
    const { paths } = await world()
    expect(await dryRun({ archivePath: b.path, secret: {}, paths, known })).toMatchObject({ ok: true, manifest: { migration: older } })
  })

  it("reports secrets status for an unprotected backup", async () => {
    const src = await tempDir()
    const db = path.join(src, "homecenter.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute({ sql: `INSERT INTO "MailSettings" (id, passwordEnc, updatedAt) VALUES ('singleton', ?, CURRENT_TIMESTAMP)`, args: [encrypt("pw")] })
    c.close()
    await releaseDbHandles()
    const b = await createBackup({ dbPath: db, uploadDir: path.join(src, "u"), folder: path.join(src, "b"), workDir: path.join(src, "w"), appVersion: "t", protection: { mode: "none" } })
    const { paths } = await world()
    expect(await dryRun({ archivePath: b.path, secret: {}, paths, known: await appMigrations() })).toMatchObject({ ok: true, secrets: "same-secret" })
    process.env.AUTH_SECRET = "a-different-secret"
    expect(await dryRun({ archivePath: b.path, secret: {}, paths, known: await appMigrations() })).toMatchObject({ ok: true, secrets: "re-enter" })
    process.env.AUTH_SECRET = "test-secret-for-restore-tests"
  })
})

describe("restore hardening", () => {
  it("returns ok:false instead of throwing when the database isn't openable", async () => {
    const { paths } = await world()
    const junk = path.join(paths.restoreDir, "..", "junk.hcbackup")
    await writeFile(junk, "not a zip at all")
    expect(await dryRun({ archivePath: junk, secret: {}, paths, known: await appMigrations() })).toMatchObject({ ok: false })
    expect(existsSync(path.join(paths.restoreDir, "work"))).toBe(false)
  })

  it("cancelRestore removes the unlocked archive", async () => {
    const { backup, paths, secret } = await world("password")
    await dryRun({ archivePath: backup.path, secret, paths, known: await appMigrations() })
    expect(existsSync(path.join(paths.restoreDir, "work", "archive.hcbackup"))).toBe(true)
    const { cancelRestore } = await import("./restore")
    await cancelRestore(paths.restoreDir)
    expect(existsSync(path.join(paths.restoreDir, "work"))).toBe(false)
  })

  it("a failed undo keeps the undo snapshot usable", async () => {
    const { backup, paths } = await world()
    await dryRun({ archivePath: backup.path, secret: {}, paths, known: await appMigrations() })
    await stage({ paths })
    await applyPending(paths)
    await stageUndo({ paths })
    let calls = 0
    const flaky = async (a: string, b: string) => {
      if (++calls === 4) throw new Error("boom")
      await rename(a, b)
    }
    expect(await applyPending(paths, new Date(), { rename: flaky as typeof rename })).toMatchObject({ result: { status: "failed" } })
    expect((await modelCounts(paths.dbPath)).ServiceRecord).toBe(2) // still the restored household
    expect(await latestPre(paths.restoreDir)).not.toBeNull()
    await stageUndo({ paths })
    await applyPending(paths)
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
  })
})
