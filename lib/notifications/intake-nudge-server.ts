import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { notificationService } from "./channels"
import { decideIntakeNudge, intakeNudgeCutoff, INTAKE_NUDGE_ENTITY } from "./intake-nudge"

/**
 * Raises, updates or clears each person's Intake nudge (see ./intake-nudge.ts).
 *
 * Run by the scheduler in ./scheduler.ts after checkAndNotify, so it shares that
 * pass's serialisation and its dedupe can't race another run. Returns how many
 * nudges it created, for the scheduler's log line.
 *
 * The nudge uses the CUSTOM type with relatedEntityType "Intake": adding a type
 * would need a migration, and CUSTOM was otherwise unused.
 */
export async function nudgeIntake(now: Date = new Date()): Promise<number> {
  // The same recipients as every other reminder: the accounts an admin has
  // chosen under Settings → Notifications.
  const users = await prisma.user.findMany({ where: { receivesNotifications: true }, select: { id: true } })
  if (users.length === 0) return 0

  const [items, features, existing] = await Promise.all([
    // The date filter only narrows the read; decideIntakeNudge is the rule.
    prisma.inboxItem.findMany({
      where: { attachments: { some: {} }, createdAt: { lt: intakeNudgeCutoff(now) } },
      select: { createdAt: true, suggestedAssetType: true },
    }),
    loadFeatures(),
    prisma.notification.findMany({
      where: { type: "CUSTOM", relatedEntityType: INTAKE_NUDGE_ENTITY, userId: { in: users.map((u) => u.id) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, title: true, message: true, cycleKey: true, dismissedAt: true },
    }),
  ])

  let created = 0
  for (const user of users) {
    const decision = decideIntakeNudge({ items, now, prior: existing.filter((e) => e.userId === user.id), health: features.health })
    switch (decision.action) {
      case "create":
        await notificationService.send({
          userId: user.id,
          type: "CUSTOM",
          title: decision.title,
          message: decision.message,
          relatedEntityType: INTAKE_NUDGE_ENTITY,
          cycleKey: decision.cycleKey,
        })
        created++
        break
      case "update":
        // New wording only: read state and email status stay, so a changing
        // count doesn't bring it back to unread or send another email.
        await prisma.notification.update({
          where: { id: decision.id },
          data: { title: decision.title, message: decision.message, cycleKey: decision.cycleKey },
        })
        break
      case "resolve":
        // Nothing left to file: it leaves the bell and the pending digest, the
        // same as a maintenance reminder that's been done.
        await prisma.notification.update({ where: { id: decision.id }, data: { isRead: true, dismissedAt: now } })
        break
    }
  }
  return created
}
