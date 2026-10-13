// Engine file: relative imports and npm packages only. The CLI reads settings
// straight from the DB file so it works with the app stopped.
import { decrypt } from "../secret-box"
import { openDb } from "./snapshot"
import type { ProtectionConfig, Secrets } from "./backup"

export type RawSettings = {
  folder: string | null; keep: number; protection: "NONE" | "KEY" | "PASSWORD"
  publicKey: string | null; keyFingerprint: string | null; passphraseEnc: string | null
}

const DEFAULTS: RawSettings = { folder: null, keep: 14, protection: "NONE", publicKey: null, keyFingerprint: null, passphraseEnc: null }

export async function readRawSettings(dbPath: string): Promise<RawSettings> {
  const c = openDb(dbPath)
  try {
    const r = await c.execute(`SELECT folder, keep, protection, publicKey, keyFingerprint, passphraseEnc FROM "BackupSettings" WHERE id = 'singleton'`)
    const row = r.rows[0]
    if (!row) return DEFAULTS
    return {
      folder: (row.folder as string | null) || null, keep: Number(row.keep), protection: row.protection as RawSettings["protection"],
      publicKey: row.publicKey as string | null, keyFingerprint: row.keyFingerprint as string | null, passphraseEnc: row.passphraseEnc as string | null,
    }
  } catch {
    return DEFAULTS // older schema without the table
  } finally {
    c.close()
  }
}

export function rawProtection(s: RawSettings): ProtectionConfig {
  if (s.protection === "KEY" && s.publicKey && s.keyFingerprint) return { mode: "key", recipient: s.publicKey, fingerprint: s.keyFingerprint }
  if (s.protection === "PASSWORD") {
    const password = s.passphraseEnc ? decrypt(s.passphraseEnc) : null
    if (!password) throw new Error("Password protection is on but the saved password can't be read with this AUTH_SECRET.")
    return { mode: "password", password }
  }
  if (s.protection === "KEY") throw new Error("Recovery key protection is on but no key is set.")
  return { mode: "none" }
}

export async function readRawSecrets(dbPath: string): Promise<Secrets> {
  const c = openDb(dbPath)
  try {
    const mail = await c.execute(`SELECT passwordEnc FROM "MailSettings" WHERE id = 'singleton'`).catch(() => ({ rows: [] }))
    const llm = await c.execute(`SELECT apiKeyEnc FROM "LlmSettings" WHERE id = 'singleton'`).catch(() => ({ rows: [] }))
    const m = mail.rows[0]?.passwordEnc as string | undefined
    const k = llm.rows[0]?.apiKeyEnc as string | undefined
    return { mailPassword: m ? decrypt(m) : null, llmApiKey: k ? decrypt(k) : null }
  } finally {
    c.close()
  }
}
