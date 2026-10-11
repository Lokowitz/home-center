import { prisma } from "@/lib/prisma"
import { uploadDir, dbPathFromUrl, workDir } from "./paths"
import { createBackup } from "./backup"
import { cleanupPartials, pruneBackups } from "./store"
import { appVersion, backupFolder, loadBackupSettings, loadSecrets, protectionConfig } from "./settings-server"
import { raiseBackupAlert, resolveBackupAlerts } from "./alerts-server"

// One job at a time in this process (backup, export or restore staging share it).
let running: string | null = null
export const isJobRunning = () => running !== null

/** Claims the lock and records the run; the work continues after this returns. */
export async function startBackupJob(trigger: "MANUAL" | "SCHEDULE", userId?: string): Promise<{ runId: string } | { error: string }> {
  if (running) return { error: "A backup or export is already running." }
  const settings = await loadBackupSettings()
  const run = await prisma.backupRun.create({
    data: { kind: "BACKUP", trigger, protection: settings.protection, createdById: userId ?? null },
  })
  running = run.id
  void runBackupJob(run.id).finally(() => {
    running = null
  })
  return { runId: run.id }
}

export async function runBackupJob(runId: string): Promise<void> {
  const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } })
  let last = 0
  try {
    const settings = await loadBackupSettings()
    const folder = backupFolder(settings)
    const protection = protectionConfig(settings)
    const out = await createBackup({
      dbPath: dbPathFromUrl(process.env.DATABASE_URL),
      uploadDir: uploadDir(),
      folder,
      workDir: workDir(),
      appVersion: await appVersion(),
      protection,
      secrets: protection.mode === "none" ? null : await loadSecrets(),
      // The default folder may be created; a configured one (NAS share) must already exist.
      createFolder: !settings.folder,
      onProgress: (done, total) => {
        const now = Date.now()
        if (done === total || now - last > 1000) {
          last = now
          void prisma.backupRun.update({ where: { id: runId }, data: { progressDone: done, progressTotal: total } }).catch(() => {})
        }
      },
    })
    await pruneBackups(folder, settings.keep)
    await prisma.backupRun.update({
      where: { id: runId },
      data: {
        status: out.warnings.length ? "WARN" : "OK", finishedAt: new Date(), file: out.file, size: out.sidecar.size,
        warnings: JSON.stringify(out.warnings),
      },
    })
    await resolveBackupAlerts()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[backup] failed:", e)
    await prisma.backupRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), error: message } })
    await raiseBackupAlert(`run:${runId}`, "Backup failed", `${run.trigger === "SCHEDULE" ? "The scheduled backup" : "A backup"} didn't finish: ${message}`)
  }
}

/** At boot: a run still RUNNING was cut off by a restart. */
export async function markInterruptedRuns(): Promise<number> {
  const stuck = await prisma.backupRun.findMany({ where: { status: "RUNNING" }, select: { id: true, kind: true } })
  for (const r of stuck) {
    await prisma.backupRun.update({ where: { id: r.id }, data: { status: "INTERRUPTED", finishedAt: new Date(), error: "HomeCenter restarted while this was running." } })
    if (r.kind === "BACKUP") await raiseBackupAlert(`run:${r.id}`, "Backup interrupted", "HomeCenter restarted during a backup. The next scheduled backup will run as usual.")
  }
  const settings = await loadBackupSettings()
  await cleanupPartials(backupFolder(settings))
  return stuck.length
}
