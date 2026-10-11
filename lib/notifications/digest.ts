import { prisma } from "@/lib/prisma"
import { isMailConfigured, sendMail } from "./mailer"
import { loadMailConfig, DEFAULT_DIGEST_HOUR } from "./mail-config"
import type { EmailDigest, Notification } from "@/app/generated/prisma/client"
import { loadFeatures, visibleNotificationsWhere } from "@/lib/features-server"

// Email is a digest, not a channel. The NotificationChannel interface is
// per-notification, so wiring email into it would send one message per due
// item — six emails from a single check. Instead this reads what InAppChannel
// already wrote and sends each user one message covering everything pending.

/** Most recent occurrence of `hour` o'clock at or before `now`. */
function lastHourBoundary(now: Date, hour: number) {
  const boundary = new Date(now)
  boundary.setHours(hour, 0, 0, 0)
  if (boundary > now) boundary.setDate(boundary.getDate() - 1)
  return boundary
}

/** Most recent Monday at `hour` o'clock at or before `now`. */
function lastWeekBoundary(now: Date, hour: number) {
  const boundary = lastHourBoundary(now, hour)
  // getDay(): 0 = Sunday, so Monday is 1 and Sunday is 7 days back.
  const daysSinceMonday = (boundary.getDay() + 6) % 7
  boundary.setDate(boundary.getDate() - daysSinceMonday)
  return boundary
}

/**
 * Whether a user is due an email now.
 *
 * DAILY and WEEKLY fire on the first pass at or after the cutoff rather than at
 * it: the scheduler ticks every NOTIFY_INTERVAL_MINUTES (6h by default), so a
 * digest can land up to one tick late. Making it exact would mean a much finer
 * timer for two messages a day.
 */
export function digestDue(
  cadence: EmailDigest,
  lastDigestAt: Date | null,
  now: Date = new Date(),
  hour: number = DEFAULT_DIGEST_HOUR
) {
  if (cadence === "OFF") return false
  if (cadence === "ASAP") return true
  if (lastDigestAt === null) return true

  const cutoff = cadence === "WEEKLY" ? lastWeekBoundary(now, hour) : lastHourBoundary(now, hour)
  return lastDigestAt < cutoff
}

function baseUrl() {
  return (process.env.AUTH_URL || process.env.APP_URL || "").replace(/\/$/, "")
}

function renderDigest(name: string, notifications: Notification[]) {
  const url = baseUrl()
  const heading = notifications.length === 1
    ? "1 item needs your attention"
    : `${notifications.length} items need your attention`

  const text = [
    `Hi ${name},`,
    "",
    heading + ":",
    "",
    ...notifications.map((n) => `- ${n.title}\n  ${n.message}`),
    "",
    url ? `See everything: ${url}/notifications` : "Open HomeCenter to see everything.",
  ].join("\n")

  const rows = notifications
    .map(
      (n) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e5e5">
        <div style="font-weight:600;color:#111">${escapeHtml(n.title)}</div>
        <div style="color:#555;margin-top:2px">${escapeHtml(n.message)}</div>
      </td></tr>`
    )
    .join("")

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111">
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(heading)}:</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${url ? `<p style="margin-top:20px"><a href="${url}/notifications">See everything in HomeCenter</a></p>` : ""}
    <p style="color:#888;font-size:12px;margin-top:24px">
      Change how often you get these in HomeCenter under Settings.
    </p>
  </div>`

  return { text, html }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  )
}

/**
 * Emails every user their pending notifications. Returns how many messages went
 * out. A no-op when SMTP isn't configured, which is the default.
 */
export async function sendPendingDigests(now: Date = new Date()): Promise<number> {
  const config = await loadMailConfig()
  if (!isMailConfigured(config)) return 0
  if (config.passwordUnreadable) {
    console.error("[digest] stored SMTP password can't be decrypted — skipping until it's re-entered")
    return 0
  }

  const users = await prisma.user.findMany({
    where: { emailDigest: { not: "OFF" }, receivesNotifications: true },
    select: { id: true, name: true, email: true, emailDigest: true, lastDigestAt: true },
  })

  const candidates = users.filter((u) => digestDue(u.emailDigest, u.lastDigestAt, now, config.digestHour))
  if (candidates.length === 0) return 0

  // Hidden ones wait: with Health off its notifications aren't sent, and go out
  // in a later digest if it's turned back on.
  const visible = await visibleNotificationsWhere(await loadFeatures())
  const pending = await prisma.notification.findMany({
    where: { emailedAt: null, dismissedAt: null, userId: { in: candidates.map((u) => u.id) }, ...visible },
    orderBy: { createdAt: "asc" },
  })
  if (pending.length === 0) return 0

  const byUser = new Map<string, Notification[]>()
  for (const n of pending) {
    const list = byUser.get(n.userId)
    if (list) list.push(n)
    else byUser.set(n.userId, [n])
  }

  let sent = 0
  for (const user of candidates) {
    const items = byUser.get(user.id)
    if (!items?.length) continue

    const { text, html } = renderDigest(user.name.split(" ")[0], items)
    const subject = items.length === 1 ? items[0].title : `HomeCenter: ${items.length} items need attention`

    try {
      await sendMail({ to: user.email, subject, text, html }, config)
    } catch (error) {
      // Left unmarked so the next pass retries rather than silently dropping.
      console.error(`[digest] send to ${user.email} failed:`, error)
      continue
    }

    // Marked only after a successful send.
    await prisma.$transaction([
      prisma.notification.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { emailedAt: now },
      }),
      prisma.user.update({ where: { id: user.id }, data: { lastDigestAt: now } }),
    ])
    sent++
  }

  return sent
}
