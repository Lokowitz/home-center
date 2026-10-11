// Engine file: relative imports and npm packages only.
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { ArchiveReader } from "./archive"
import { DB_ENTRY, FORMAT_VERSION, type Manifest } from "./format"
import { integrityCheck } from "./snapshot"

export type VerifyResult = { ok: true; manifest: Manifest } | { ok: false; error: string }

/** Every listed entry present with the right size and hash; a backup's database passes integrity_check. */
export async function verifyArchive(plainPath: string, opts: { workDir: string; password?: string }): Promise<VerifyResult> {
  let r: ArchiveReader
  try {
    r = await ArchiveReader.open(plainPath, opts.password)
  } catch {
    return { ok: false, error: "Not a HomeCenter archive (it can't be opened as a zip)." }
  }
  try {
    let manifest: Manifest
    try {
      manifest = await r.manifest()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    if (manifest.formatVersion > FORMAT_VERSION) {
      return { ok: false, error: `Made by a newer HomeCenter (archive format ${manifest.formatVersion}). Update HomeCenter first.` }
    }
    const names = new Set(r.entries())
    for (const f of manifest.files) {
      if (!names.has(f.path)) return { ok: false, error: `Missing from the archive: ${f.path}` }
      const got = await r.hash(f.path)
      if (got.size !== f.size || got.sha256 !== f.sha256) return { ok: false, error: `Damaged in the archive: ${f.path}` }
    }
    if (manifest.kind === "backup") {
      if (!names.has(DB_ENTRY)) return { ok: false, error: "The backup has no database." }
      await mkdir(opts.workDir, { recursive: true })
      const tmp = path.join(opts.workDir, `verify-${randomUUID()}.db`)
      try {
        await r.extract(DB_ENTRY, tmp)
        const ic = await integrityCheck(tmp)
        if (ic !== "ok") return { ok: false, error: `The backup's database failed its check: ${ic}` }
      } finally {
        // Best effort: on Windows libsql can keep the file locked for a moment after close().
        await rm(tmp, { force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
      }
    }
    return { ok: true, manifest }
  } finally {
    await r.close()
  }
}

export type Compat = { ok: true } | { ok: false; reason: string }

/** Older backups are upgraded by migrations at boot; newer or unknown ones are refused. */
export function checkCompatibility(manifest: Manifest, known: string[]): Compat {
  if (manifest.kind !== "backup") return { ok: false, reason: "This is an export. Exports can be browsed but not restored." }
  if (!manifest.migration) return { ok: false, reason: "This backup doesn't say which database version it holds." }
  if (known.includes(manifest.migration)) return { ok: true }
  const latest = known.at(-1) ?? ""
  return manifest.migration > latest
    ? { ok: false, reason: "This backup was made by a newer HomeCenter. Update HomeCenter first, then restore." }
    : { ok: false, reason: "This backup holds a database version this HomeCenter doesn't know." }
}
