import { describe, expect, it, beforeAll, vi } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { ArchiveWriter } from "./archive"
import { createBackup } from "./backup"
import { DB_ENTRY, FORMAT_VERSION } from "./format"
import { appMigrations } from "./paths"
import { applyPending, dryRun, latestPre, prunePre, readResult, stage, stageUndo, type RestorePaths } from "./restore"
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

/** Hash of the live DB bytes plus every upload (path and content). */
async function fingerprint(paths: RestorePaths): Promise<string> {
  const h = createHash("sha256")
  h.update(await readFile(paths.dbPath))
  const walk = async (dir: string, rel: string) => {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel + e.name + "/")
      else h.update(rel + e.name).update(await readFile(path.join(dir, e.name)))
    }
  }
  await walk(paths.uploadDir, "")
  return h.digest("hex")
}

const failAt4 = () => {
  let calls = 0
  return (async (a: string, b: string) => {
    if (++calls === 4) throw new Error("disk went away")
    await rename(a, b)
  }) as typeof rename
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
    const before = await fingerprint(paths)
    const r = await applyPending(paths, new Date(), { rename: failAt4() })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", error: "disk went away", rolledBack: true, recoveryDirs: [] } })
    expect(await fingerprint(paths)).toBe(before) // byte for byte the original
    expect((await modelCounts(paths.dbPath)).User).toBe(1) // the original household
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
    for (const f of SAMPLE_FILES) expect(existsSync(path.join(paths.uploadDir, ...f.split("/")))).toBe(false)
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
  it("returns ok:false instead of throwing for a valid archive holding a corrupt database", async () => {
    const { paths } = await world()
    const dir = await tempDir("hc-bad-")
    const known = await appMigrations()
    const w = await ArchiveWriter.create(path.join(dir, "bad.hcbackup"))
    await w.addBytes(DB_ENTRY, "this is not a sqlite database at all, just text padding".repeat(40))
    const { path: archive } = await w.finish({
      formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: "t", migration: known.at(-1)!,
      createdAt: new Date().toISOString(), protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false,
    })
    expect(await dryRun({ archivePath: archive, secret: {}, paths, known })).toMatchObject({ ok: false })
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
    expect(await applyPending(paths, new Date(Date.now() + 1000), { rename: failAt4() })).toMatchObject({ result: { status: "failed" } })
    expect((await modelCounts(paths.dbPath)).ServiceRecord).toBe(2) // still the restored household
    expect(await latestPre(paths.restoreDir)).not.toBeNull()
    await stageUndo({ paths })
    await applyPending(paths)
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
  })
})

describe("restore failure handling", () => {
  const stageFresh = async (w: Awaited<ReturnType<typeof world>>) => {
    await dryRun({ archivePath: w.backup.path, secret: {}, paths: w.paths, known: await appMigrations() })
    await stage({ paths: w.paths })
  }
  const later = () => new Date(Date.now() + 1000)
  const always = (async () => {
    throw new Error("rollback refused")
  }) as unknown as typeof rename
  /** Rollback moves fail, but renaming a dir to failed-* works. */
  const onlyPreserve = (async (a: string, b: string) => {
    if (!path.basename(b).startsWith("failed-")) throw new Error("rollback refused")
    await rename(a, b)
  }) as typeof rename

  it("a failed rollback renames displaced data to failed-* and later work never deletes it", async () => {
    const w = await world()
    await stageFresh(w)
    const r = await applyPending(w.paths, new Date(), { rename: failAt4(), rollbackRename: onlyPreserve })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", rolledBack: false } })
    if (!r.applied) return
    expect(r.result.recoveryDirs).toHaveLength(2)
    for (const dir of r.result.recoveryDirs) {
      expect(path.basename(dir)).toMatch(/^failed-/)
      expect(existsSync(dir)).toBe(true)
      expect(r.result.error).toContain(dir)
    }
    expect((await readdir(w.paths.restoreDir)).filter((n) => n.startsWith("pre-"))).toEqual([])
    expect(existsSync(path.join(r.result.recoveryDirs[0], "homecenter.db"))).toBe(true) // the previous household's database

    await stageFresh(w) // a later restore is staged ...
    await prunePre(w.paths.restoreDir, new Date("2100-01-01"))
    for (const dir of r.result.recoveryDirs) expect(existsSync(dir)).toBe(true)
  })

  it("when even renaming fails, the dirs are marked and stage, prune and undo leave them alone", async () => {
    const w = await world()
    await stageFresh(w)
    const r = await applyPending(w.paths, new Date(), { rename: failAt4(), rollbackRename: always })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", rolledBack: false } })
    if (!r.applied) return
    expect(r.result.recoveryDirs).toHaveLength(2)
    for (const dir of r.result.recoveryDirs) expect(existsSync(path.join(dir, "keep.json"))).toBe(true)
    expect(await latestPre(w.paths.restoreDir)).toBeNull()
    expect(await prunePre(w.paths.restoreDir, new Date("2100-01-01"))).toBe(0)
    await expect(stage({ paths: w.paths })).rejects.toThrow(/failed restore/)
    for (const dir of r.result.recoveryDirs) expect(existsSync(dir)).toBe(true)
  })

  it("a failed undo whose rollback also fails keeps both dirs", async () => {
    const w = await world()
    await stageFresh(w)
    await applyPending(w.paths)
    await stageUndo({ paths: w.paths })
    const r = await applyPending(w.paths, later(), { rename: failAt4(), rollbackRename: onlyPreserve })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", rolledBack: false, source: "undo" } })
    if (!r.applied) return
    expect(r.result.recoveryDirs).toHaveLength(2)
    for (const dir of r.result.recoveryDirs) expect(existsSync(dir)).toBe(true)
    expect(existsSync(path.join(w.paths.restoreDir, "staging"))).toBe(false)
  })

  it("a failed undo that can't hand its snapshot back keeps it (renamed, or marked in place)", async () => {
    const w = await world()
    await stageFresh(w)
    await applyPending(w.paths)
    await stageUndo({ paths: w.paths })
    // only the final staging -> pre-* hand-back fails; the other rollback moves and the preserve rename work
    const noHandBack = (async (a: string, b: string) => {
      if (path.basename(a) === "staging" && path.basename(b).startsWith("pre-")) throw new Error("refused")
      await rename(a, b)
    }) as typeof rename
    const r = await applyPending(w.paths, later(), { rename: failAt4(), rollbackRename: noHandBack })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", rolledBack: true } })
    if (!r.applied) return
    expect(r.result.recoveryDirs).toHaveLength(1)
    expect(existsSync(path.join(r.result.recoveryDirs[0], "homecenter.db"))).toBe(true)

    // second case: staging can't be renamed at all, so it stays in place with a marker
    const w2 = await world()
    await stageFresh(w2)
    await applyPending(w2.paths)
    await stageUndo({ paths: w2.paths })
    const noStagingRename = (async (a: string, b: string) => {
      if (path.basename(a) === "staging") throw new Error("refused")
      await rename(a, b)
    }) as typeof rename
    const r2 = await applyPending(w2.paths, later(), { rename: failAt4(), rollbackRename: noStagingRename })
    expect(r2).toMatchObject({ applied: true, result: { status: "failed", rolledBack: true } })
    const staging = path.join(w2.paths.restoreDir, "staging")
    expect(existsSync(path.join(staging, "homecenter.db"))).toBe(true)
    expect(existsSync(path.join(staging, "keep.json"))).toBe(true)
    await expect(stageUndo({ paths: w2.paths })).rejects.toThrow()
    expect(existsSync(path.join(staging, "homecenter.db"))).toBe(true)
  })

  it("a malformed pending.json is recorded as a failure that changed nothing", async () => {
    const w = await world()
    await mkdir(w.paths.restoreDir, { recursive: true })
    await writeFile(path.join(w.paths.restoreDir, "pending.json"), "{nope")
    const before = await fingerprint(w.paths)
    expect(await applyPending(w.paths)).toMatchObject({ applied: true, result: { status: "failed", rolledBack: true } })
    expect(await fingerprint(w.paths)).toBe(before)
    expect(existsSync(path.join(w.paths.restoreDir, "pending.json"))).toBe(false)
    expect(await applyPending(w.paths)).toEqual({ applied: false })
  })

  it("a staged or rolled-back restore keeps the existing undo point", async () => {
    const w = await world()
    await stageFresh(w)
    await applyPending(w.paths)
    const undoPoint = await latestPre(w.paths.restoreDir)
    expect(undoPoint).not.toBeNull()
    await stageFresh(w) // staged, never applied
    expect((await latestPre(w.paths.restoreDir))?.dir).toBe(undoPoint!.dir)
    await applyPending(w.paths, later(), { rename: failAt4() }) // rolled back
    expect((await latestPre(w.paths.restoreDir))?.dir).toBe(undoPoint!.dir)
  })

  it("an old carried-secrets file is removed when the applied source carries none", async () => {
    const w = await world("password")
    await dryRun({ archivePath: w.backup.path, secret: w.secret, paths: w.paths, known: await appMigrations() })
    await stage({ paths: w.paths })
    await applyPending(w.paths)
    expect(existsSync(path.join(w.paths.restoreDir, "secrets.enc.json"))).toBe(true)
    await stageUndo({ paths: w.paths })
    await applyPending(w.paths, later())
    expect(existsSync(path.join(w.paths.restoreDir, "secrets.enc.json"))).toBe(false)
  })
})
