import { prisma } from "@/lib/prisma"
import { getFormat } from "@/lib/regional-server"
import type { Formatter } from "@/lib/regional"
import { notificationService, type NotificationPayload } from "./channels"
import { scheduleDue, dueCandidateFilter, type Due } from "@/lib/maintenance-due"
import { loadVehicleMileage } from "@/lib/maintenance-due-server"
import { daysUntil, HEALTH_WINDOWS, immunizationDue, insuranceExpiring, isSupersededImmunization, refillDue } from "@/lib/health"
import { ownedWhere } from "@/lib/features"
import { loadFeatures } from "@/lib/features-server"
import { HEALTH_INSURANCE_KINDS, POLICY_RENEWAL_DAYS, renewalNotice } from "@/lib/insurance"
import { cycleKeyOf, decide, maintenanceCycleKey, type NotificationRepeat, type Stage } from "./repeat"

const WARRANTY_WARN_DAYS = 60
const MAINTENANCE_WINDOW_DAYS = 30

const plural = (n: number, unit: string) => `${n.toLocaleString()} ${unit}${n !== 1 ? "s" : ""}`

const DAY = 86_400_000

// "is due in 3 days" / "is due today" / "was due 2 days ago".
function dueWhen(days: number) {
  if (days < 0) return `was due ${plural(-days, "day")} ago`
  if (days === 0) return "is due today"
  return `is due in ${plural(days, "day")}`
}

// Says which of the two clocks ran out, so "due soon" on an oil change reads
// "in 300 miles" rather than a date the owner may be nowhere near.
function dueMessage(title: string, due: Due, fmt: Formatter) {
  if (due.reason === "mileage" && due.milesLeft != null) {
    const word = fmt.meterWord(due.meterUnit ?? "MILES")
    return due.milesLeft < 0
      ? `"${title}" was due ${plural(Math.abs(due.milesLeft), word)} ago.`
      : `"${title}" is due in ${plural(due.milesLeft, word)}.`
  }
  if (due.daysLeft == null) return `"${title}" is due.`
  return due.daysLeft < 0
    ? `"${title}" was due ${plural(Math.abs(due.daysLeft), "day")} ago.`
    : `"${title}" is due in ${plural(due.daysLeft, "day")}.`
}

const dedupKey = (userId: string, type: string, entityId: string) => `${userId}:${type}:${entityId}`

const stageOf = (onOrPastDue: boolean): Stage => (onOrPastDue ? "DUE" : "REACHED")

/**
 * Creates in-app notifications for due maintenance, expiring warranties, and health items (refills, vaccines, health insurance), and policy renewals.
 *
 * Called by the scheduler in ./scheduler.ts, which is the only caller — it
 * serialises runs, so the dedup read below can't race another pass writing the
 * same notification between the read and the write.
 *
 * Returns how many notifications it created, for the scheduler's log line.
 */
export async function checkAndNotify(): Promise<number> {
  // Only the accounts an admin has chosen under Settings → Notifications.
  const users = await prisma.user.findMany({
    where: { receivesNotifications: true },
    select: { id: true, notificationRepeat: true },
  })
  if (users.length === 0) return 0

  const fmt = await getFormat()
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setUTCHours(0, 0, 0, 0)

  // With Health off, nothing about people is raised: no health reminders, and
  // none for a person's own reminders or warranties.
  const features = await loadFeatures()
  const owned = ownedWhere(features)
  const health = <T,>(query: () => Promise<T[]>) => (features.health ? query() : Promise.resolve([] as T[]))

  const [schedules, mileage, warranties, medications, immunizations, policies, renewals] = await Promise.all([
    prisma.maintenanceSchedule.findMany({ where: { AND: [dueCandidateFilter(MAINTENANCE_WINDOW_DAYS, now), owned] } }),
    loadVehicleMileage(),
    prisma.warranty.findMany({
      where: {
        ...owned,
        // From the start of today, so a warranty still gets its due-date
        // reminder on the day it expires.
        expirationDate: {
          gte: startOfToday,
          lte: new Date(now.getTime() + WARRANTY_WARN_DAYS * 86400000),
        },
      },
    }),
    // The date filters only narrow the read; refillDue / immunizationDue /
    // insuranceExpiring below are the rules, shared with the UI badges.
    health(() => prisma.medication.findMany({
      where: { nextRefillDate: { lte: new Date(now.getTime() + HEALTH_WINDOWS.refillDays * DAY) } },
      include: { person: { select: { name: true } } },
    })),
    health(() => prisma.immunization.findMany({
      where: { nextDueDate: { lte: new Date(now.getTime() + HEALTH_WINDOWS.immunizationDays * DAY) } },
      include: { person: { select: { name: true } } },
    })),
    // endDate is stored as UTC midnight, so use startOfToday to include policies ending today.
    health(() => prisma.insurancePolicy.findMany({
      where: {
        kind: { in: [...HEALTH_INSURANCE_KINDS] },
        endDate: { gte: startOfToday, lte: new Date(now.getTime() + HEALTH_WINDOWS.insuranceDays * DAY) },
      },
    })),
    // Home, auto, umbrella and life renewals aren't health data: raised whether or not Health is on.
    prisma.insurancePolicy.findMany({
      where: {
        kind: { notIn: [...HEALTH_INSURANCE_KINDS] },
        endDate: { gte: startOfToday, lte: new Date(now.getTime() + POLICY_RENEWAL_DAYS * DAY) },
      },
    }),
  ])

  // A later dose of the same vaccine supersedes an earlier one, so fetch every
  // dose on file for the candidates' people to check that once instead of
  // querying per row.
  const immunizationPersonIds = [...new Set(immunizations.map((i) => i.personId))]
  const immunizationsForCandidates = immunizationPersonIds.length
    ? await prisma.immunization.findMany({
        where: { personId: { in: immunizationPersonIds } },
        select: { personId: true, vaccine: true, dateGiven: true },
      })
    : []

  // Build every notification this run would want to send, then filter against
  // what already exists. Asking the database per row per user instead cost one
  // sequential round-trip each, which grew with both counts.
  const wanted: NotificationPayload[] = []

  for (const s of schedules) {
    const due = scheduleDue(s, mileage, now)
    if (!due.overdue && !due.dueSoon) continue
    const stage = stageOf(due.overdue || due.daysLeft === 0 || due.milesLeft === 0)
    const cycleKey = maintenanceCycleKey(s)

    for (const user of users) {
      wanted.push({
        userId: user.id,
        type: "MAINTENANCE_DUE",
        title: due.overdue ? `Overdue: ${s.title}` : stage === "DUE" ? `Due today: ${s.title}` : `Due soon: ${s.title}`,
        message: dueMessage(s.title, due, fmt),
        relatedEntityId: s.id,
        relatedEntityType: "MaintenanceSchedule",
        cycleKey,
        stage,
      })
    }
  }

  for (const w of warranties) {
    const daysLeft = daysUntil(w.expirationDate!, now)
    const stage = stageOf(daysLeft <= 0)

    for (const user of users) {
      wanted.push({
        userId: user.id,
        type: "WARRANTY_EXPIRING",
        title: `Warranty expiring: ${w.productName}`,
        message: daysLeft <= 0
          ? `Warranty for "${w.productName}" expires today.`
          : `Warranty for "${w.productName}" expires in ${plural(daysLeft, "day")}.`,
        relatedEntityId: w.id,
        relatedEntityType: "Warranty",
        cycleKey: cycleKeyOf(w.expirationDate),
        stage,
      })
    }
  }

  for (const m of medications) {
    if (!refillDue(m, now)) continue
    const days = daysUntil(m.nextRefillDate!, now)
    for (const user of users) {
      wanted.push({
        userId: user.id,
        type: "MEDICATION_REFILL",
        title: `Refill: ${m.name} (${m.person.name})`,
        message: `${m.person.name}'s ${m.name} refill ${dueWhen(days)}.`,
        relatedEntityId: m.id,
        relatedEntityType: "Medication",
        cycleKey: cycleKeyOf(m.nextRefillDate),
        stage: stageOf(days <= 0),
      })
    }
  }

  for (const i of immunizations) {
    if (!immunizationDue(i, now) || isSupersededImmunization(i, immunizationsForCandidates)) continue
    const days = daysUntil(i.nextDueDate!, now)
    for (const user of users) {
      wanted.push({
        userId: user.id,
        type: "IMMUNIZATION_DUE",
        title: `Vaccine due: ${i.vaccine} (${i.person.name})`,
        message: `${i.person.name}'s ${i.vaccine} ${dueWhen(days)}.`,
        relatedEntityId: i.id,
        relatedEntityType: "Immunization",
        cycleKey: cycleKeyOf(i.nextDueDate),
        stage: stageOf(days <= 0),
      })
    }
  }

  for (const p of policies) {
    if (!insuranceExpiring(p, now)) continue
    const days = daysUntil(p.endDate!, now)
    const name = p.planName ? `${p.carrier} ${p.planName}` : p.carrier
    for (const user of users) {
      wanted.push({
        userId: user.id,
        type: "INSURANCE_EXPIRING",
        title: `Insurance ending: ${name}`,
        message: days === 0 ? `"${name}" coverage ends today.` : `"${name}" coverage ends in ${plural(days, "day")}.`,
        relatedEntityId: p.id,
        relatedEntityType: "InsurancePolicy",
        cycleKey: cycleKeyOf(p.endDate),
        stage: stageOf(days <= 0),
      })
    }
  }

  for (const p of renewals) {
    const notice = renewalNotice(p, now)
    if (!notice) continue
    for (const user of users) {
      wanted.push({
        userId: user.id,
        type: "POLICY_RENEWAL",
        title: notice.title,
        message: notice.message,
        relatedEntityId: p.id,
        relatedEntityType: "InsurancePolicy",
        cycleKey: cycleKeyOf(p.endDate),
        stage: notice.stage,
      })
    }
  }

  if (wanted.length === 0) return 0

  // One read covers the whole run: every notification, in any state, for the
  // items this run would raise. Each person's repeat setting then decides from
  // their own history whether to create, bring one back, or stay quiet.
  const existing = await prisma.notification.findMany({
    where: { relatedEntityId: { in: [...new Set(wanted.map((w) => w.relatedEntityId!))] } },
    select: { id: true, userId: true, type: true, relatedEntityId: true, cycleKey: true, stage: true, isRead: true, dismissedAt: true, createdAt: true },
  })
  const history = new Map<string, typeof existing>()
  for (const e of existing) {
    const key = dedupKey(e.userId, e.type, e.relatedEntityId!)
    history.set(key, [...(history.get(key) ?? []), e])
  }
  const repeatOf = new Map(users.map((u) => [u.id, u.notificationRepeat as NotificationRepeat]))

  let fresh = 0
  for (const w of wanted) {
    const decision = decide(
      repeatOf.get(w.userId)!,
      w.stage as Stage,
      w.cycleKey!,
      history.get(dedupKey(w.userId, w.type, w.relatedEntityId!)) ?? [],
    )
    if (decision.action === "create") {
      // Sent through the channel service rather than a bulk insert so that
      // adding a push channel still delivers these.
      await notificationService.send(w)
      fresh++
    } else if (decision.action === "resurface") {
      // Back to unread with today's wording, and pending email again.
      await prisma.notification.update({
        where: { id: decision.id },
        data: { title: w.title, message: w.message, stage: w.stage, isRead: false, emailedAt: null, createdAt: now },
      })
      fresh++
    }
  }

  return fresh
}
