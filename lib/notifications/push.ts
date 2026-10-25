import { prisma } from "@/lib/prisma"
import { loadFeatures, visibleNotificationsWhere } from "@/lib/features-server"
import { loadMailConfig } from "./mail-config"
import { loadNotificationConfig, NOTIFICATION_SETTINGS_ID } from "./notification-settings"
import { buildPushRequest, groupForPush, missingPushFields, type PushItem, type PushTarget } from "./push-format"

// Push is one global endpoint, sent once per pass. Like email it reads what
// InAppChannel already wrote, so a check that finds six things sends one
// message. It is not a NotificationChannel for the same reason email isn't.

const TIMEOUT_MS = 10_000

type Fetch = typeof fetch

/**
 * Sends one message. The error text never includes the URL: Discord's webhook
 * URL and Telegram's bot token both live in it, and this ends up on the
 * settings page.
 */
export async function sendPush(
  target: PushTarget,
  items: PushItem[],
  publicUrl: string | null,
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const missing = missingPushFields(target)
  if (missing) return { ok: false, error: missing }
  const req = buildPushRequest(target, items, publicUrl)
  if (!req) return { ok: false, error: "Push isn't fully set up." }

  try {
    const res = await fetchImpl(req.url, { ...req.init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" })
    if (res.ok) return { ok: true }
    // Discord says how long to wait. This pass fails and the next one retries.
    const wait = res.status === 429 ? ` Rate limited, will retry next check.` : ""
    return { ok: false, error: `The service answered ${res.status}.${wait}` }
  } catch (error) {
    const code = error instanceof Error ? ((error.cause as { code?: string } | undefined)?.code ?? error.name) : "error"
    return { ok: false, error: `Couldn't reach the service (${code}).` }
  }
}

/** Sends everything not yet pushed. Returns the number of items sent; a no-op while push is off. */
export async function sendPendingPush(now: Date = new Date(), fetchImpl: Fetch = fetch): Promise<number> {
  const { push } = await loadNotificationConfig()
  if (!push.enabled) return 0
  if (push.unreadable) {
    console.error("[push] stored secret can't be decrypted — skipping until it's re-entered")
    return 0
  }

  const visible = await visibleNotificationsWhere(await loadFeatures())
  const pending = await prisma.notification.findMany({
    where: { pushedAt: null, dismissedAt: null, user: { receivesNotifications: true }, ...visible },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, title: true, message: true, relatedEntityId: true, cycleKey: true, stage: true },
  })
  if (pending.length === 0) return 0

  const { items, rowIds } = groupForPush(pending)
  const result = await sendPush(push.target, items, (await loadMailConfig()).publicUrl, fetchImpl)

  if (!result.ok) {
    console.error(`[push] send failed: ${result.error}`)
    await prisma.notificationSettings.update({ where: { id: NOTIFICATION_SETTINGS_ID }, data: { pushLastError: result.error } })
    return 0
  }

  // Marked only after a successful send, so a failure retries next pass.
  await prisma.$transaction([
    prisma.notification.updateMany({ where: { id: { in: rowIds } }, data: { pushedAt: now } }),
    prisma.notificationSettings.update({ where: { id: NOTIFICATION_SETTINGS_ID }, data: { pushLastError: null, pushLastOkAt: now } }),
  ])
  return items.length
}
