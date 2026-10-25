import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/secret-box"
import { effectiveInterval, type IntervalSource } from "./interval"
import { isPushType, type PushTarget, type PushType } from "./push-format"

export const NOTIFICATION_SETTINGS_ID = "singleton"

export type NotificationConfig = {
  interval: { minutes: number; source: IntervalSource }
  push: {
    enabled: boolean
    type: PushType
    target: PushTarget
    hasUrl: boolean
    hasToken: boolean
    /** A secret is stored but AUTH_SECRET can no longer decrypt it. */
    unreadable: boolean
    lastError: string | null
    lastOkAt: Date | null
  }
}

/** Settings first, then NOTIFY_INTERVAL_MINUTES, then the default; push secrets decrypted. */
export async function loadNotificationConfig(): Promise<NotificationConfig> {
  const row = await prisma.notificationSettings.findUnique({ where: { id: NOTIFICATION_SETTINGS_ID } })

  const url = row?.pushUrlEnc ? decrypt(row.pushUrlEnc) : null
  const token = row?.pushTokenEnc ? decrypt(row.pushTokenEnc) : null
  const type: PushType = row?.pushType && isPushType(row.pushType) ? row.pushType : "DISCORD"

  return {
    interval: effectiveInterval(row?.intervalMinutes, process.env.NOTIFY_INTERVAL_MINUTES),
    push: {
      enabled: row?.pushEnabled ?? false,
      type,
      target: { type, url, token, chatId: row?.pushChatId || null },
      hasUrl: Boolean(row?.pushUrlEnc),
      hasToken: Boolean(row?.pushTokenEnc),
      unreadable: (Boolean(row?.pushUrlEnc) && url === null) || (Boolean(row?.pushTokenEnc) && token === null),
      lastError: row?.pushLastError ?? null,
      lastOkAt: row?.pushLastOkAt ?? null,
    },
  }
}
