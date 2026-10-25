import { readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { SETTINGS_ID } from "@/lib/notifications/mail-config"
import { dbPathFromUrl, restoreDir, searchIndexFile, uploadDir, workDir } from "./paths"
import { isBlocking, markFinalized, preDirFor, prunePre, readResult, type RestorePaths } from "./restore"
import { maxSessionVersion } from "./snapshot"
import { raiseBackupAlert } from "./alerts-server"
import { getFormat } from "@/lib/regional-server"
import { sweepRefusal, sweepWorkFiles, type KeepOut, type SweepFs } from "./work-sweep"
import { backupFolder, loadBackupSettings } from "./settings-server"

export const restorePaths = (): RestorePaths => ({
  dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile(),
})

type CarriedSecrets = { mailPasswordEnc: string | null; llmApiKeyEnc: string | null; pushUrlEnc?: string | null; pushTokenEnc?: string | null }

/** Moves carried secrets (already encrypted under this server's key) into the settings rows, then deletes the file. Never logs them. */
async function reWrapSecrets(dir: string): Promise<void> {
  const file = path.join(dir, "secrets.enc.json")
  const text = await readFile(file, "utf8").catch(() => null)
  if (text === null) return
  let secrets: CarriedSecrets | null = null
  try {
    secrets = JSON.parse(text) as CarriedSecrets
  } catch {
    console.error("[restore] the carried secrets file is unreadable; discarding it. Re-enter the mail password, AI key and push URL in Settings.")
  }
  // Upserts are repeatable and the file goes only after they succeed, so a crash in between just redoes them.
  if (secrets?.mailPasswordEnc) await prisma.mailSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, passwordEnc: secrets.mailPasswordEnc }, update: { passwordEnc: secrets.mailPasswordEnc } })
  if (secrets?.llmApiKeyEnc) await prisma.llmSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", apiKeyEnc: secrets.llmApiKeyEnc }, update: { apiKeyEnc: secrets.llmApiKeyEnc } })
  if (secrets?.pushUrlEnc || secrets?.pushTokenEnc) {
    const push = {
      ...(secrets.pushUrlEnc ? { pushUrlEnc: secrets.pushUrlEnc } : {}),
      ...(secrets.pushTokenEnc ? { pushTokenEnc: secrets.pushTokenEnc } : {}),
    }
    await prisma.notificationSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...push }, update: push })
  }
  await rm(file, { force: true })
}

/**
 * A version above every one any session can hold: above the displaced household's highest (sessions
 * were issued from it) and at least the minutes since 1970, which keeps rising across restores and
 * fits the Int column (seconds would overflow it in 2038). Restored rows never go down.
 */
async function signEveryoneOut(dir: string, appliedAt: string, now: Date): Promise<void> {
  const displaced = await maxSessionVersion(path.join(preDirFor(dir, appliedAt), "homecenter.db"))
  const floor = Math.max(Math.floor(now.getTime() / 60_000), (displaced ?? 0) + 1)
  const users = await prisma.user.findMany({ select: { id: true, sessionVersion: true } })
  for (const u of users) {
    await prisma.user.update({ where: { id: u.id }, data: { sessionVersion: Math.max(u.sessionVersion + 1, floor) } })
  }
}

/**
 * Clears crash leftovers (snapshots, unlocked archives with secrets, export runs) from the work folder at
 * boot. Refuses, with a warning, unless the work folder provably isn't and doesn't hold live data or
 * backups (see work-sweep.ts); even then only the engine's own file names are removed.
 */
export async function clearWorkDir(dir: string, keepOut: KeepOut[], fs?: SweepFs): Promise<boolean> {
  if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) return true
  const why = await sweepRefusal(dir, keepOut, fs)
  if (why) {
    console.warn(`[backup] not clearing ${dir}: ${why}`)
    return false
  }
  await sweepWorkFiles(dir)
  return true
}

async function clearWorkAtBoot(): Promise<void> {
  const p = restorePaths()
  const folder = await loadBackupSettings().then(backupFolder, () => null)
  if (folder === null) return void console.warn("[backup] not clearing the work folder: couldn't read where backups go")
  await clearWorkDir(workDir(), [
    { path: p.restoreDir, label: "restore folder", both: true },
    { path: folder, label: "backup folder", both: true },
    { path: p.uploadDir, label: "upload folder", both: true },
    // The database's folder always holds the work folder, so only the files themselves are checked.
    { path: p.dbPath, label: "database", both: false },
    { path: p.searchIndexPath, label: "search index", both: false },
  ])
}

/** After boot (migrations done): finish what the apply step started. Idempotent: a crash part-way is finished by the next boot without repeating what was done. */
export async function finalizeRestore(now = new Date()): Promise<void> {
  const dir = restoreDir()
  try {
    await finishResult(dir, now)
  } finally {
    // Runs even when finishing the notice failed: nothing unlocked or plaintext should outlive a restart.
    await prunePre(dir, now).catch((e) => console.error("[restore] couldn't prune the undo point:", e))
    await rm(path.join(dir, "work"), { recursive: true, force: true }).catch(() => undefined)
    await rm(path.join(dir, "incoming"), { recursive: true, force: true }).catch(() => undefined)
    // Nothing in the work folder outlives a restart, exports (one-time downloads) included.
    await clearWorkAtBoot().catch((e) => console.error("[backup] couldn't clear the work folder:", e))
  }
}

async function finishResult(dir: string, now: Date): Promise<void> {
  const result = await readResult(dir)
  // A failed restore that displaced data is not finalized: the app reports it from result.json until it is acknowledged.
  if (result && !result.finalized && !isBlocking(result)) {
    if (result.status === "ok") {
      await reWrapSecrets(dir)
      // Everyone signs in again, with the accounts in the restored data. A repeat after a crash only signs them out once more.
      await signEveryoneOut(dir, result.appliedAt, now)
      // The run that made this backup was RUNNING when it was snapshotted; its real record is the file.
      await prisma.backupRun.deleteMany({ where: { status: "RUNNING" } })
    }
    const startedAt = new Date(result.appliedAt)
    const logged = await prisma.backupRun.findFirst({ where: { kind: "RESTORE", startedAt }, select: { id: true } })
    if (!logged) {
      await prisma.backupRun.create({
        data: { kind: "RESTORE", trigger: "MANUAL", status: result.status === "ok" ? "OK" : "FAILED", startedAt, finishedAt: now, error: result.error },
      })
    }
    const when = result.backupCreatedAt ? (await getFormat()).dateTime(new Date(result.backupCreatedAt)) : "an earlier state"
    const failedText = result.rolledBack
      ? `${result.error} Nothing was changed.`
      : `${result.error} Your data is in ${result.recoveryDirs.join(", ") || "the restore folder"}.`
    // raiseBackupAlert skips admins who already have this cycleKey, so a second pass never notifies twice.
    await raiseBackupAlert(
      `restore:${result.appliedAt}`,
      result.status === "ok" ? (result.source === "undo" ? "Restore undone" : `Restored from the backup of ${when}`) : "Restore didn't finish",
      result.status === "ok" ? "Everyone was signed out. Sign in with the accounts from that backup." : failedText,
    )
    await markFinalized(dir)
  }
}

/** Exits so Docker's restart policy starts a fresh process that applies the staged restore. */
export function restartToFinish(): { restarting: boolean } {
  if (process.env.HOMECENTER_SUPERVISED !== "1") return { restarting: false }
  setTimeout(() => process.exit(0), 750).unref()
  return { restarting: true }
}
