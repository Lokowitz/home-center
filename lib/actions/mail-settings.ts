"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { encrypt } from "@/lib/secret-box"
import { loadMailConfig, normalizePublicUrl, SETTINGS_ID } from "@/lib/notifications/mail-config"
import { resetMailTransport, sendMail, verifyMail, isMailConfigured } from "@/lib/notifications/mailer"

async function requireAdmin() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  return session
}

const schema = z.object({
  host: z.string().trim().optional(),
  port: z.string().trim().optional(),
  username: z.string().trim().optional(),
  // Empty means "leave whatever is stored alone" — the browser is never sent
  // the saved password, so it can't echo it back.
  password: z.string().optional(),
  clearPassword: z.boolean().optional(),
  secure: z.enum(["auto", "true", "false"]),
  fromAddress: z.string().trim().optional(),
  digestHour: z.string().trim().optional(),
  publicUrl: z.string().trim().optional(),
})

export type MailSettingsInput = z.infer<typeof schema>

/** True when the server is being pointed somewhere other than where the password was saved for. */
function hostChanged(savedHost: string | null, nextHost: string | null) {
  const norm = (h: string | null) => (h ?? "").trim().toLowerCase()
  return norm(savedHost) !== norm(nextHost)
}

function optionalInt(raw: string | undefined, min: number, max: number) {
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) return undefined // signals invalid
  return n
}

export async function updateMailSettings(data: MailSettingsInput) {
  await requireAdmin()

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: "Invalid input." }
  const v = parsed.data

  const port = optionalInt(v.port, 1, 65535)
  if (port === undefined) return { error: "Port must be a number between 1 and 65535." }

  const digestHour = optionalInt(v.digestHour, 0, 23)
  if (digestHour === undefined) return { error: "Digest hour must be between 0 and 23." }

  const publicUrl = normalizePublicUrl(v.publicUrl)
  if (v.publicUrl && !publicUrl) return { error: "Public address must start with http:// or https://, e.g. https://home.example.com." }

  // Blank fields clear the override and fall back to the environment variable.
  const base = {
    host: v.host || null,
    port,
    username: v.username || null,
    secure: v.secure === "auto" ? null : v.secure === "true",
    fromAddress: v.fromAddress || null,
    digestHour,
    publicUrl,
  }

  // A stored password never follows the settings to a different server.
  // Compared as resolved, so a blank field and SMTP_HOST count as the same server.
  const savedHost = (await loadMailConfig()).host
  const passwordEnc = v.clearPassword
    ? null
    : v.password
      ? encrypt(v.password)
      : hostChanged(savedHost, base.host || process.env.SMTP_HOST || null)
        ? null
        : undefined // undefined = don't touch the stored value

  await prisma.mailSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...base, passwordEnc: passwordEnc ?? null },
    update: { ...base, ...(passwordEnc === undefined ? {} : { passwordEnc }) },
  })

  // The pooled transport is memoised on the old settings.
  resetMailTransport()
  revalidatePath("/settings")
  return { success: true }
}

/**
 * Config to test with: what's on screen, falling back to what's saved. Testing
 * only the saved values meant "Test connection" reported nothing configured
 * until you saved first, which is backwards — the point of a test button is to
 * try something before committing to it.
 */
async function draftConfig(input?: MailSettingsInput) {
  const saved = await loadMailConfig()
  if (!input) return saved

  const parsed = schema.safeParse(input)
  if (!parsed.success) return saved
  const v = parsed.data

  const port = optionalInt(v.port, 1, 65535)
  const resolvedPort = port === undefined || port === null ? saved.port : port
  const host = v.host || saved.host

  return {
    ...saved,
    host,
    port: resolvedPort,
    username: v.username || saved.username,
    // An empty password field means "keep the stored one", same as on save, but
    // only for the server it was saved for: otherwise "Test" would hand the
    // stored password to whatever host was typed in.
    password: v.password || (hostChanged(saved.host, host) ? null : saved.password),
    secure: v.secure === "auto" ? resolvedPort === 465 : v.secure === "true",
    from: v.fromAddress || saved.from,
  }
}

// Providers tend to answer with a code and a support URL rather than an
// explanation. Worth translating the ones people actually hit.
function explain(error: string) {
  if (/application-specific password|InvalidSecondFactor/i.test(error)) {
    return `${error}\n\nGmail rejects normal account passwords. Turn on 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords and use that here.`
  }
  if (/535|Username and Password not accepted|authentication failed/i.test(error)) {
    return `${error}\n\nThe server rejected these credentials. Most providers need an app-specific password rather than your account password.`
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error)) {
    return `${error}\n\nCouldn't reach the server — check the hostname and port, and that this machine can make outbound connections on it.`
  }
  return error
}

/** Opens a connection and authenticates, without sending anything. */
export async function testMailConnection(input?: MailSettingsInput) {
  await requireAdmin()
  const config = await draftConfig(input)
  const result = await verifyMail(config)
  return result.ok ? { success: true } : { error: explain(result.error) }
}

/** Sends a real message to the signed-in admin, so delivery is proven end to end. */
export async function sendTestEmail(input?: MailSettingsInput) {
  const session = await requireAdmin()

  const config = await draftConfig(input)
  if (!isMailConfigured(config)) return { error: "No mail server configured." }
  if (config.passwordUnreadable) return { error: "The saved password can't be decrypted — re-enter it." }

  const to = session.user.email
  if (!to) return { error: "Your account has no email address." }

  try {
    await sendMail(
      {
        to,
        subject: "HomeCenter test email",
        text: "This is a test from HomeCenter. Your mail settings work.",
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif">
          <p>This is a test from HomeCenter.</p>
          <p>Your mail settings work — reminders will be delivered this way.</p>
        </div>`,
      },
      config
    )
  } catch (error) {
    return { error: explain(error instanceof Error ? error.message : String(error)) }
  }

  return { success: true, sentTo: to, dryRun: config.dryRun }
}
