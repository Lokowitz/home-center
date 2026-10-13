"use server"

import path from "node:path"
import { revalidatePath } from "next/cache"
import { mkdir } from "node:fs/promises"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth-guard"
import { startBackupJob } from "@/lib/backup/jobs-server"
import { loadBackupOverview, type BackupOverview } from "@/lib/backup/overview-server"
import { BACKUP_SETTINGS_ID, backupFolder, loadBackupSettings } from "@/lib/backup/settings-server"
import { deleteBackup, folderStatus, listBackups } from "@/lib/backup/store"
import { hashFile } from "@/lib/backup/archive"
import { verifyArchive } from "@/lib/backup/verify"
import { appMigrations, dataDir, workDir } from "@/lib/backup/paths"
import { cancelRestore, dryRun, hasPending, stage, stageUndo, type DryRun } from "@/lib/backup/restore"
import { restartToFinish, restorePaths } from "@/lib/backup/restore-server"
import { isJobRunning } from "@/lib/backup/jobs-server"
import { fingerprintOf, passwordProblem } from "@/lib/backup/protect-shared"
import { encrypt } from "@/lib/secret-box"

export async function getBackupOverview(): Promise<BackupOverview> {
  await requireAdmin()
  return loadBackupOverview()
}

export async function backUpNow() {
  const session = await requireAdmin()
  const r = await startBackupJob("MANUAL", session.user.id)
  revalidatePath("/settings")
  return r
}

const scheduleSchema = z.object({
  schedule: z.enum(["OFF", "DAILY", "WEEKLY"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 03:00."),
  weekday: z.coerce.number().int().min(0).max(6),
  folder: z.string().trim(),
  keep: z.coerce.number().int().min(1, "Keep at least 1 backup.").max(365),
})

export async function saveBackupSchedule(input: Omit<z.input<typeof scheduleSchema>, "weekday" | "keep"> & { weekday: string | number; keep: string | number }): Promise<{ ok: true; warning?: string } | { error: string }> {
  await requireAdmin()
  const parsed = scheduleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  const v = parsed.data
  if (v.folder && !path.isAbsolute(v.folder)) return { error: "Use a full folder path, such as /backups." }
  const folder = v.folder || null
  const status = await folderStatus(folder ?? backupFolder({ folder: null }), dataDir())
  if (folder && !status.exists) return { error: "That folder doesn't exist inside the container. Mount it in docker-compose first." }
  if (folder && !status.writable) return { error: "HomeCenter can't write to that folder." }
  // loadBackupSettings upserts the singleton row, so the update below can't miss it.
  const before = await loadBackupSettings()
  await prisma.backupSettings.update({
    where: { id: BACKUP_SETTINGS_ID },
    data: {
      schedule: v.schedule, time: v.time, weekday: v.weekday, folder, keep: v.keep,
      enabledAt: v.schedule !== "OFF" && before.schedule === "OFF" ? new Date() : before.enabledAt,
    },
  })
  revalidatePath("/settings")
  return status.sameDevice ? { ok: true, warning: "This folder is on the same disk as your data. If that disk fails, you lose both." } : { ok: true }
}

export async function verifyBackup(file: string): Promise<{ ok: true; message: string } | { error: string }> {
  await requireAdmin()
  const b = (await listBackups(backupFolder(await loadBackupSettings()))).find((x) => x.file === file)
  if (!b) return { error: "That backup isn't in the backup folder any more." }
  const { sha256 } = await hashFile(b.path)
  if (sha256 !== b.sha256) return { error: "This file has changed or is damaged since it was written." }
  if (b.protection !== "none") return { ok: true, message: "File intact. Its contents can be checked during a restore, with the key or password." }
  const v = await verifyArchive(b.path, { workDir: workDir() })
  return v.ok ? { ok: true, message: "Backup checked: every file and the database are intact." } : { error: v.error }
}

export async function removeBackup(file: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  const ok = await deleteBackup(backupFolder(await loadBackupSettings()), file)
  revalidatePath("/settings")
  return ok ? { ok: true } : { error: "That backup isn't in the backup folder any more." }
}

export async function dismissBackupHint(): Promise<void> {
  await requireAdmin()
  await loadBackupSettings() // upserts the singleton row so the update below can't miss it
  await prisma.backupSettings.update({ where: { id: BACKUP_SETTINGS_ID }, data: { hintDismissedAt: new Date() } })
  revalidatePath("/settings")
}

type Saved = Promise<{ ok: true } | { error: string }>

export async function setProtectionNone(): Saved {
  await requireAdmin()
  await loadBackupSettings() // upserts the singleton row so the update below can't miss it
  await prisma.backupSettings.update({ where: { id: BACKUP_SETTINGS_ID }, data: { protection: "NONE", passphraseEnc: null } })
  revalidatePath("/settings")
  return { ok: true }
}

export async function setProtectionKey(input: { publicKey: string; fingerprint: string }): Saved {
  await requireAdmin()
  const key = String(input.publicKey ?? "").trim()
  if (!/^age1[0-9a-z]{20,}$/.test(key)) return { error: "That isn't a recovery key's public half." }
  // Recomputed here: the client's fingerprint is only trusted if it matches.
  if ((await fingerprintOf(key)) !== input.fingerprint) return { error: "The key and its fingerprint don't match." }
  await loadBackupSettings()
  await prisma.backupSettings.update({
    where: { id: BACKUP_SETTINGS_ID },
    data: { protection: "KEY", publicKey: key, keyFingerprint: input.fingerprint, passphraseEnc: null },
  })
  revalidatePath("/settings")
  return { ok: true }
}

export async function setProtectionPassword(input: { password: string }): Saved {
  await requireAdmin()
  const password = String(input.password ?? "")
  const problem = passwordProblem(password)
  if (problem) return { error: problem }
  await loadBackupSettings()
  await prisma.backupSettings.update({
    where: { id: BACKUP_SETTINGS_ID },
    data: { protection: "PASSWORD", passphraseEnc: encrypt(password) },
  })
  revalidatePath("/settings")
  return { ok: true }
}

const UPLOAD_ID = /^[0-9a-f-]{36}$/
const BUSY = "Wait for the running backup or export to finish."
const WAITING = "A restore is already waiting for a restart."

/** Checks a backup without changing anything. Keys and passwords are used here only; they are never stored or logged. */
export async function restoreDryRun(input: { source: { upload: string } | { file: string }; key?: string; password?: string }): Promise<DryRun> {
  await requireAdmin()
  if (isJobRunning()) return { ok: false, error: BUSY }
  const paths = restorePaths()
  if (await hasPending(paths.restoreDir)) return { ok: false, error: WAITING }
  let archivePath: string
  if ("upload" in input.source) {
    if (!UPLOAD_ID.test(String(input.source.upload))) return { ok: false, error: "Upload not found." }
    archivePath = path.join(paths.restoreDir, "incoming", `${input.source.upload}.upload`)
  } else {
    // Only a file that listBackups finds in the backup folder; the client's string is never joined to a path.
    const file = input.source.file
    const b = (await listBackups(backupFolder(await loadBackupSettings()))).find((x) => x.file === file)
    if (!b) return { ok: false, error: "That backup isn't in the backup folder any more." }
    archivePath = b.path
  }
  await mkdir(paths.restoreDir, { recursive: true })
  return dryRun({ archivePath, secret: { key: input.key || undefined, password: input.password || undefined }, paths, known: await appMigrations() })
}

/** Stages the checked backup. A stage error removes the unlocked work archive and is shown as is. */
async function stageOrCancel(run: () => Promise<void>, fallback: string): Promise<{ ok: true } | { error: string }> {
  const paths = restorePaths()
  if (isJobRunning()) return { error: BUSY }
  if (await hasPending(paths.restoreDir)) return { error: WAITING }
  try {
    await run()
  } catch (e) {
    await cancelRestore(paths.restoreDir).catch(() => undefined)
    return { error: e instanceof Error ? e.message : fallback }
  }
  return { ok: true }
}

export async function restoreConfirm(input: { word: string }): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  if (String(input.word ?? "").trim() !== "RESTORE") return { error: "Type RESTORE to confirm." }
  return stageOrCancel(() => stage({ paths: restorePaths() }), "Couldn't prepare the restore.")
}

export async function restoreRestart(): Promise<{ restarting: boolean }> {
  await requireAdmin()
  return restartToFinish()
}

export async function restoreUndo(): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  return stageOrCancel(() => stageUndo({ paths: restorePaths() }), "Couldn't prepare the undo.")
}

export async function restoreCancel(): Promise<void> {
  await requireAdmin()
  await cancelRestore(restorePaths().restoreDir)
}
