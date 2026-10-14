import path from "node:path"
import os from "node:os"
import { mkdir, mkdtemp, rm, utimes, stat } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { acquireAssetDownload, sweepOldExports } from "./export-limits-server"

describe("sweepOldExports", () => {
  it("removes old folders, keeps new ones and the current run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hc-sweep-"))
    try {
      for (const n of ["old", "new", "cur"]) await mkdir(path.join(root, n))
      const old = new Date(Date.now() - 2 * 3600_000)
      await utimes(path.join(root, "old"), old, old)
      await utimes(path.join(root, "cur"), old, old)
      expect(await sweepOldExports("cur", Date.now(), root)).toBe(1)
      await expect(stat(path.join(root, "old"))).rejects.toThrow()
      await stat(path.join(root, "new"))
      await stat(path.join(root, "cur"))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("asset download cap", () => {
  it("refuses a third concurrent request and frees a slot on release", () => {
    const a = acquireAssetDownload()
    const b = acquireAssetDownload()
    expect(a && b).toBeTruthy()
    expect(acquireAssetDownload()).toBeNull()
    a!(); a!()
    const c = acquireAssetDownload()
    expect(c).not.toBeNull()
    expect(acquireAssetDownload()).toBeNull()
    b!(); c!()
  })
})
