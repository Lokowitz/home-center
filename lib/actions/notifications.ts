"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ignoreGone } from "@/lib/gone"
import { loadFeatures, visibleNotificationsWhere } from "@/lib/features-server"
import { loadHiddenEntityIds, loadPropertyScope } from "@/lib/property-filter-server"
import { notificationScopeWhere } from "@/lib/property-filter"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

async function userId() {
  const session = await auth()
  if (!session) redirect("/login")
  return session.user.id
}

export async function markNotificationRead(id: string) {
  const uid = await userId()
  await ignoreGone(() => prisma.notification.update({ where: { id, userId: uid }, data: { isRead: true } }))
  revalidatePath("/notifications")
}

export async function markAllNotificationsRead() {
  const uid = await userId()
  const scope = await loadPropertyScope()
  // With no scope the where is exactly today's.
  // Under a scope, two ORs can't share one object, so each goes in its own AND slot.
  const where = scope
    ? {
        userId: uid,
        isRead: false,
        AND: [await visibleNotificationsWhere(await loadFeatures()), notificationScopeWhere(await loadHiddenEntityIds(scope))],
      }
    : { userId: uid, isRead: false }
  await prisma.notification.updateMany({ where, data: { isRead: true } })
  revalidatePath("/notifications")
}

/** Hides it from the list and the bell. Dismissing also counts as reading it. */
export async function dismissNotification(id: string) {
  const uid = await userId()
  await ignoreGone(() => prisma.notification.update({
    where: { id, userId: uid },
    data: { isRead: true, dismissedAt: new Date() },
  }))
  revalidatePath("/", "layout")
}

/** Brings a dismissed notification back into the list. */
export async function restoreNotification(id: string) {
  const uid = await userId()
  await ignoreGone(() => prisma.notification.update({ where: { id, userId: uid }, data: { dismissedAt: null } }))
  revalidatePath("/", "layout")
}
