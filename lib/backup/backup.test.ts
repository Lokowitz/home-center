import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { createBackup } from "./backup"
import { ArchiveReader } from "./archive"
import { readSidecar } from "./store"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"

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
