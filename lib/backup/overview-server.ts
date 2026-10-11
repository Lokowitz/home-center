import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { dataDir } from "./paths"
import { folderStatus, listBackups, type FolderStatus } from "./store"
import { backupFolder, loadBackupSettings } from "./settings-server"
import { isStale, nextSlot } from "./schedule"
import { statusTone, type Tone } from "./overview"
import type { Protection } from "./format"

export type BackupRow = { file: string; createdAt: string; size: number; protection: Protection; keyFingerprint: string | null; warningCount: number; kind: "backup" | "export" }

export type RestoreState = null // widened in Task 13

export type BackupOverview = {
  settings: {
    schedule: "OFF" | "DAILY" | "WEEKLY"; time: string; weekday: number; folder: string; folderIsDefault: boolean; keep: number
    protection: "NONE" | "KEY" | "PASSWORD"; keyFingerprint: string | null; hasPassword: boolean; hintDismissed: boolean
  }
  folderStatus: FolderStatus
  backups: BackupRow[]
  running: { id: string; kind: string; done: number; total: number } | null
  lastRun: { status: string; finishedAt: string | null; error: string | null; warnings: string[] } | null
  nextRunAt: string | null
  tone: Tone
  healthEnabled: boolean
  restore: RestoreState
}

export async function loadBackupOverview(now = new Date()): Promise<BackupOverview> {
  const s = await loadBackupSettings()
  const folder = backupFolder(s)
  const [status, stored, running, last, features] = await Promise.all([
    folderStatus(folder, dataDir()),
    listBackups(folder),
    prisma.backupRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
    prisma.backupRun.findFirst({ where: { kind: "BACKUP", status: { not: "RUNNING" } }, orderBy: { startedAt: "desc" } }),
    loadFeatures(),
  ])
  const backups = stored.filter((b) => b.kind === "backup")
  const newestAt = backups[0] ? new Date(backups[0].createdAt) : null
  const stale = isStale(s, newestAt, s.enabledAt ?? s.updatedAt, now)
  return {
    settings: {
      schedule: s.schedule, time: s.time, weekday: s.weekday, folder, folderIsDefault: !s.folder, keep: s.keep,
      protection: s.protection, keyFingerprint: s.keyFingerprint, hasPassword: !!s.passphraseEnc, hintDismissed: !!s.hintDismissedAt,
    },
    folderStatus: status,
    backups: backups.map((b) => ({ file: b.file, createdAt: b.createdAt, size: b.size, protection: b.protection, keyFingerprint: b.keyFingerprint, warningCount: b.warningCount, kind: b.kind })),
    running: running ? { id: running.id, kind: running.kind, done: running.progressDone, total: running.progressTotal } : null,
    lastRun: last ? { status: last.status, finishedAt: last.finishedAt?.toISOString() ?? null, error: last.error, warnings: JSON.parse(last.warnings) as string[] } : null,
    nextRunAt: nextSlot(s, now)?.toISOString() ?? null,
    tone: statusTone({ newestAt, lastStatus: last?.status ?? null, stale }),
    healthEnabled: features.health,
    restore: null,
  }
}
