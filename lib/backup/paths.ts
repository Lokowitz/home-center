// Engine file: relative imports and npm packages only.
import path from "node:path"
import { readdir, stat } from "node:fs/promises"

type Env = Record<string, string | undefined>

export function dbPathFromUrl(url: string | undefined): string {
  const p = (url ?? "").replace(/^file:/, "")
  if (!p) throw new Error("DATABASE_URL is not set")
  return path.resolve(p)
}

export const dataDir = (env: Env = process.env) => path.dirname(dbPathFromUrl(env.DATABASE_URL))
export const uploadDir = (env: Env = process.env) => path.resolve(env.UPLOAD_DIR ?? "./uploads")
export const restoreDir = (env: Env = process.env) => path.join(dataDir(env), "restore")
/** Scratch space for snapshots and plaintext archives; same disk as the live data on purpose. */
export const workDir = (env: Env = process.env) => path.join(dataDir(env), "backup-work")
export const defaultBackupFolder = (env: Env = process.env) => path.join(dataDir(env), "backups")

/** Same rule as lib/documents/index-db.ts searchIndexPath(); duplicated because engine files can't import @/. */
export function searchIndexFile(env: Env = process.env): string {
  if (env.SEARCH_INDEX_PATH) return path.resolve(env.SEARCH_INDEX_PATH)
  return path.join(dataDir(env), "search-index.db")
}

/** libsql wants forward slashes, also on Windows. */
export const fileUrl = (p: string) => "file:" + p.replace(/\\/g, "/")

/** A path inside root for an archive-relative path, or null if it would escape. */
export function safeJoin(root: string, rel: string): string | null {
  if (!rel || rel.includes("\\") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null
  const parts = rel.split("/")
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null
  const full = path.resolve(root, ...parts)
  return full.startsWith(path.resolve(root) + path.sep) ? full : null
}

/** Migration folder names this build knows, oldest first. */
export async function appMigrations(dir = path.join(process.cwd(), "prisma", "migrations")): Promise<string[]> {
  const names = await readdir(dir)
  const out: string[] = []
  for (const n of names) {
    try {
      if ((await stat(path.join(dir, n, "migration.sql"))).isFile()) out.push(n)
    } catch {
      // not a migration folder (e.g. migration_lock.toml)
    }
  }
  return out.sort()
}
