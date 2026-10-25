"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { encrypt } from "@/lib/secret-box"
import { loadNotificationConfig, NOTIFICATION_SETTINGS_ID } from "@/lib/notifications/notification-settings"
import { isValidInterval, MIN_INTERVAL_MINUTES } from "@/lib/notifications/interval"
import { isPushType, missingPushFields, type PushTarget } from "@/lib/notifications/push-format"
import { sendPush } from "@/lib/notifications/push"
import { loadMailConfig } from "@/lib/notifications/mail-config"
import { applyNotificationInterval } from "@/lib/notifications/scheduler"

async function requireAdmin() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  return session
}

const intervalSchema = z.object({
  // Blank clears the setting and falls back to NOTIFY_INTERVAL_MINUTES, then 6 hours.
  intervalMinutes: z.string().trim(),
})

export async function updateNotificationInterval(data: { intervalMinutes: string }) {
  await requireAdmin()
  const parsed = intervalSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid input." }

  const raw = parsed.data.intervalMinutes
  const minutes = raw === "" ? null : Number(raw)
  if (minutes !== null && !isValidInterval(minutes)) {
    return { error: `Enter 0 to turn checks off, or ${MIN_INTERVAL_MINUTES} minutes or more.` }
  }

  await prisma.notificationSettings.upsert({
    where: { id: NOTIFICATION_SETTINGS_ID },
    create: { id: NOTIFICATION_SETTINGS_ID, intervalMinutes: minutes },
    update: { intervalMinutes: minutes },
  })

  // Takes effect now, without a restart.
  await applyNotificationInterval()
  revalidatePath("/settings")
  return { success: true }
}

const pushSchema = z.object({
  enabled: z.boolean(),
  type: z.string(),
  // Empty means "leave the stored value alone": the browser is never sent the
  // saved URL or token, so it can't echo them back.
  url: z.string().trim().optional(),
  token: z.string().trim().optional(),
  chatId: z.string().trim().optional(),
  clearUrl: z.boolean().optional(),
  clearToken: z.boolean().optional(),
})

export type PushSettingsInput = z.infer<typeof pushSchema>

function isHttpUrl(raw: string) {
  try {
    const u = new URL(raw)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export async function updatePushSettings(data: PushSettingsInput) {
  await requireAdmin()
  const parsed = pushSchema.safeParse(data)
  if (!parsed.success || !isPushType(parsed.data.type)) return { error: "Invalid input." }
  const v = parsed.data
  const type = asType(v.type)

  if (v.url && !isHttpUrl(v.url)) return { error: "The URL must start with http:// or https://." }

  const saved = await loadNotificationConfig()
  const wasEnabled = saved.push.enabled
  // A stored secret never follows the settings to a different service.
  const sameType = saved.push.type === type

  // Telegram builds its own URL from the token, so it keeps none.
  const dropUrl = v.clearUrl || type === "TELEGRAM" || !sameType
  const dropToken = v.clearToken || !sameType
  const urlEnc = v.url && type !== "TELEGRAM" ? encrypt(v.url) : dropUrl ? null : undefined // undefined = don't touch
  const tokenEnc = v.token ? encrypt(v.token) : dropToken ? null : undefined

  const next: PushTarget = {
    type,
    url: v.url || (dropUrl ? null : saved.push.target.url),
    token: v.token || (dropToken ? null : saved.push.target.token),
    chatId: v.chatId || null,
  }
  if (v.enabled) {
    const missing = missingPushFields(next)
    if (missing) return { error: missing }
  }

  await prisma.$transaction(async (tx) => {
    await tx.notificationSettings.upsert({
      where: { id: NOTIFICATION_SETTINGS_ID },
      create: {
        id: NOTIFICATION_SETTINGS_ID,
        pushEnabled: v.enabled,
        pushType: type,
        pushUrlEnc: urlEnc ?? null,
        pushTokenEnc: tokenEnc ?? null,
        pushChatId: v.chatId || null,
      },
      update: {
        pushEnabled: v.enabled,
        pushType: type,
        pushChatId: v.chatId || null,
        ...(urlEnc === undefined ? {} : { pushUrlEnc: urlEnc }),
        ...(tokenEnc === undefined ? {} : { pushTokenEnc: tokenEnc }),
        pushLastError: null,
      },
    })
    // Turning push on starts from now. Without this the first pass would send
    // everything still unread from before.
    if (v.enabled && !wasEnabled) {
      await tx.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } })
    }
  })

  revalidatePath("/settings")
  return { success: true }
}

// Narrows the validated string to a PushType without a cast at each use.
function asType(t: string) {
  if (!isPushType(t)) throw new Error("not a push type")
  return t
}

/** Sends a real message with what's on screen, falling back to what's saved. */
export async function sendTestPush(data: PushSettingsInput) {
  await requireAdmin()
  const parsed = pushSchema.safeParse(data)
  if (!parsed.success || !isPushType(parsed.data.type)) return { error: "Invalid input." }
  const v = parsed.data
  const type = asType(v.type)

  const saved = await loadNotificationConfig()
  if (saved.push.unreadable && !v.url && !v.token) return { error: "The saved secret can't be decrypted. Enter it again." }
  if (v.url && !isHttpUrl(v.url)) return { error: "The URL must start with http:// or https://." }

  // Same rule as saving: a stored secret is only used for the type it was saved for.
  const sameType = saved.push.type === type
  const target: PushTarget = {
    type,
    url: type === "TELEGRAM" ? null : v.url || (sameType && !v.clearUrl ? saved.push.target.url : null),
    token: v.token || (sameType && !v.clearToken ? saved.push.target.token : null),
    chatId: v.chatId || null,
  }

  const result = await sendPush(
    target,
    [{ type: "CUSTOM", title: "Test message", message: "Push notifications from HomeCenter work." }],
    (await loadMailConfig()).publicUrl,
  )
  return result.ok ? { success: true } : { error: result.error }
}
