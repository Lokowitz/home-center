import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { tempDir } from "./test-support"

const db = vi.hoisted(() => ({
  mailUpsert: vi.fn(), llmUpsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), runFind: vi.fn(), runCreate: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mailSettings: { upsert: db.mailUpsert }, llmSettings: { upsert: db.llmUpsert },
    user: { updateMany: db.updateMany },
    backupRun: { deleteMany: db.deleteMany, findFirst: db.runFind, create: db.runCreate },
  },
}))
vi.mock("@/lib/notifications/mail-config", () => ({ SETTINGS_ID: "singleton" }))
const alert = vi.hoisted(() => ({ raise: vi.fn() }))
vi.mock("./alerts-server", () => ({ raiseBackupAlert: alert.raise }))

import { finalizeRestore } from "./restore-server"

const result = { status: "ok", error: null, backupCreatedAt: "2026-01-02T03:04:05.000Z", appliedAt: "2026-02-01T00:00:00.000Z", source: "backup", finalized: false, rolledBack: true, recoveryDirs: [] }

describe("finalizeRestore", () => {
  let dir: string
  beforeEach(async () => {
    vi.clearAllMocks()
    const root = await tempDir("hc-final-")
    process.env.DATABASE_URL = "file:" + path.join(root, "homecenter.db").replace(/\\/g, "/")
    dir = path.join(root, "restore")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "result.json"), JSON.stringify(result))
    await writeFile(path.join(dir, "secrets.enc.json"), JSON.stringify({ mailPasswordEnc: "enc-mail", llmApiKeyEnc: "enc-llm" }))
    db.runFind.mockResolvedValue(null)
  })

  it("re-wraps carried secrets, deletes the file, signs everyone out and marks it finalized", async () => {
    await finalizeRestore()
    expect(db.mailUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { passwordEnc: "enc-mail" } }))
    expect(db.llmUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { apiKeyEnc: "enc-llm" } }))
    expect(existsSync(path.join(dir, "secrets.enc.json"))).toBe(false)
    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.runCreate).toHaveBeenCalledTimes(1)
    expect(alert.raise).toHaveBeenCalledWith(`restore:${result.appliedAt}`, expect.stringContaining("Restored from the backup"), expect.any(String))
    expect(JSON.parse(await readFile(path.join(dir, "result.json"), "utf8")).finalized).toBe(true)
  })

  it("a second boot after finalizing does nothing", async () => {
    await finalizeRestore()
    vi.clearAllMocks()
    await finalizeRestore()
    expect(db.updateMany).not.toHaveBeenCalled()
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
    expect(db.updateMany).not.toHaveBeenCalled()
    expect(db.mailUpsert).not.toHaveBeenCalled()
    expect(alert.raise).toHaveBeenCalledWith(expect.any(String), "Restore didn't finish", expect.stringContaining("Nothing was changed"))
  })

  it("does nothing when no restore happened", async () => {
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, finalized: true }))
    await finalizeRestore()
    expect(alert.raise).not.toHaveBeenCalled()
  })
})
