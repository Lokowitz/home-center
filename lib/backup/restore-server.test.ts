import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMigratedDb, tempDir, writeFiles } from "./test-support"
import { openDb, releaseDbHandles } from "./snapshot"

// Creating a migrated SQLite file is slow on Windows under a parallel full run.
vi.setConfig({ testTimeout: 30_000 })

const db = vi.hoisted(() => ({
  mailUpsert: vi.fn(), llmUpsert: vi.fn(), pushUpsert: vi.fn(), userFind: vi.fn(), userUpdate: vi.fn(), deleteMany: vi.fn(), runFind: vi.fn(), runCreate: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mailSettings: { upsert: db.mailUpsert }, llmSettings: { upsert: db.llmUpsert }, notificationSettings: { upsert: db.pushUpsert },
    user: { findMany: db.userFind, update: db.userUpdate },
    backupRun: { deleteMany: db.deleteMany, findFirst: db.runFind, create: db.runCreate },
  },
}))
vi.mock("@/lib/notifications/mail-config", () => ({ SETTINGS_ID: "singleton" }))
const alert = vi.hoisted(() => ({ raise: vi.fn() }))
vi.mock("./alerts-server", () => ({ raiseBackupAlert: alert.raise }))
const cfg = vi.hoisted(() => ({ folder: null as string | null }))
vi.mock("./settings-server", () => ({
  loadBackupSettings: async () => ({ folder: cfg.folder }),
  backupFolder: (s: { folder: string | null }) => s.folder ?? "/elsewhere/backups",
}))

import { clearWorkDir, finalizeRestore } from "./restore-server"
import { preDirFor } from "./restore"

const result = { status: "ok", error: null, backupCreatedAt: "2026-01-02T03:04:05.000Z", appliedAt: "2026-02-01T00:00:00.000Z", source: "backup", finalized: false, rolledBack: true, recoveryDirs: [] }

describe("finalizeRestore", () => {
  let dir: string
  let root: string
  const saved = { url: process.env.DATABASE_URL, upload: process.env.UPLOAD_DIR }
  afterEach(() => {
    for (const [k, v] of [["DATABASE_URL", saved.url], ["UPLOAD_DIR", saved.upload]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    cfg.folder = null
    root = await tempDir("hc-final-")
    process.env.UPLOAD_DIR = path.join(root, "uploads")
    process.env.DATABASE_URL = "file:" + path.join(root, "homecenter.db").replace(/\\/g, "/")
    dir = path.join(root, "restore")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "result.json"), JSON.stringify(result))
    await writeFile(path.join(dir, "secrets.enc.json"), JSON.stringify({ mailPasswordEnc: "enc-mail", llmApiKeyEnc: "enc-llm", pushUrlEnc: "enc-url", pushTokenEnc: "enc-tok" }))
    db.runFind.mockResolvedValue(null)
    db.userFind.mockResolvedValue([{ id: "u1", sessionVersion: 5 }, { id: "u2", sessionVersion: 0 }])
  })

  const versionsSet = () => Object.fromEntries(db.userUpdate.mock.calls.map(([a]) => [a.where.id, a.data.sessionVersion as number]))

  /** The household the restore displaced, in its pre-* folder, with every account at version v. */
  async function displaced(v: number) {
    const pre = preDirFor(dir, result.appliedAt)
    await mkdir(pre, { recursive: true })
    const p = path.join(pre, "homecenter.db")
    await createMigratedDb(p)
    const c = openDb(p)
    await c.execute({ sql: `INSERT INTO "User" (id, name, email, passwordHash, role, sessionVersion) VALUES ('u1', 'A', 'a@example.test', 'h', 'ADMIN', ?)`, args: [v] })
    c.close()
    await releaseDbHandles()
  }

  it("re-wraps carried secrets, deletes the file, signs everyone out and marks it finalized", async () => {
    await finalizeRestore()
    expect(db.mailUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { passwordEnc: "enc-mail" } }))
    expect(db.llmUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { apiKeyEnc: "enc-llm" } }))
    expect(db.pushUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { pushUrlEnc: "enc-url", pushTokenEnc: "enc-tok" } }))
    expect(existsSync(path.join(dir, "secrets.enc.json"))).toBe(false)
    expect(db.userUpdate).toHaveBeenCalledTimes(2)
    expect(db.runCreate).toHaveBeenCalledTimes(1)
    expect(alert.raise).toHaveBeenCalledWith(`restore:${result.appliedAt}`, expect.stringContaining("Restored from the backup"), expect.any(String))
    expect(JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")).finalized).toBe(true)
  })

  it("a second boot after finalizing does nothing", async () => {
    await finalizeRestore()
    vi.clearAllMocks()
    await finalizeRestore()
    expect(db.userUpdate).not.toHaveBeenCalled()
    expect(db.runCreate).not.toHaveBeenCalled()
    expect(alert.raise).not.toHaveBeenCalled()
  })

  it("a crash after the secrets were moved is finished by the next boot without losing them or logging twice", async () => {
    alert.raise.mockRejectedValueOnce(new Error("crash"))
    await expect(finalizeRestore()).rejects.toThrow("crash")
    expect(existsSync(path.join(dir, "secrets.enc.json"))).toBe(false) // already in the settings rows
    expect(JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")).finalized).toBe(false)

    db.runFind.mockResolvedValue({ id: "r1" }) // the first pass already logged the RESTORE run
    await finalizeRestore()
    expect(db.runCreate).toHaveBeenCalledTimes(1) // not again
    expect(alert.raise).toHaveBeenCalledTimes(2) // dedupe by cycleKey lives in raiseBackupAlert
    expect(JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")).finalized).toBe(true)
  })

  it("a failed restore leaves secrets and sessions alone and says so", async () => {
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, status: "failed", error: "disk went away" }))
    await finalizeRestore()
    expect(db.userUpdate).not.toHaveBeenCalled()
    expect(db.mailUpsert).not.toHaveBeenCalled()
    expect(alert.raise).toHaveBeenCalledWith(expect.any(String), "Restore didn't finish", expect.stringContaining("Nothing was changed"))
  })

  it("does not finalize a failure that displaced data until it is acknowledged", async () => {
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, status: "failed", error: "x", rolledBack: false, recoveryDirs: ["/d"] }))
    await finalizeRestore()
    expect(alert.raise).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")).finalized).toBe(false)
  })

  it("does nothing when no restore happened", async () => {
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, finalized: true }))
    await finalizeRestore()
    expect(alert.raise).not.toHaveBeenCalled()
  })

  it("signs everyone out even when the restored data holds the version sessions already carry", async () => {
    // Undo after a restore: the displaced household was bumped to 6, and the one coming back has 5 -> +1 would be 6 again.
    await displaced(6)
    const now = new Date("2026-02-01T00:00:30.000Z")
    await finalizeRestore(now)
    const v = versionsSet()
    const minutes = Math.floor(now.getTime() / 60_000)
    expect(v.u1).toBe(Math.max(6, minutes, 7))
    expect(v.u1).not.toBe(6)
    expect(v.u2).toBe(v.u1)
    expect(v.u1).toBeLessThan(2 ** 31) // fits the Int column
  })

  it("goes past every version the displaced household issued, even above the clock", async () => {
    await displaced(90_000_000)
    await finalizeRestore(new Date("2026-02-01T00:00:30.000Z"))
    expect(versionsSet()).toEqual({ u1: 90_000_001, u2: 90_000_001 })
  })

  it("never lowers a version and uses minutes since epoch when no displaced data is left", async () => {
    db.userFind.mockResolvedValue([{ id: "u1", sessionVersion: 99_000_000 }])
    const now = new Date("2026-02-01T00:00:30.000Z")
    await finalizeRestore(now)
    expect(versionsSet()).toEqual({ u1: 99_000_001 })
    vi.clearAllMocks()
    db.userFind.mockResolvedValue([{ id: "u1", sessionVersion: 3 }])
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, appliedAt: "2026-02-02T00:00:00.000Z" }))
    await finalizeRestore(now)
    expect(versionsSet()).toEqual({ u1: Math.floor(now.getTime() / 60_000) })
  })

  it("clears leftover plaintext work files at boot, keeps the folder and anything that isn't a work file", async () => {
    const work = path.join(root, "backup-work")
    await writeFiles(work, {
      "snapshot-1a2b3c4d.db": "plain", "1a2b3c4d.hcbackup": "plain archive with secrets.json", "export-0f0f0f0f.db": "x",
      "0f0f0f0f-export.zip": "x", "verify-cli-3.hcbackup": "x", "exports/run1/homecenter-export.zip": "x",
      "homecenter-2026-01-01-0300.hcbackup": "a real backup someone put here", "notes.txt": "mine",
    })
    await finalizeRestore()
    expect((await readdir(work)).sort()).toEqual(["homecenter-2026-01-01-0300.hcbackup", "notes.txt"])
    await writeFiles(work, { "snapshot-2b3c4d5e.db": "plain" })
    alert.raise.mockRejectedValueOnce(new Error("crash"))
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, appliedAt: "2026-02-03T00:00:00.000Z" }))
    await expect(finalizeRestore()).rejects.toThrow("crash")
    expect(await readdir(work)).not.toContain("snapshot-2b3c4d5e.db") // cleared even when finishing the notice failed
  })

  it("refuses to clear the work folder when it holds live data or backups", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const work = path.join(root, "backup-work")
    await writeFiles(work, { "snapshot-1a2b3c4d.db": "x", "uploads/receipt.pdf": "the only copy" })
    for (const setup of [
      () => { process.env.UPLOAD_DIR = path.join(work, "uploads") },
      () => { process.env.UPLOAD_DIR = path.join(root, "uploads"); cfg.folder = work },
    ]) {
      setup()
      await finalizeRestore()
      expect((await readdir(work)).sort()).toEqual(["snapshot-1a2b3c4d.db", "uploads"])
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not clearing"))
    warn.mockRestore()
  })

  it("deletes nothing when the safety check itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const work = path.join(root, "backup-work")
    await writeFiles(work, { "snapshot-1a2b3c4d.db": "x" })
    const failing = { realpath: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }) }, stat: async () => ({ dev: BigInt(1), ino: BigInt(1) }) }
    expect(await clearWorkDir(work, [{ path: path.join(root, "backups"), label: "backup folder", both: true }], failing)).toBe(false)
    expect(await readdir(work)).toEqual(["snapshot-1a2b3c4d.db"])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not clearing .*EACCES/))
    warn.mockRestore()
  })
})
