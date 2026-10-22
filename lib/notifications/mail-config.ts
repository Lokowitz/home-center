import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/secret-box"

export type MailFieldSource = "settings" | "env" | "default" | "unset"

export type MailConfig = {
  host: string | null
  port: number
  username: string | null
  password: string | null
  secure: boolean
  from: string
  digestHour: number
  /** Where links in emails point: the Settings value, else AUTH_URL; null when neither is usable. */
  publicUrl: string | null
  /** Where each visible field's value came from, so the UI can say so. */
  sources: Record<"host" | "port" | "username" | "password" | "secure" | "from" | "digestHour" | "publicUrl", MailFieldSource>
  /** True when a password is stored but AUTH_SECRET can no longer decrypt it. */
  passwordUnreadable: boolean
  dryRun: boolean
}

export const DEFAULT_FROM = "HomeCenter <no-reply@homecenter.local>"
export const DEFAULT_PORT = 587
export const DEFAULT_DIGEST_HOUR = 8
export const SETTINGS_ID = "singleton"

/**
 * An address to build links from: http(s) only, no trailing slash. Null when the
 * value isn't one. It comes from Settings or AUTH_URL, never from a request — a
 * forged Host header would otherwise put an attacker's address in an email.
 */
export function normalizePublicUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin + url.pathname.replace(/\/+$/, "")
  } catch {
    return null
  }
}

function envNumber(raw: string | undefined) {
  if (raw === undefined || raw === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Resolves mail configuration: anything saved in Settings wins, the SMTP_*
 * environment variables are the fallback. That keeps a provisioned container
 * working out of the box while letting an admin correct a typo without a
 * restart.
 */
export async function loadMailConfig(): Promise<MailConfig> {
  const row = await prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID } })

  const sources = {} as MailConfig["sources"]
  const pick = <T>(field: keyof MailConfig["sources"], fromDb: T | null | undefined, fromEnv: T | null, fallback: T | null) => {
    if (fromDb !== null && fromDb !== undefined) {
      sources[field] = "settings"
      return fromDb
    }
    if (fromEnv !== null) {
      sources[field] = "env"
      return fromEnv
    }
    sources[field] = fallback === null ? "unset" : "default"
    return fallback
  }

  const host = pick("host", row?.host || null, process.env.SMTP_HOST || null, null)
  const port = pick("port", row?.port, envNumber(process.env.SMTP_PORT), DEFAULT_PORT)!
  const username = pick("username", row?.username || null, process.env.SMTP_USER || null, null)
  const from = pick("from", row?.fromAddress || null, process.env.MAIL_FROM || null, DEFAULT_FROM)!
  const digestHour = pick("digestHour", row?.digestHour, envNumber(process.env.DIGEST_HOUR), DEFAULT_DIGEST_HOUR)!

  const publicUrl = pick("publicUrl", normalizePublicUrl(row?.publicUrl), normalizePublicUrl(process.env.AUTH_URL), null)

  // secure has a third state: unset means "decide from the port", which is what
  // the env var did before this was configurable.
  const envSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : null
  const secure = pick("secure", row?.secure, envSecure, port === 465)!

  let password: string | null = null
  let passwordUnreadable = false
  if (row?.passwordEnc) {
    password = decrypt(row.passwordEnc)
    if (password === null) passwordUnreadable = true
    sources.password = "settings"
  } else if (process.env.SMTP_PASS) {
    password = process.env.SMTP_PASS
    sources.password = "env"
  } else {
    sources.password = "unset"
  }

  return {
    host,
    port,
    username,
    password,
    secure,
    from,
    publicUrl,
    digestHour: digestHour >= 0 && digestHour <= 23 ? digestHour : DEFAULT_DIGEST_HOUR,
    sources,
    passwordUnreadable,
    dryRun: process.env.MAIL_DRY_RUN === "1",
  }
}

/** A signature that changes whenever anything the transport cares about does. */
export function transportSignature(config: MailConfig) {
  return JSON.stringify([config.host, config.port, config.username, config.password, config.secure, config.dryRun])
}
