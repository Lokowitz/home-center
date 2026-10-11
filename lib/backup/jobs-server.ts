import { prisma } from "@/lib/prisma"
import { uploadDir, dbPathFromUrl, workDir } from "./paths"
import { createBackup } from "./backup"
import { cleanupPartials, pruneBackups } from "./store"
import { appVersion, backupFolder, loadBackupSettings, loadSecrets, protectionConfig } from "./settings-server"
import { raiseBackupAlert, resolveBackupAlerts } from "./alerts-server"

// One job at a time per process (backup, export or restore staging share it).
// instrumentation.ts, route handlers and server actions can each load their own
// copy of this module, so the lock lives on globalThis like the indexer's state.
type JobState = { running: string | null }
const g = globalThis as unknown as { __hcBackupJob?: JobState }
const state: JobState = (g.__hcBackupJob ??= { running: null })

/** Held between claiming the lock and knowing the run id. */
const CLAIMING = "claiming"

export const isJobRunning = () => state.running !== null

/** Claims the lock and records the run; the work continues after this returns. */
export async function startBackupJob(trigger: "MANUAL" | "SCHEDULE", userId?: string): Promise<{ runId: string } | { error: string }> {
  // Claim before any await so two concurrent callers can't both pass.
  if (state.running) return { error: "A backup or export is already running." }
  state.running = CLAIMING
  let runId: string
  try {
    const settings = await loadBackupSettings()
    const run = await prisma.backupRun.create({
      data: { kind: "BACKUP", trigger, protection: settings.protection, createdById: userId ?? null },
    })
    runId = run.id
    state.running = runId
  } catch (e) {
    state.running = null
    throw e
  }
  void runBackupJob(runId)
    .catch((e) => console.error("[backup] job crashed:", e))
    .finally(() => {
      state.running = null
    })
  return { runId }
}

/** Never rejects past its own bookkeeping: the row ends FAILED if any update is still possible. */
export async function runBackupJob(runId: string): Promise<void> {
  let last = 0
  let trigger = "MANUAL"
  try {
    const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } })
    trigger = run.trigger
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[backup] failed:", e)
    try {
      await prisma.backupRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), error: message } })
    } catch (e2) {
      console.error("[backup] couldn't record the failure:", e2)
    }
    try {
      await raiseBackupAlert(`run:${runId}`, "Backup failed", `${trigger === "SCHEDULE" ? "The scheduled backup" : "A backup"} didn't finish: ${message}`)
    } catch (e3) {
      console.error("[backup] couldn't raise the failure alert:", e3)
    }
    return
  }
  // The backup itself is done and recorded; clearing old alerts is best-effort.
  try {
    await resolveBackupAlerts()
  } catch (e) {
    console.error("[backup] couldn't resolve backup alerts:", e)
  }
}

/** At boot: a run still RUNNING was cut off by a restart. */
export async function markInterruptedRuns(): Promise<number> {
  const stuck = await prisma.backupRun.findMany({ where: { status: "RUNNING", ...(state.running ? { id: { not: state.running } } : {}) }, select: { id: true, kind: true } })
  for (const r of stuck) {
    await prisma.backupRun.update({ where: { id: r.id }, data: { status: "INTERRUPTED", finishedAt: new Date(), error: "HomeCenter restarted while this was running." } })
    if (r.kind === "BACKUP") await raiseBackupAlert(`run:${r.id}`, "Backup interrupted", "HomeCenter restarted during a backup. The next scheduled backup will run as usual.")
  }
  // A job started during the boot delay owns its partial files.
  if (!isJobRunning()) await cleanupPartials(backupFolder(await loadBackupSettings()))
  return stuck.length
}
