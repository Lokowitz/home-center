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
  /** Set by `npm run restore -- --ack` once the household has dealt with recoveryDirs; until then a not-rolled-back failure blocks boot. */
  acknowledgedAt?: string
  /** Set when an admin dismissed the notice in Settings → Data. */
  seenAt?: string
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
    const pushRows = await c.execute(`SELECT pushUrlEnc AS v FROM "NotificationSettings" UNION ALL SELECT pushTokenEnc FROM "NotificationSettings"`).catch(() => ({ rows: [] }))
    const stored = [...mail.rows, ...llm.rows, ...pushRows.rows].map((r) => r.v as string | null).filter((v): v is string => !!v)
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

export const ALREADY_STAGED = "A restore is already staged. Restart HomeCenter to finish it, or cancel it first."

/** staging may hold a staged Undo, which is the only copy of the household from before the last restore. */
async function refuseIfPending(d: ReturnType<typeof dirs>) {
  if (await exists(d.pending)) throw new Error(ALREADY_STAGED)
}

/** Renames a dir holding displaced data out of the pre-* and staging names; if even that fails, marks it so nothing deletes it. */
async function preserve(
  dir: string, restoreDir: string, label: string, stampText: string,
  ops: { rename: typeof fsRename; writeMarker: (file: string) => Promise<void> },
): Promise<{ dir: string; protected: boolean }> {
  const target = path.join(restoreDir, `failed-${stampText}-${label}`)
  try {
    await ops.rename(dir, target)
    return { dir: target, protected: true }
  } catch {
    try {
      await ops.writeMarker(path.join(dir, KEEP))
      return { dir, protected: true }
    } catch {
      return { dir, protected: false }
    }
  }
}

export async function stage(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  try {
    await refuseIfPending(d)
    await refuseIfKept(d.staging)
  } catch (e) {
    await rm(d.work, { recursive: true, force: true }).catch(() => undefined) // no unlocked archive left lying around
    throw e
  }
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
      const s = JSON.parse(await r.readText(SECRETS_ENTRY)) as { mailPassword: string | null; llmApiKey: string | null; pushUrl?: string | null; pushToken?: string | null }
      // Re-wrapped under this server's AUTH_SECRET at once, so plaintext never rests on disk.
      await writeFile(path.join(d.staging, "secrets.enc.json"), JSON.stringify({
        mailPasswordEnc: s.mailPassword ? encrypt(s.mailPassword) : null,
        llmApiKeyEnc: s.llmApiKey ? encrypt(s.llmApiKey) : null,
        pushUrlEnc: s.pushUrl ? encrypt(s.pushUrl) : null,
        pushTokenEnc: s.pushToken ? encrypt(s.pushToken) : null,
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
  const names: string[] = []
  for (const n of (await readdir(restoreDir).catch(() => [] as string[])).filter((n) => n.startsWith("pre-")).sort()) {
    if (!(await isKept(path.join(restoreDir, n)))) names.push(n)
  }
  const last = names.at(-1)
  if (!last) return null
  const dir = path.join(restoreDir, last)
  const meta = await readFile(path.join(dir, "pre.json"), "utf8").then((t) => JSON.parse(t) as { createdAt: string }, () => null)
  return meta ? { dir, createdAt: meta.createdAt } : null
}

export async function stageUndo(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  await refuseIfPending(d)
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

/**
 * Takes back a staged restore before it is applied. A staged Undo goes back to its pre-* folder (or, if
 * that rename fails, is kept as failed-*-undo-snapshot or marked in place); a staged backup is removed,
 * since the backup file still has it. keptIn names where kept data ended up, when not where it came from.
 */
export async function cancelStaged(
  restoreDir: string,
  now = new Date(),
  fsOps: { rename: typeof fsRename; writeMarker?: (file: string) => Promise<void> } = { rename: fsRename },
): Promise<{ cancelled: boolean; keptIn: string | null }> {
  const d = dirs(restoreDir)
  if (!(await exists(d.pending))) return { cancelled: false, keptIn: null }
  const keepOps = { rename: fsOps.rename, writeMarker: fsOps.writeMarker ?? ((file: string) => writeFile(file, "{}")) }
  let meta: { source?: string; undoOf?: string } | null = null
  try {
    meta = JSON.parse(await readFile(d.pending, "utf8"))
  } catch {
    meta = null
  }
  let keptIn: string | null = null
  if (await exists(d.staging)) {
    if (await isKept(d.staging)) {
      keptIn = d.staging // already marked: never moved or deleted here
    } else if (meta?.source === "backup" && meta.undoOf === undefined) {
      await rm(d.pending, { force: true }) // first, so a crash part-way can't apply a half-removed staging
      await rm(d.staging, { recursive: true, force: true })
      return { cancelled: true, keptIn: null }
    } else {
      // An Undo, or a pending file we can't read: staging may hold the only copy, so it is handed back or kept.
      const u = meta?.source === "undo" && typeof meta.undoOf === "string" ? path.resolve(meta.undoOf) : null
      const valid = u !== null && path.dirname(u) === path.resolve(restoreDir) && path.basename(u).startsWith("pre-") && !(await exists(u))
      let handedBack = false
      if (valid) {
        try {
          await fsOps.rename(d.staging, u)
          handedBack = true
        } catch {
          handedBack = false
        }
      }
      if (!handedBack) {
        const p = await preserve(d.staging, restoreDir, meta?.source === "undo" ? "undo-snapshot" : "staged", safeStamp(now), keepOps)
        keptIn = p.dir
        // Neither renamed nor marked: leave pending in place so nothing (stage, a later cancel) touches staging.
        if (!p.protected) throw new Error(`Couldn't put the staged data back or mark it. It is in ${d.staging}; move it somewhere safe.`)
      }
    }
  }
  await rm(d.pending, { force: true })
  return { cancelled: true, keptIn }
}

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

/** A failed apply that left data displaced and has not been acknowledged yet. */
export const isBlocking = (r: RestoreResult | null): boolean => !!r && r.status === "failed" && !r.rolledBack && !r.acknowledgedAt

/** A notice that may be dismissed: never one about displaced data that nobody has dealt with yet. */
export const canDismiss = (r: RestoreResult): boolean => r.status === "ok" || r.rolledBack || !!r.acknowledgedAt

/** Records that the notice was dismissed. Returns false when there is nothing that may be dismissed. */
export async function markSeen(restoreDir: string, now = new Date()): Promise<boolean> {
  const r = await readResult(restoreDir)
  if (!r || !canDismiss(r)) return false
  if (!r.seenAt) await writeResult(restoreDir, { ...r, seenAt: now.toISOString() })
  return true
}

/** Returns the result that was acknowledged, or null when nothing was blocking. */
export async function acknowledgeBlocking(restoreDir: string, now = new Date()): Promise<RestoreResult | null> {
  const r = await readResult(restoreDir)
  if (!r || !isBlocking(r)) return null
  const next = { ...r, acknowledgedAt: now.toISOString() }
  await writeResult(restoreDir, next)
  return next
}

export async function prunePre(restoreDir: string, now: Date, days = 7): Promise<number> {
  const pre = await latestPre(restoreDir)
  if (!pre || now.getTime() - new Date(pre.createdAt).getTime() < days * 86_400_000) return 0
  await rm(pre.dir, { recursive: true, force: true })
  return 1
}

const safeStamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-")

/** The pre-* folder an apply at appliedAt moved the displaced household into. */
export const preDirFor = (restoreDir: string, appliedAt: string) => path.join(restoreDir, `pre-${safeStamp(new Date(appliedAt))}`)

/** Swap the staged household in. Runs before Prisma connects (boot script or CLI). Any failure puts everything back. */
export async function applyPending(
  paths: RestorePaths,
  now = new Date(),
  // rollbackRename undoes moves and preserves recovery dirs; tests inject failures there separately from the forward moves.
  fsOps: { rename: typeof fsRename; rollbackRename?: typeof fsRename; writeMarker?: (file: string) => Promise<void> } = { rename: fsRename },
): Promise<{ applied: false } | { applied: true; result: RestoreResult }> {
  const d = dirs(paths.restoreDir)
  if (!(await exists(d.pending))) return { applied: false }
  const rb = fsOps.rollbackRename ?? fsRename
  const keepOps = { rename: rb, writeMarker: fsOps.writeMarker ?? ((file: string) => writeFile(file, "{}")) }
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
    if (meta.undoOf !== undefined) {
      // It becomes a rename target, so it must be a pre-* dir directly inside the restore dir.
      const u = path.resolve(meta.undoOf)
      if (path.dirname(u) !== path.resolve(paths.restoreDir) || !path.basename(u).startsWith("pre-")) throw new Error("bad undoOf")
    }
  } catch {
    return finish({ ...base, status: "failed", error: "The pending restore file is unreadable, so nothing was changed.", rolledBack: true, recoveryDirs: [] })
  }
  base.backupCreatedAt = meta.backupCreatedAt
  base.source = meta.source

  const pre = preDirFor(paths.restoreDir, base.appliedAt)
  const moves: [from: string, to: string][] = []
  const move = async (from: string, to: string) => {
    await fsOps.rename(from, to)
    moves.push([from, to])
  }
  const suffixes = ["", "-wal", "-shm", "-journal"]
  let stagedSecrets = false
  let preCreated = false

  try {
    if (!(await exists(path.join(d.staging, "homecenter.db")))) throw new Error("The staged backup has no database.")
    await releaseDbHandles() // a client opened earlier in this process must not hold the files we are about to rename
    await mkdir(pre) // not recursive: if a dir with this name exists it is someone's undo point, so fail instead of mixing into it
    preCreated = true
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
    const protect = async (dir: string, label: string) => {
      const p = await preserve(dir, paths.restoreDir, label, stampText, keepOps)
      recoveryDirs.push(p.dir)
      return p.protected ? p.dir : `${p.dir} (could not protect it: nothing may be deleting it, but nothing marks it either)`
    }
    if (rolledBack) {
      // pre is ours to delete only if it holds nothing but the marker file we wrote.
      if (preCreated) {
        const left = await readdir(pre).catch(() => ["?"])
        if (left.length === 1 && left[0] === "pre.json") await rm(pre, { recursive: true, force: true })
        else note = ` (leftover data was kept in ${await protect(pre, "previous")})`
      }
      if (meta.undoOf && (await exists(d.staging))) {
        // A failed undo hands its snapshot back so it can be used again; if that fails the snapshot is kept where it is.
        try {
          await rb(d.staging, meta.undoOf)
        } catch {
          note += ` (the earlier state you wanted to go back to was kept in ${await protect(d.staging, "undo-snapshot")})`
        }
      } else {
        await rm(d.staging, { recursive: true, force: true })
      }
    } else {
      // Some moves couldn't be undone, so both dirs may hold the only copy of some data.
      const where: string[] = []
      if (preCreated) where.push(await protect(pre, "previous"))
      if (await exists(d.staging)) where.push(await protect(d.staging, "staged"))
      note = ` (rolling back also failed; data the household needs is in ${where.join(" and ")})`
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
