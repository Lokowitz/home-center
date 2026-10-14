import path from "node:path"
import { readdir, rm, stat } from "node:fs/promises"
import { workDir } from "./paths"

const MAX_AGE_MS = 60 * 60 * 1000

// Folder names (run ids) being written or streamed right now. On globalThis like the job lock.
const ag = globalThis as unknown as { __hcActiveExports?: Set<string> }
const active: Set<string> = (ag.__hcActiveExports ??= new Set())

/** Marks an export folder as in use so the sweep leaves it alone. Returns an idempotent release. */
export function markExportActive(name: string): () => void {
  active.add(name)
  return () => void active.delete(name)
}

/** Newest mtime of the folder and its direct children: a file that is still growing keeps it young. */
async function newestMtime(dir: string): Promise<number> {
  let t = (await stat(dir)).mtimeMs
  for (const c of await readdir(dir)) {
    try {
      t = Math.max(t, (await stat(path.join(dir, c))).mtimeMs)
    } catch {
      // gone meanwhile
    }
  }
  return t
}

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
    if (n === keep || n === "." || n === ".." || active.has(n)) continue
    const dir = path.join(root, n)
    try {
      const s = await stat(dir)
      if (!s.isDirectory() || now - (await newestMtime(dir)) < MAX_AGE_MS) continue
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
export function acquireAssetDownload(folder?: string): (() => void) | null {
  if (cap.active >= MAX_ASSET_DOWNLOADS) return null
  cap.active++
  const unmark = folder ? markExportActive(folder) : () => undefined
  let done = false
  return () => {
    if (done) return
    done = true
    cap.active--
    unmark()
  }
}
