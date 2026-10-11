import { describe, expect, it, vi } from "vitest"
import path from "node:path"
import { readdir } from "node:fs/promises"
import { createBackup } from "./backup"
import { createMigratedDb, seedSample, tempDir } from "./test-support"

vi.mock("./verify", () => ({ verifyArchive: async () => ({ ok: false, error: "forced" }) }))

describe("createBackup failure", () => {
  it("leaves no archive or sidecar in the folder when verification fails", async () => {
    const dir = await tempDir()
    const dbPath = path.join(dir, "homecenter.db")
    const uploadDir = path.join(dir, "uploads")
    await createMigratedDb(dbPath)
    await seedSample(dbPath, uploadDir)
    const folder = path.join(dir, "backups")
    const workDir = path.join(dir, "work")
    await expect(createBackup({ dbPath, uploadDir, folder, workDir, appVersion: "t", protection: { mode: "none" } }))
      .rejects.toThrow("failed verification")
    expect(await readdir(folder)).toEqual([])
    expect(await readdir(workDir)).toEqual([])
  })
})
