import { prisma } from "@/lib/prisma"
import { isDue, isStale } from "./schedule"
import { listBackups } from "./store"
import { backupFolder, loadBackupSettings } from "./settings-server"
import { isJobRunning, markInterruptedRuns, startBackupJob } from "./jobs-server"
import { raiseBackupAlert } from "./alerts-server"

const TICK_MS = 15 * 60_000
const BOOT_DELAY_MS = 20_000

async function tick(now = new Date()) {
  const s = await loadBackupSettings()
  if (s.schedule === "OFF") return
  const last = await prisma.backupRun.findFirst({ where: { kind: "BACKUP", trigger: "SCHEDULE" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } })
  if (!isJobRunning() && isDue(s, last?.startedAt ?? null, now)) await startBackupJob("SCHEDULE")

  // Staleness reads the folder, so CLI backups count too.
  const newest = (await listBackups(backupFolder(s))).find((b) => b.kind === "backup")
  const newestAt = newest ? new Date(newest.createdAt) : null
  if (isStale(s, newestAt, s.enabledAt ?? s.updatedAt, now)) {
    await raiseBackupAlert(
      `stale:${newest?.createdAt ?? "none"}`,
      "Backups are behind",
      newestAt ? `The last backup is from ${newestAt.toLocaleDateString()}. Check Settings → Data.` : "No backup has been made yet. Check Settings → Data.",
    )
  }
}

let started = false
export function startBackupScheduler() {
  if (started) return
  started = true
  const run = () => void tick().catch((e) => console.error("[backup] scheduler tick failed:", e))
  setTimeout(() => {
    void markInterruptedRuns().catch((e) => console.error("[backup] interrupted-run check failed:", e)).finally(run)
  }, BOOT_DELAY_MS).unref()
  setInterval(run, TICK_MS).unref()
  console.log("[backup] scheduler started — checks every 15 minutes")
}
