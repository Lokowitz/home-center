import { describe, expect, it, vi } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { createBackup } from "./backup"
import { ArchiveReader } from "./archive"
import { readSidecar } from "./store"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { fingerprintOf, unprotectFile } from "./protect"
import { verifyArchive } from "./verify"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"

// Each case builds a migrated SQLite DB and zips it; under a parallel full run that exceeds the 5s default.
vi.setConfig({ testTimeout: 30_000 })

async function setup() {
  const dir = await tempDir()
  const dbPath = path.join(dir, "homecenter.db")
  const uploadDir = path.join(dir, "uploads")
  await createMigratedDb(dbPath)
  await seedSample(dbPath, uploadDir)
  return { dir, dbPath, uploadDir, folder: path.join(dir, "backups"), workDir: path.join(dir, "work") }
}

describe("createBackup", () => {
  it("writes a verified archive with db, referenced files and a sidecar", async () => {
    const s = await setup()
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "none" }, now: new Date(2026, 9, 11, 3, 0) })
    expect(out.file).toBe("homecenter-2026-10-11-0300.hcbackup")
    expect(out.warnings).toEqual([])
    const r = await ArchiveReader.open(out.path)
    const names = r.entries()
    expect(names).toContain("db/homecenter.db")
    for (const f of SAMPLE_FILES) expect(names).toContain(`files/${f}`)
    const m = await r.manifest()
    expect(m).toMatchObject({ kind: "backup", protection: "none", hasSecrets: false })
    expect(m.counts.ServiceRecord).toBe(2)
    await r.close()
    expect(await readSidecar(out.path + ".meta.json")).toMatchObject({ file: out.file, kind: "backup", size: out.sidecar.size })
    expect(await readdir(s.workDir)).toEqual([]) // snapshot cleaned up
  })

  it("succeeds with a warning when an upload is missing", async () => {
    const s = await setup()
    await rm(path.join(s.uploadDir, SAMPLE_FILES[0]))
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "none" } })
    expect(out.warnings).toEqual([`Missing file: ${SAMPLE_FILES[0]}`])
    expect(out.sidecar.warningCount).toBe(1)
  })

  it("refuses a folder that does not exist instead of creating it", async () => {
    const s = await setup()
    await expect(createBackup({ ...s, folder: path.join(s.dir, "unmounted", "share"), createFolder: false, appVersion: "t", protection: { mode: "none" } }))
      .rejects.toThrow("Backup folder not found")
    expect(existsSync(path.join(s.dir, "unmounted"))).toBe(false)
  })

  it("reports progress per file", async () => {
    const s = await setup()
    const seen: [number, number][] = []
    await createBackup({ ...s, appVersion: "t", protection: { mode: "none" }, onProgress: (d, t) => seen.push([d, t]) })
    expect(seen.at(-1)).toEqual([SAMPLE_FILES.length, SAMPLE_FILES.length])
  })
})

describe("protected backups", () => {
  it("key: hides everything, carries secrets, and verifies after unlocking", async () => {
    const s = await setup()
    const id = await generateX25519Identity()
    const recipient = await identityToRecipient(id)
    const fingerprint = await fingerprintOf(recipient)
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "key", recipient, fingerprint }, secrets: { mailPassword: "smtp-pw", llmApiKey: null, pushUrl: "https://discord.example/hook", pushToken: "tk" } })
    expect(out.file).toMatch(/\.hcbackup\.age$/)
    expect(out.sidecar).toMatchObject({ protection: "key", keyFingerprint: fingerprint })
    expect(JSON.stringify(out.sidecar)).not.toContain("smtp-pw")
    expect(JSON.stringify(out.sidecar)).not.toContain("discord.example")
    const plainPath = path.join(s.dir, "unlocked.hcbackup")
    expect(await unprotectFile(out.path, plainPath, { key: id })).toEqual({ ok: true })
    const v = await verifyArchive(plainPath, { workDir: s.workDir })
    expect(v).toMatchObject({ ok: true, manifest: { hasSecrets: true, protection: "key" } })
    const r = await ArchiveReader.open(plainPath)
    expect(JSON.parse(await r.readText("secrets.json"))).toEqual({ mailPassword: "smtp-pw", llmApiKey: null, pushUrl: "https://discord.example/hook", pushToken: "tk" })
    await r.close()
    expect(await readdir(s.workDir)).toEqual([]) // no plaintext left behind
  })

  it("password: opens with the password only", async () => {
    const s = await setup()
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "password", password: "abcdef" } })
    expect(out.file).toMatch(/\.hcbackup\.zip$/)
    expect(await unprotectFile(out.path, path.join(s.dir, "x"), { password: "abcdeg" })).toMatchObject({ ok: false })
    expect(await unprotectFile(out.path, path.join(s.dir, "x"), { password: "abcdef" })).toEqual({ ok: true })
    expect(await readdir(s.workDir)).toEqual([])
  })

  it("a failed protection step leaves no backup, sidecar or plaintext", async () => {
    const s = await setup()
    await expect(createBackup({ ...s, appVersion: "t", protection: { mode: "password", password: "abc" } })).rejects.toThrow("at least 6")
    expect(await readdir(s.workDir)).toEqual([])
    expect(await readdir(s.folder)).toEqual([])
  })

  it("an unprotected backup never contains secrets", async () => {
    const s = await setup()
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "none" }, secrets: { mailPassword: "smtp-pw", llmApiKey: "k" } })
    const r = await ArchiveReader.open(out.path)
    expect(r.entries()).not.toContain("secrets.json")
    await r.close()
  })
})
