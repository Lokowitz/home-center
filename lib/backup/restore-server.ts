import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { SETTINGS_ID } from "@/lib/notifications/mail-config"
import { dbPathFromUrl, restoreDir, searchIndexFile, uploadDir } from "./paths"
import { markFinalized, prunePre, readResult, type RestorePaths } from "./restore"
import { raiseBackupAlert } from "./alerts-server"

export const restorePaths = (): RestorePaths => ({
  dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile(),
})

type CarriedSecrets = { mailPasswordEnc: string | null; llmApiKeyEnc: string | null }

/** Moves carried secrets (already encrypted under this server's key) into the settings rows, then deletes the file. Never logs them. */
async function reWrapSecrets(dir: string): Promise<void> {
  const file = path.join(dir, "secrets.enc.json")
  const text = await readFile(file, "utf8").catch(() => null)
  if (text === null) return
  let secrets: CarriedSecrets | null = null
  try {
    secrets = JSON.parse(text) as CarriedSecrets
  } catch {
    console.error("[restore] the carried secrets file is unreadable; discarding it. Re-enter the mail password and AI key in Settings.")
  }
  // Upserts are repeatable and the file goes only after they succeed, so a crash in between just redoes them.
  if (secrets?.mailPasswordEnc) await prisma.mailSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, passwordEnc: secrets.mailPasswordEnc }, update: { passwordEnc: secrets.mailPasswordEnc } })
  if (secrets?.llmApiKeyEnc) await prisma.llmSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", apiKeyEnc: secrets.llmApiKeyEnc }, update: { apiKeyEnc: secrets.llmApiKeyEnc } })
  await rm(file, { force: true })
}

/** After boot (migrations done): finish what the apply step started. Idempotent: a crash part-way is finished by the next boot without repeating what was done. */
export async function finalizeRestore(now = new Date()): Promise<void> {
  const dir = restoreDir()
  const result = await readResult(dir)
  if (result && !result.finalized) {
    if (result.status === "ok") {
      await reWrapSecrets(dir)
      // Everyone signs in again, with the accounts in the restored data. A repeat after a crash only signs them out once more.
      await prisma.user.updateMany({ data: { sessionVersion: { increment: 1 } } })
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
    const when = result.backupCreatedAt ? new Date(result.backupCreatedAt).toLocaleString() : "an earlier state"
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
  await prunePre(dir, now)
  await rm(path.join(dir, "work"), { recursive: true, force: true })
  await rm(path.join(dir, "incoming"), { recursive: true, force: true })
}

/** Exits so Docker's restart policy starts a fresh process that applies the staged restore. */
export function restartToFinish(): { restarting: boolean } {
  if (process.env.HOMECENTER_SUPERVISED !== "1") return { restarting: false }
  setTimeout(() => process.exit(0), 750).unref()
  return { restarting: true }
}
