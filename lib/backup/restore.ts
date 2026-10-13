// Engine file: relative imports and npm packages only. applyPending runs from
// scripts/restore-apply.ts before migrations, with no app code loaded.
import path from "node:path"
import { mkdir, readdir, readFile, rename as fsRename, rm, stat, statfs, writeFile } from "node:fs/promises"
import { encrypt, decrypt } from "../secret-box"
import { ArchiveReader } from "./archive"
import { DB_ENTRY, FILES_PREFIX, SECRETS_ENTRY, type Manifest } from "./format"
import { safeJoin } from "./paths"
import { detectProtection, unprotectFile, type UnlockSecret } from "./protect"
import { modelCounts, openDb, releaseDbHandles } from "./snapshot"
import { checkCompatibility, verifyArchive } from "./verify"

export type RestorePaths = { dbPath: string; uploadDir: string; restoreDir: string; searchIndexPath: string }
export type SecretsStatus = "carried" | "same-secret" | "re-enter" | "none"
export type DryRun =
  | { ok: true; manifest: Manifest; backupCounts: Record<string, number>; currentCounts: Record<string, number>; secrets: SecretsStatus; warnings: string[] }
  | { ok: false; error: string; needs?: "key" | "password" }
export type RestoreResult = {
  status: "ok" | "failed"
  error: string | null
  backupCreatedAt: string | null
  appliedAt: string
  source: "backup" | "undo"
  finalized: boolean
  /** True when status is ok, or when a failure was fully undone. False means the live data may be incomplete and displaced data sits in recoveryDirs. */
  rolledBack: boolean
  /** Absolute paths holding data the household may need after a failed apply. This engine never deletes them. */
  recoveryDirs: string[]
}

const exists = (p: string) => stat(p).then(() => true, () => false)
const dirs = (r: string) => ({
  work: path.join(r, "work"), staging: path.join(r, "staging"), pending: path.join(r, "pending.json"),
  result: path.join(r, "result.json"), secrets: path.join(r, "secrets.enc.json"),
})

async function secretsStatus(dbFile: string, manifest: Manifest): Promise<SecretsStatus> {
  if (manifest.hasSecrets) return "carried"
  const c = openDb(dbFile)
  try {
    const mail = await c.execute(`SELECT passwordEnc AS v FROM "MailSettings"`).catch(() => ({ rows: [] }))
    const llm = await c.execute(`SELECT apiKeyEnc AS v FROM "LlmSettings"`).catch(() => ({ rows: [] }))
    const stored = [...mail.rows, ...llm.rows].map((r) => r.v as string | null).filter((v): v is string => !!v)
    if (stored.length === 0) return "none"
    return stored.every((v) => decrypt(v) !== null) ? "same-secret" : "re-enter"
  } finally {
    c.close()
    await releaseDbHandles()
  }
}

export async function dryRun(i: { archivePath: string; secret: UnlockSecret; paths: RestorePaths; known: string[] }): Promise<DryRun> {
  const d = dirs(i.paths.restoreDir)
  let result: DryRun
  try {
    result = await dryRunInner(i, d)
  } catch (e) {
    result = { ok: false, error: `Couldn't check this backup: ${e instanceof Error ? e.message : String(e)}` }
  }
  // A failed check leaves nothing behind, in particular no unlocked copy of the archive.
  if (!result.ok) await rm(d.work, { recursive: true, force: true }).catch(() => undefined)
  return result
}

async function dryRunInner(i: { archivePath: string; secret: UnlockSecret; paths: RestorePaths; known: string[] }, d: ReturnType<typeof dirs>): Promise<DryRun> {
  await rm(d.work, { recursive: true, force: true })
  await mkdir(d.work, { recursive: true })

  const size = (await stat(i.archivePath)).size
  const fs = await statfs(i.paths.restoreDir)
  if (Number(fs.bavail) * Number(fs.bsize) < size * 2) return { ok: false, error: "Not enough free disk space to restore this backup (about twice its size is needed)." }

  const kind = await detectProtection(i.archivePath)
  if (kind === "unknown") return { ok: false, error: "This isn't a HomeCenter backup." }
  const plain = path.join(d.work, "archive.hcbackup")
  if (kind === "none") {
    // Keep the source where it is; stage reads it from dryrun.json.
  } else {
    const u = await unprotectFile(i.archivePath, plain, i.secret)
    if (!u.ok) return u
  }
  const archive = kind === "none" ? i.archivePath : plain

  const v = await verifyArchive(archive, { workDir: d.work })
  if (!v.ok) return { ok: false, error: v.error }
  const compat = checkCompatibility(v.manifest, i.known)
  if (!compat.ok) return { ok: false, error: compat.reason }

  const r = await ArchiveReader.open(archive)
  const check = path.join(d.work, "check.db")
  try {
    await r.extract(DB_ENTRY, check)
  } finally {
    await r.close()
  }
  const [backupCounts, currentCounts, secrets] = await Promise.all([modelCounts(check), modelCounts(i.paths.dbPath), secretsStatus(check, v.manifest)])
  await rm(check, { force: true })
  await writeFile(path.join(d.work, "dryrun.json"), JSON.stringify({ archive, createdAt: v.manifest.createdAt }))
  return { ok: true, manifest: v.manifest, backupCounts, currentCounts, secrets, warnings: v.manifest.warnings }
}

const KEEP = "keep.json"
/** Marks a dir holding data the household may need after a failed apply; nothing in this engine deletes or reuses it. */
const isKept = (dir: string) => exists(path.join(dir, KEEP))

async function removePre(restoreDir: string, except?: string) {
  for (const n of await readdir(restoreDir).catch(() => [] as string[])) {
    const dir = path.join(restoreDir, n)
    if (n.startsWith("pre-") && dir !== except && !(await isKept(dir))) await rm(dir, { recursive: true, force: true })
  }
}

async function refuseIfKept(staging: string) {
  if (await isKept(staging)) throw new Error(`Data from a failed restore is still in ${staging}. Move it somewhere safe before starting another restore.`)
}

/** Renames a dir holding displaced data out of the pre-* and staging names; if even that fails, marks it so nothing deletes it. */
async function preserve(dir: string, restoreDir: string, label: string, stampText: string, rename: typeof fsRename): Promise<string> {
  const target = path.join(restoreDir, `failed-${stampText}-${label}`)
  try {
    await rename(dir, target)
    return target
  } catch {
    await writeFile(path.join(dir, KEEP), "{}").catch(() => undefined)
    return dir
  }
}

export async function stage(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  await refuseIfKept(d.staging)
  const info = JSON.parse(await readFile(path.join(d.work, "dryrun.json"), "utf8")) as { archive: string; createdAt: string }
  await rm(d.staging, { recursive: true, force: true })
  await mkdir(path.join(d.staging, "uploads"), { recursive: true })

  const r = await ArchiveReader.open(info.archive)
  try {
    const manifest = await r.manifest()
    await r.extract(DB_ENTRY, path.join(d.staging, "homecenter.db"))
    for (const f of manifest.files) {
      if (!f.path.startsWith(FILES_PREFIX)) continue
      const dest = safeJoin(path.join(d.staging, "uploads"), f.path.slice(FILES_PREFIX.length))
      if (!dest) throw new Error(`Unsafe path in the backup: ${f.path}`)
      await r.extract(f.path, dest)
    }
    if (manifest.hasSecrets) {
      const s = JSON.parse(await r.readText(SECRETS_ENTRY)) as { mailPassword: string | null; llmApiKey: string | null }
      // Re-wrapped under this server's AUTH_SECRET at once, so plaintext never rests on disk.
      await writeFile(path.join(d.staging, "secrets.enc.json"), JSON.stringify({
        mailPasswordEnc: s.mailPassword ? encrypt(s.mailPassword) : null,
        llmApiKeyEnc: s.llmApiKey ? encrypt(s.llmApiKey) : null,
      }))
    }
  } catch (e) {
    await rm(d.staging, { recursive: true, force: true })
    throw e
  } finally {
    await r.close()
  }
  // The existing undo point stays until the restore has actually been applied.
  await writeFile(d.pending, JSON.stringify({ createdAt: (i.now ?? new Date()).toISOString(), backupCreatedAt: info.createdAt, source: "backup" }))
  await rm(d.work, { recursive: true, force: true })
}

export async function latestPre(restoreDir: string): Promise<{ dir: string; createdAt: string } | null> {
  const names = (await readdir(restoreDir).catch(() => [] as string[])).filter((n) => n.startsWith("pre-")).sort()
  const last = names.at(-1)
  if (!last) return null
  const dir = path.join(restoreDir, last)
  if (await isKept(dir)) return null
  const meta = await readFile(path.join(dir, "pre.json"), "utf8").then((t) => JSON.parse(t) as { createdAt: string }, () => null)
  return meta ? { dir, createdAt: meta.createdAt } : null
}

export async function stageUndo(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  const pre = await latestPre(i.paths.restoreDir)
  if (!pre) throw new Error("There's no earlier state to go back to.")
  await refuseIfKept(d.staging)
  await rm(d.staging, { recursive: true, force: true })
  await fsRename(pre.dir, d.staging)
  if (!(await exists(path.join(d.staging, "uploads")))) await mkdir(path.join(d.staging, "uploads"))
  await writeFile(d.pending, JSON.stringify({ createdAt: (i.now ?? new Date()).toISOString(), backupCreatedAt: pre.createdAt, source: "undo", undoOf: pre.dir }))
}

export async function cancelRestore(restoreDir: string): Promise<void> {
  const d = dirs(restoreDir)
  await rm(d.work, { recursive: true, force: true })
  await rm(path.join(restoreDir, "incoming"), { recursive: true, force: true })
}

export const hasPending = (restoreDir: string) => exists(dirs(restoreDir).pending)

async function writeResult(restoreDir: string, r: RestoreResult) {
  await writeFile(dirs(restoreDir).result, JSON.stringify(r, null, 2))
}

export async function readResult(restoreDir: string): Promise<RestoreResult | null> {
  return readFile(dirs(restoreDir).result, "utf8").then((t) => JSON.parse(t) as RestoreResult, () => null)
}

export async function markFinalized(restoreDir: string): Promise<void> {
  const r = await readResult(restoreDir)
  if (r) await writeResult(restoreDir, { ...r, finalized: true })
}

export async function prunePre(restoreDir: string, now: Date, days = 7): Promise<number> {
  const pre = await latestPre(restoreDir)
  if (!pre || now.getTime() - new Date(pre.createdAt).getTime() < days * 86_400_000) return 0
  await rm(pre.dir, { recursive: true, force: true })
  return 1
}

const safeStamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-")

/** Swap the staged household in. Runs before Prisma connects (boot script or CLI). Any failure puts everything back. */
export async function applyPending(
  paths: RestorePaths,
  now = new Date(),
  // rollbackRename undoes moves and preserves recovery dirs; tests inject failures there separately from the forward moves.
  fsOps: { rename: typeof fsRename; rollbackRename?: typeof fsRename } = { rename: fsRename },
): Promise<{ applied: false } | { applied: true; result: RestoreResult }> {
  const d = dirs(paths.restoreDir)
  if (!(await exists(d.pending))) return { applied: false }
  const rb = fsOps.rollbackRename ?? fsRename
  const stampText = safeStamp(now)
  const base = { backupCreatedAt: null as string | null, appliedAt: now.toISOString(), source: "backup" as "backup" | "undo", finalized: false }
  const finish = async (result: RestoreResult) => {
    await writeResult(paths.restoreDir, result) // the outcome is recorded before pending goes, so a crash never loses it
    await rm(d.pending, { force: true }) // never retry on the next boot
    return { applied: true as const, result }
  }

  let meta: { backupCreatedAt: string | null; source: "backup" | "undo"; undoOf?: string }
  try {
    meta = JSON.parse(await readFile(d.pending, "utf8"))
    if (meta.source !== "backup" && meta.source !== "undo") throw new Error("unknown source")
  } catch {
    return finish({ ...base, status: "failed", error: "The pending restore file is unreadable, so nothing was changed.", rolledBack: true, recoveryDirs: [] })
  }
  base.backupCreatedAt = meta.backupCreatedAt
  base.source = meta.source

  const pre = path.join(paths.restoreDir, `pre-${stampText}`)
  const moves: [from: string, to: string][] = []
  const move = async (from: string, to: string) => {
    await fsOps.rename(from, to)
    moves.push([from, to])
  }
  const suffixes = ["", "-wal", "-shm", "-journal"]
  let stagedSecrets = false

  try {
    if (!(await exists(path.join(d.staging, "homecenter.db")))) throw new Error("The staged backup has no database.")
    await releaseDbHandles() // a client opened earlier in this process must not hold the files we are about to rename
    await mkdir(pre, { recursive: true })
    await writeFile(path.join(pre, "pre.json"), JSON.stringify({ createdAt: now.toISOString() }))
    for (const suffix of suffixes) {
      if (await exists(paths.dbPath + suffix)) await move(paths.dbPath + suffix, path.join(pre, "homecenter.db" + suffix))
    }
    if (await exists(paths.uploadDir)) await move(paths.uploadDir, path.join(pre, "uploads"))
    for (const suffix of suffixes) {
      if (await exists(path.join(d.staging, "homecenter.db" + suffix))) await move(path.join(d.staging, "homecenter.db" + suffix), paths.dbPath + suffix)
    }
    await move(path.join(d.staging, "uploads"), paths.uploadDir)
    stagedSecrets = await exists(path.join(d.staging, "secrets.enc.json"))
    if (stagedSecrets) await move(path.join(d.staging, "secrets.enc.json"), d.secrets)
  } catch (e) {
    let rolledBack = true
    for (const [from, to] of [...moves].reverse()) {
      try {
        await rb(to, from) // the real rename unless a test injects: rollback must not be subject to the forward failure
      } catch {
        rolledBack = false
      }
    }
    const recoveryDirs: string[] = []
    let note = ""
    if (rolledBack) {
      await rm(pre, { recursive: true, force: true })
      if (meta.undoOf && (await exists(d.staging))) {
        // A failed undo hands its snapshot back so it can be used again; if that fails the snapshot is kept where it is.
        try {
          await rb(d.staging, meta.undoOf)
        } catch {
          const kept = await preserve(d.staging, paths.restoreDir, "undo-snapshot", stampText, rb)
          recoveryDirs.push(kept)
          note = ` (the earlier state you wanted to go back to was kept in ${kept})`
        }
      } else {
        await rm(d.staging, { recursive: true, force: true })
      }
    } else {
      // Some moves couldn't be undone, so both dirs may hold the only copy of some data.
      for (const [dir, label] of [[pre, "previous"], [d.staging, "staged"]] as const) {
        if (await exists(dir)) recoveryDirs.push(await preserve(dir, paths.restoreDir, label, stampText, rb))
      }
      note = ` (rolling back also failed; data the household needs is in ${recoveryDirs.join(" and ")})`
    }
    return finish({ ...base, status: "failed", error: (e instanceof Error ? e.message : String(e)) + note, rolledBack, recoveryDirs })
  }

  // Past the last move: record the outcome first, so nothing below can cause a re-apply at next boot.
  if (!stagedSecrets) await rm(d.secrets, { force: true }).catch(() => undefined) // an old carried-secrets file must not be finalized later
  const out = await finish({ ...base, status: "ok", error: null, rolledBack: true, recoveryDirs: [] })
  for (const suffix of ["", "-wal", "-shm"]) await rm(paths.searchIndexPath + suffix, { force: true }).catch(() => undefined)
  await rm(d.staging, { recursive: true, force: true }).catch(() => undefined)
  await removePre(paths.restoreDir, pre).catch(() => undefined) // a new restore replaces the previous undo point
  return out
}
