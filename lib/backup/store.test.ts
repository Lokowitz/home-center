import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { cleanupPartials, folderStatus, listBackups, pruneBackups, uniqueName, writeSidecar } from "./store"
import { SIDECAR_VERSION, type Sidecar } from "./format"
import { tempDir, writeFiles } from "./test-support"

const side = (file: string, createdAt: string, kind: "backup" | "export" = "backup"): Sidecar => ({
  sidecarVersion: SIDECAR_VERSION, file, createdAt, kind, size: 1, sha256: "x", appVersion: "t", migration: "m",
  protection: "none", keyFingerprint: null, warningCount: 0,
})

async function put(folder: string, file: string, createdAt: string, kind: "backup" | "export" = "backup") {
  await writeFiles(folder, { [file]: "z" })
  await writeSidecar(path.join(folder, file), side(file, createdAt, kind))
}

describe("backup folder", () => {
  it("lists only archives with a valid sidecar, newest first", async () => {
    const f = await tempDir()
    await put(f, "homecenter-2026-01-01-0300.hcbackup", "2026-01-01T03:00:00.000Z")
    await put(f, "homecenter-2026-01-02-0300.hcbackup", "2026-01-02T03:00:00.000Z")
    await writeFiles(f, { "notes.txt": "mine", "orphan.hcbackup.meta.json": "{bad" })
    expect((await listBackups(f)).map((b) => b.file)).toEqual(["homecenter-2026-01-02-0300.hcbackup", "homecenter-2026-01-01-0300.hcbackup"])
  })

  it("retention never deletes non-backup files", async () => {
    const f = await tempDir()
    for (let d = 1; d <= 4; d++) await put(f, `homecenter-2026-01-0${d}-0300.hcbackup`, `2026-01-0${d}T03:00:00.000Z`)
    await writeFiles(f, { "notes.txt": "mine", "homecenter-2025-01-01-0300.hcbackup": "no sidecar, not ours to judge" })
    const deleted = await pruneBackups(f, 2)
    expect(deleted.sort()).toEqual(["homecenter-2026-01-01-0300.hcbackup", "homecenter-2026-01-02-0300.hcbackup"])
    const left = (await readdir(f)).sort()
    expect(left).toContain("notes.txt")
    expect(left).toContain("homecenter-2025-01-01-0300.hcbackup")
    expect(left).not.toContain("homecenter-2026-01-01-0300.hcbackup.meta.json")
  })

  it("numbers a second backup made in the same minute", async () => {
    const f = await tempDir()
    await put(f, "homecenter-2026-01-01-0300.hcbackup", "2026-01-01T03:00:00.000Z")
    expect(await uniqueName(f, "homecenter-2026-01-01-0300.hcbackup")).toBe("homecenter-2026-01-01-0300-2.hcbackup")
    expect(await uniqueName(f, "homecenter-2026-01-01-0300.hcbackup.age")).toBe("homecenter-2026-01-01-0300.hcbackup.age")
  })

  it("cleanupPartials removes leftovers from an interrupted run", async () => {
    const f = await tempDir()
    await writeFiles(f, { "a.hcbackup.partial": "x", "keep.hcbackup": "y" })
    expect(await cleanupPartials(f)).toBe(1)
    expect(existsSync(path.join(f, "keep.hcbackup"))).toBe(true)
  })

  it("reports folder status", async () => {
    const f = await tempDir()
    const s = await folderStatus(f, f)
    expect(s).toMatchObject({ exists: true, writable: true, sameDevice: true })
    expect((await folderStatus(path.join(f, "nope"), f)).exists).toBe(false)
  })
})
