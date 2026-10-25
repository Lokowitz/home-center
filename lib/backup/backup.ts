// Engine file: relative imports and npm packages only.
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
import { ArchiveWriter, hashFile } from "./archive"
import { archiveName, DB_ENTRY, FILES_PREFIX, FORMAT_VERSION, SECRETS_ENTRY, SIDECAR_VERSION, type Sidecar } from "./format"
import { safeJoin } from "./paths"
import { protectFile } from "./protect"
import { latestMigration, modelCounts, referencedFiles, vacuumInto } from "./snapshot"
import { sidecarPath, uniqueName, writeSidecar } from "./store"
import { verifyArchive } from "./verify"

export type ProtectionConfig =
  | { mode: "none" }
  | { mode: "key"; recipient: string; fingerprint: string }
  | { mode: "password"; password: string }

// The push fields are optional so archives made before push existed still read back.
export type Secrets = { mailPassword: string | null; llmApiKey: string | null; pushUrl?: string | null; pushToken?: string | null }

export type BackupInput = {
  dbPath: string
  uploadDir: string
  folder: string
  workDir: string
  appVersion: string
  protection: ProtectionConfig
  /** Only written when protection is on: plaintext secrets never go in an open archive. */
  secrets?: Secrets | null
  now?: Date
  /** False for configured folders: a missing NAS mount must fail, not fill the local disk. Default true. */
  createFolder?: boolean
  onProgress?: (done: number, total: number) => void
  /** Adds readable/ (Task 16). Files are already in the archive under files/<rel>. */
  readable?: (snapshotPath: string, w: ArchiveWriter) => Promise<void>
}

export type BackupOutcome = { file: string; path: string; sidecar: Sidecar; warnings: string[] }

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false)
const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false)

export async function createBackup(input: BackupInput): Promise<BackupOutcome> {
  const now = input.now ?? new Date()
  const mode = input.protection.mode
  if (input.createFolder === false) {
    if (!(await isDir(input.folder))) throw new Error(`Backup folder not found: ${input.folder}. Is the drive or share mounted?`)
  } else {
    await mkdir(input.folder, { recursive: true })
  }
  await mkdir(input.workDir, { recursive: true })

  const tag = randomUUID().slice(0, 8)
  const snap = path.join(input.workDir, `snapshot-${tag}.db`)
  const file = await uniqueName(input.folder, archiveName("backup", now, mode))
  const finalPath = path.join(input.folder, file)
  // Protected backups are built and verified in plaintext on the data disk first: the server can't verify what it can't decrypt.
  const plainPath = mode === "none" ? finalPath : path.join(input.workDir, `${tag}.hcbackup`)
  let writer: ArchiveWriter | null = null

  try {
    await vacuumInto(input.dbPath, snap)
    const [migration, counts, refs] = await Promise.all([latestMigration(snap), modelCounts(snap), referencedFiles(snap)])
    const warnings = refs.skipped.map((r) => `Skipped unsafe file name: ${r}`)

    writer = await ArchiveWriter.create(plainPath)
    await writer.addFile(DB_ENTRY, snap, { compress: true })
    let done = 0
    for (const rel of refs.files) {
      const src = safeJoin(input.uploadDir, rel)
      if (src && (await isFile(src))) await writer.addFile(FILES_PREFIX + rel, src)
      else warnings.push(`Missing file: ${rel}`)
      input.onProgress?.(++done, refs.files.length)
    }
    const secrets = input.secrets
    const hasSecrets = mode !== "none" && !!secrets && !!(secrets.mailPassword || secrets.llmApiKey || secrets.pushUrl || secrets.pushToken)
    if (hasSecrets) await writer.addBytes(SECRETS_ENTRY, JSON.stringify(secrets))
    if (input.readable) await input.readable(snap, writer)

    await writer.finish({
      formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: input.appVersion, migration,
      createdAt: now.toISOString(), protection: mode, counts, warnings, hasReadable: !!input.readable, hasSecrets,
    })
    writer = null

    const v = await verifyArchive(plainPath, { workDir: input.workDir })
    if (!v.ok) throw new Error(`The new backup failed verification: ${v.error}`)

    if (mode !== "none") await protectFile(plainPath, finalPath, input.protection, file)

    const { size, sha256 } = await hashFile(finalPath)
    const sidecar: Sidecar = {
      sidecarVersion: SIDECAR_VERSION, file, createdAt: now.toISOString(), kind: "backup", size, sha256,
      appVersion: input.appVersion, migration, protection: mode,
      keyFingerprint: input.protection.mode === "key" ? input.protection.fingerprint : null, warningCount: warnings.length,
    }
    await writeSidecar(finalPath, sidecar)
    return { file, path: finalPath, sidecar, warnings }
  } catch (e) {
    await writer?.abort()
    await rm(finalPath + ".partial", { force: true })
    // uniqueName guaranteed finalPath did not exist before this run, so anything there is ours.
    await rm(finalPath, { force: true })
    await rm(sidecarPath(finalPath), { force: true })
    throw e
  } finally {
    await rm(snap, { force: true })
    if (mode !== "none") await rm(plainPath, { force: true })
  }
}
