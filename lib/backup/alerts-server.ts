import { prisma } from "@/lib/prisma"
import { notificationService } from "@/lib/notifications/channels"

/** Notification.relatedEntityType for backup problems; links to Settings → Data. CUSTOM type, like the Intake nudge, so no enum migration. */
export const BACKUP_ENTITY = "Backup"

/** One open alert per admin per cycleKey ("run:<id>" or "stale:<newest>"). Email follows through the digest. */
export async function raiseBackupAlert(cycleKey: string, title: string, message: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })
  for (const a of admins) {
    const exists = await prisma.notification.findFirst({ where: { userId: a.id, relatedEntityType: BACKUP_ENTITY, cycleKey } })
    if (exists) continue
    await notificationService.send({ userId: a.id, type: "CUSTOM", title, message, relatedEntityType: BACKUP_ENTITY, cycleKey })
  }
}

/** A good backup answers every open backup alert. */
export async function resolveBackupAlerts(): Promise<void> {
  await prisma.notification.updateMany({
    where: { relatedEntityType: BACKUP_ENTITY, dismissedAt: null },
    data: { isRead: true, dismissedAt: new Date() },
  })
}
