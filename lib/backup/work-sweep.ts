// Engine file: relative imports and npm packages only.
// Clears crash leftovers from the work folder at boot. Two independent layers keep
// it from ever touching real data: an identity check (realpaths and dev+ino, so a
// symlink, junction, bind mount or short-name alias can't fool it) that refuses on
// any doubt, and a sweep that only removes names the engine itself writes there.
import path from "node:path"
import { realpath as realpathCb } from "node:fs"
import { lstat, readdir, rm, stat } from "node:fs/promises"
import { promisify } from "node:util"
import { containsPath } from "./paths"

const HEX8 = "[0-9a-f]{8}"
const DB_SIDE = "(?:-wal|-shm|-journal)?"
/** Top-level files the engine writes into the work folder (see backup.ts, export.ts, verify.ts, scripts/backup-verify.ts). */
export const WORK_FILE_PATTERNS: RegExp[] = [
  new RegExp(`^snapshot-${HEX8}\\.db${DB_SIDE}$`), // backup snapshot
  new RegExp(`^${HEX8}\\.hcbackup(?:\\.partial)?$`), // plaintext archive before protection
  new RegExp(`^export-${HEX8}\\.db${DB_SIDE}$`), // export snapshot
  new RegExp(`^${HEX8}-export\\.zip(?:\\.partial)?$`), // plaintext export before its password zip
  new RegExp(`^verify-[0-9a-f-]{36}\\.db${DB_SIDE}$`), // integrity-check copy
  /^verify-cli-\d+\.hcbackup(?:\.partial)?$/, // backup:verify unlocked copy
]
/** The one work subfolder: one-time export downloads, one folder per run. */
export const WORK_DIRS = ["exports"]

export const isWorkFile = (name: string) => WORK_FILE_PATTERNS.some((re) => re.test(name))

export type SweepFs = {
  realpath: (p: string) => Promise<string>
  stat: (p: string) => Promise<{ dev: bigint; ino: bigint }>
}
// The native realpath resolves junctions, subst drives and 8.3 short names on Windows.
const realpathNative = promisify(realpathCb.native)
const realFs: SweepFs = { realpath: (p) => realpathNative(p), stat: (p) => stat(p, { bigint: true }) }

const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT"

/** Realpath of p, or of its nearest existing ancestor with the missing tail appended. Other errors throw. */
async function resolveReal(p: string, fs: SweepFs): Promise<string> {
  const tail: string[] = []
  let cur = path.resolve(p)
  for (;;) {
    try {
      return path.join(await fs.realpath(cur), ...tail)
    } catch (e) {
      if (!isEnoent(e)) throw e
      const up = path.dirname(cur)
      if (up === cur) throw e
      tail.unshift(path.basename(cur))
      cur = up
    }
  }
}

/** p and every existing ancestor of it. */
async function selfAndAncestors(p: string, fs: SweepFs): Promise<{ dev: bigint; ino: bigint }[]> {
  const out: { dev: bigint; ino: bigint }[] = []
  let cur = path.resolve(p)
  for (;;) {
    try {
      out.push(await fs.stat(cur))
    } catch (e) {
      if (!isEnoent(e)) throw e
    }
    const up = path.dirname(cur)
    if (up === cur) return out
    cur = up
  }
}

export type KeepOut = { path: string; label: string; /** Also refuse when this path contains the work folder (true for folders that could hold it). */ both: boolean }

/** null when the work folder can be swept, else why not. Any error while checking is a refusal. */
export async function sweepRefusal(work: string, keepOut: KeepOut[], fs: SweepFs = realFs): Promise<string | null> {
  try {
    const realWork = await fs.realpath(work)
    const id = await fs.stat(realWork)
    for (const k of keepOut) {
      const real = await resolveReal(k.path, fs)
      if (containsPath(realWork, real)) return `it is or holds the ${k.label} (${k.path})`
      if (k.both && containsPath(real, realWork)) return `it is inside the ${k.label} (${k.path})`
      // An alias the realpaths missed (bind mount, odd filesystem): same file identity as the path or any ancestor.
      if (id.ino !== BigInt(0)) {
        for (const a of await selfAndAncestors(k.path, fs)) {
          if (a.dev === id.dev && a.ino === id.ino) return `it is the same folder as the ${k.label} or one of its parents (${k.path})`
        }
      }
    }
    return null
  } catch (e) {
    return `couldn't check it safely (${(e as NodeJS.ErrnoException)?.code ?? (e instanceof Error ? e.message : String(e))})`
  }
}

/**
 * Removes the engine's own leftovers from the work folder, after sweepRefusal passed.
 * Non-recursive except for the known exports/ folder; never follows a link; anything else is left alone.
 */
export async function sweepWorkFiles(work: string): Promise<string[]> {
  const removed: string[] = []
  for (const n of await readdir(work).catch(() => [] as string[])) {
    const p = path.join(work, n)
    const s = await lstat(p).catch(() => null)
    if (!s) continue
    if (s.isFile() && isWorkFile(n)) {
      await rm(p, { force: true }).catch(() => undefined)
      removed.push(n)
    } else if (s.isDirectory() && !s.isSymbolicLink() && WORK_DIRS.includes(n)) {
      await rm(p, { recursive: true, force: true }).catch(() => undefined)
      removed.push(n)
    }
  }
  return removed
}
