import { readFile } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/secret-box"
import { SETTINGS_ID } from "@/lib/notifications/mail-config"
import { defaultBackupFolder } from "./paths"
import type { ProtectionConfig, Secrets } from "./backup"
import type { BackupSettings } from "@/app/generated/prisma/client"

export const BACKUP_SETTINGS_ID = "singleton"

export async function loadBackupSettings(): Promise<BackupSettings> {
  return prisma.backupSettings.upsert({ where: { id: BACKUP_SETTINGS_ID }, create: { id: BACKUP_SETTINGS_ID }, update: {} })
}

export const backupFolder = (s: Pick<BackupSettings, "folder">) => s.folder || defaultBackupFolder()

/** Throws when protection is on but its key/passphrase is missing or unreadable, so a run fails loudly instead of writing an open backup. */
export function protectionConfig(s: BackupSettings): ProtectionConfig {
  if (s.protection === "KEY") {
    if (!s.publicKey || !s.keyFingerprint) throw new Error("Recovery key protection is on but no key is set.")
    return { mode: "key", recipient: s.publicKey, fingerprint: s.keyFingerprint }
  }
  if (s.protection === "PASSWORD") {
    const password = s.passphraseEnc ? decrypt(s.passphraseEnc) : null
    if (!password) throw new Error("Password protection is on but the saved password can't be read (was AUTH_SECRET changed?). Set it again.")
    return { mode: "password", password }
  }
  return { mode: "none" }
}

export async function loadSecrets(): Promise<Secrets> {
  const [mail, llm, push] = await Promise.all([
    prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID }, select: { passwordEnc: true } }),
    prisma.llmSettings.findUnique({ where: { id: "singleton" }, select: { apiKeyEnc: true } }),
    prisma.notificationSettings.findUnique({ where: { id: "singleton" }, select: { pushUrlEnc: true, pushTokenEnc: true } }),
  ])
  return {
    mailPassword: mail?.passwordEnc ? decrypt(mail.passwordEnc) : null,
    llmApiKey: llm?.apiKeyEnc ? decrypt(llm.apiKeyEnc) : null,
    pushUrl: push?.pushUrlEnc ? decrypt(push.pushUrlEnc) : null,
    pushToken: push?.pushTokenEnc ? decrypt(push.pushTokenEnc) : null,
  }
}

let version: string | null = null
export async function appVersion(): Promise<string> {
  if (!version) {
    try {
      version = (JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "unknown"
    } catch {
      version = "unknown"
    }
  }
  return version
}
