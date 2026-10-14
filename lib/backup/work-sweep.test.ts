import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { mkdir, readdir, symlink } from "node:fs/promises"
import { isWorkFile, sweepRefusal, sweepWorkFiles, type KeepOut } from "./work-sweep"
import { tempDir, writeFiles } from "./test-support"

/** A directory alias: a junction on Windows (no admin rights needed), a symlink elsewhere. null when the OS refuses. */
async function alias(target: string, link: string): Promise<boolean> {
  try {
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir")
    return true
  } catch (e) {
    console.warn(`skipping alias case: the OS refused a link (${(e as NodeJS.ErrnoException).code})`)
    return false
  }
}

async function household() {
  const root = await tempDir("hc-sweep-")
  const work = path.join(root, "backup-work")
  await mkdir(work, { recursive: true })
  const keep = (over: Partial<Record<"backups" | "uploads", string>> = {}): KeepOut[] => [
    { path: path.join(root, "restore"), label: "restore folder", both: true },
    { path: over.backups ?? path.join(root, "backups"), label: "backup folder", both: true },
    { path: over.uploads ?? path.join(root, "uploads"), label: "upload folder", both: true },
    { path: path.join(root, "homecenter.db"), label: "database", both: false },
  ]
  return { root, work, keep }
}

const WORK_FILES = {
  "snapshot-1a2b3c4d.db": "plain", "snapshot-1a2b3c4d.db-wal": "w", "1a2b3c4d.hcbackup": "plaintext with secrets.json",
  "1a2b3c4d.hcbackup.partial": "p", "export-0f0f0f0f.db": "x", "export-0f0f0f0f.db-journal": "j", "0f0f0f0f-export.zip": "z",
  "verify-123e4567-e89b-12d3-a456-426614174000.db": "v", "verify-cli-1700000000000.hcbackup": "v",
  "exports/run1/homecenter-export-2026-01-01-0300.zip": "e",
}
const NOT_OURS = {
  "homecenter-2026-01-01-0300.hcbackup": "a real backup", "homecenter-2026-01-01-0300.hcbackup.meta.json": "{}",
  "homecenter-2026-01-01-0300.hcbackup.age": "a real protected backup", "notes.txt": "mine", "keepme/inner.txt": "mine",
  "snapshot-notmine.db": "unknown", "1a2b3c4d.hcbackup.bak": "unknown",
}

describe("work folder sweep", () => {
  it("passes for the normal layout", async () => {
    const h = await household()
    expect(await sweepRefusal(h.work, h.keep())).toBeNull()
  })

  it("removes only the engine's own work files; a real backup and unknown files survive", async () => {
    const h = await household()
    await writeFiles(h.work, { ...WORK_FILES, ...NOT_OURS })
    await sweepWorkFiles(h.work)
    expect((await readdir(h.work)).sort()).toEqual(["1a2b3c4d.hcbackup.bak", "homecenter-2026-01-01-0300.hcbackup", "homecenter-2026-01-01-0300.hcbackup.age",
      "homecenter-2026-01-01-0300.hcbackup.meta.json", "keepme", "notes.txt", "snapshot-notmine.db"])
    expect(existsSync(path.join(h.work, "keepme", "inner.txt"))).toBe(true)
  })

  it("never matches the names real backups use", () => {
    for (const n of ["homecenter-2026-01-01-0300.hcbackup", "homecenter-2026-01-01-0300.hcbackup.zip", "homecenter-2026-01-01-0300.hcbackup.age",
      "homecenter-2026-01-01-0300-2.hcbackup", "homecenter-export-2026-01-01-0300.zip", "homecenter-2026-01-01-0300.hcbackup.partial"]) {
      expect(isWorkFile(n)).toBe(false)
    }
  })

  it("refuses when the backup folder is an alias (junction or symlink) of the work folder", async () => {
    const h = await household()
    const link = path.join(h.root, "backups-alias")
    if (!(await alias(h.work, link))) return
    expect(await sweepRefusal(h.work, h.keep({ backups: link }))).toMatch(/backup folder/)
    expect(await sweepRefusal(h.work, h.keep({ uploads: path.join(link, "uploads") }))).toMatch(/upload folder/) // not even created yet
  })

  it("refuses when the work folder itself is an alias of the backup folder", async () => {
    const root = await tempDir("hc-sweep-")
    const backups = path.join(root, "backups")
    await writeFiles(backups, { "homecenter-2026-01-01-0300.hcbackup": "real" })
    const work = path.join(root, "backup-work")
    if (!(await alias(backups, work))) return
    const why = await sweepRefusal(work, [{ path: backups, label: "backup folder", both: true }])
    expect(why).toMatch(/backup folder/)
  })

  it("refuses on a plain nesting either way", async () => {
    const h = await household()
    expect(await sweepRefusal(h.work, h.keep({ uploads: path.join(h.work, "uploads") }))).toMatch(/upload folder/)
    expect(await sweepRefusal(h.work, h.keep({ backups: h.root }))).toMatch(/inside the backup folder/)
  })

  it("refuses when two paths share an identity the realpaths don't show (bind mount)", async () => {
    const h = await household()
    const backups = path.join(h.root, "backups")
    await mkdir(backups)
    const fs = {
      realpath: async (p: string) => p,
      stat: async (p: string) => (path.resolve(p) === path.resolve(backups) || path.resolve(p) === path.resolve(h.work) ? { dev: BigInt(1), ino: BigInt(42) } : { dev: BigInt(1), ino: BigInt(path.resolve(p).length) }),
    }
    expect(await sweepRefusal(h.work, h.keep(), fs)).toMatch(/same folder as the backup folder/)
  })

  it("refuses when anything goes wrong while checking", async () => {
    const h = await household()
    await writeFiles(h.work, WORK_FILES)
    const denied = Object.assign(new Error("denied"), { code: "EACCES" })
    const ids = new Map<string, bigint>()
    const distinct = async (p: string) => ({ dev: BigInt(1), ino: ids.get(path.resolve(p)) ?? ids.set(path.resolve(p), BigInt(ids.size + 1)).get(path.resolve(p))! })
    const fs = { realpath: async (p: string) => { if (p.includes("uploads")) throw denied; return p }, stat: distinct }
    expect(await sweepRefusal(h.work, h.keep(), fs)).toMatch(/couldn't check it safely \(EACCES\)/)
    const statFails = { realpath: async (p: string) => p, stat: async () => { throw Object.assign(new Error("x"), { code: "EPERM" }) } }
    expect(await sweepRefusal(h.work, h.keep(), statFails)).toMatch(/EPERM/)
    expect((await readdir(h.work)).length).toBeGreaterThan(0) // a refusal deletes nothing
  })
})
