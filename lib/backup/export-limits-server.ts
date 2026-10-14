import path from "node:path"
import { readdir, rm, stat } from "node:fs/promises"
import { workDir } from "./paths"

const MAX_AGE_MS = 60 * 60 * 1000

/** Removes export folders older than an hour that nobody downloaded. Only direct children of <workDir>/exports are touched. */
export async function sweepOldExports(keep: string | null = null, now = Date.now(), root = path.join(workDir(), "exports")): Promise<number> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return 0
  }
  let removed = 0
  for (const n of names) {
    if (n === keep || n === "." || n === "..") continue
    const dir = path.join(root, n)
    try {
      const s = await stat(dir)
      if (!s.isDirectory() || now - s.mtimeMs < MAX_AGE_MS) continue
      await rm(dir, { recursive: true, force: true })
      removed++
    } catch {
      // best effort
    }
  }
  return removed
}

// Per-asset downloads each build a snapshot and a zip, so only a couple run at once.
// Like the job lock, the count lives on globalThis because route handlers load their own module copies.
type Cap = { active: number }
const g = globalThis as unknown as { __hcAssetDownloads?: Cap }
const cap: Cap = (g.__hcAssetDownloads ??= { active: 0 })
export const MAX_ASSET_DOWNLOADS = 2

/** Returns a release function (safe to call more than once), or null when busy. */
export function acquireAssetDownload(): (() => void) | null {
  if (cap.active >= MAX_ASSET_DOWNLOADS) return null
  cap.active++
  let done = false
  return () => {
    if (done) return
    done = true
    cap.active--
  }
}
