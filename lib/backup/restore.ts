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
export type RestoreResult = { status: "ok" | "failed"; error: string | null; backupCreatedAt: string | null; appliedAt: string; source: "backup" | "undo"; finalized: boolean }

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
  // A new dry run supersedes any restore that was staged but never applied.
  await writeFile(path.join(d.work, "dryrun.json"), JSON.stringify({ archive, createdAt: v.manifest.createdAt }))
  return { ok: true, manifest: v.manifest, backupCounts, currentCounts, secrets, warnings: v.manifest.warnings }
}

async function removePre(restoreDir: string, except?: string) {
  for (const n of await readdir(restoreDir).catch(() => [] as string[])) {
    if (n.startsWith("pre-") && path.join(restoreDir, n) !== except) await rm(path.join(restoreDir, n), { recursive: true, force: true })
  }
}

export async function stage(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
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
  await removePre(i.paths.restoreDir) // only now that the new data is fully staged: a new restore replaces the undo point
  await writeFile(d.pending, JSON.stringify({ createdAt: (i.now ?? new Date()).toISOString(), backupCreatedAt: info.createdAt, source: "backup" }))
  await rm(d.work, { recursive: true, force: true })
}

export async function latestPre(restoreDir: string): Promise<{ dir: string; createdAt: string } | null> {
  const names = (await readdir(restoreDir).catch(() => [] as string[])).filter((n) => n.startsWith("pre-")).sort()
  const last = names.at(-1)
  if (!last) return null
  const dir = path.join(restoreDir, last)
  const meta = await readFile(path.join(dir, "pre.json"), "utf8").then((t) => JSON.parse(t) as { createdAt: string }, () => null)
  return meta ? { dir, createdAt: meta.createdAt } : null
}

export async function stageUndo(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  const pre = await latestPre(i.paths.restoreDir)
  if (!pre) throw new Error("There's no earlier state to go back to.")
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
export async function applyPending(paths: RestorePaths, now = new Date(), fsOps: { rename: typeof fsRename } = { rename: fsRename }): Promise<{ applied: false } | { applied: true; result: RestoreResult }> {
  const d = dirs(paths.restoreDir)
  if (!(await exists(d.pending))) return { applied: false }
  const meta = JSON.parse(await readFile(d.pending, "utf8")) as { backupCreatedAt: string | null; source: "backup" | "undo"; undoOf?: string }
  const pre = path.join(paths.restoreDir, `pre-${safeStamp(now)}`)
  const moves: [from: string, to: string][] = []
  const move = async (from: string, to: string) => {
    await fsOps.rename(from, to)
    moves.push([from, to])
  }
  const base: Omit<RestoreResult, "status" | "error"> = { backupCreatedAt: meta.backupCreatedAt, appliedAt: now.toISOString(), source: meta.source, finalized: false }

  try {
    if (!(await exists(path.join(d.staging, "homecenter.db")))) throw new Error("The staged backup has no database.")
    await releaseDbHandles() // a client opened earlier in this process must not hold the files we are about to rename
    await mkdir(pre, { recursive: true })
    await writeFile(path.join(pre, "pre.json"), JSON.stringify({ createdAt: now.toISOString() }))
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      if (await exists(paths.dbPath + suffix)) await move(paths.dbPath + suffix, path.join(pre, "homecenter.db" + suffix))
    }
    if (await exists(paths.uploadDir)) await move(paths.uploadDir, path.join(pre, "uploads"))
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      if (await exists(path.join(d.staging, "homecenter.db" + suffix))) await move(path.join(d.staging, "homecenter.db" + suffix), paths.dbPath + suffix)
    }
    await move(path.join(d.staging, "uploads"), paths.uploadDir)
    if (await exists(path.join(d.staging, "secrets.enc.json"))) await move(path.join(d.staging, "secrets.enc.json"), d.secrets)
  } catch (e) {
    let rolledBack = true
    for (const [from, to] of moves.reverse()) {
      try {
        await fsRename(to, from) // the real rename: rollback must not be subject to the injected failure
      } catch {
        rolledBack = false
      }
    }
    // Only throw the safety copy away when everything is back where it was; otherwise it is the only copy of some data.
    if (rolledBack) {
      await rm(pre, { recursive: true, force: true })
      // A failed undo hands its snapshot back, so it can still be used.
      if (meta.undoOf && (await exists(d.staging))) await fsRename(d.staging, meta.undoOf).catch(() => undefined)
      await rm(d.staging, { recursive: true, force: true })
    }
    await rm(d.pending, { force: true }) // never retry on the next boot over a half-moved state
    const message = e instanceof Error ? e.message : String(e)
    const result: RestoreResult = { ...base, status: "failed", error: rolledBack ? message : `${message} (rolling back also failed; the previous data is in ${pre})` }
    await writeResult(paths.restoreDir, result)
    return { applied: true, result }
  }

  for (const suffix of ["", "-wal", "-shm"]) await rm(paths.searchIndexPath + suffix, { force: true })
  await rm(d.staging, { recursive: true, force: true })
  await rm(d.pending, { force: true })
  const result: RestoreResult = { ...base, status: "ok", error: null }
  await writeResult(paths.restoreDir, result)
  return { applied: true, result }
}
