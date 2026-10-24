// Planned spend: reminders with an estimated cost, expanded into dated
// occurrences over the next months. Pure: "from" comes in, nothing reads the clock.

import type { AssetType } from "@/app/generated/prisma/client"
import { cents } from "@/lib/costs"
import { firstCalendarDue, nextCalendarDue, parseDueMonths, scheduleKind } from "@/lib/maintenance-schedule"

export type ForecastSchedule = {
  id: string
  title: string
  assetType: AssetType
  assetId: string
  isActive: boolean
  estimatedCost: number | null
  intervalDays: number | null
  intervalMiles: number | null
  dueMonths: string | null
  dueDay: number | null
  nextDueDate: Date | null
  nextDueMileage: number | null
  /// Ignored on purpose: a snooze hides a reminder without moving its due date.
  snoozedUntil?: Date | null
}

export type Occurrence = { scheduleId: string; title: string; assetType: AssetType; assetId: string; date: Date; cost: number }
export type Forecast = { occurrences: Occurrence[]; total: number; mileageOnly: number }

const dayKey = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
const noonOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12))

/// Every dated occurrence in the window: the current month (from `from`'s day) through the next `months - 1`.
export function forecastSchedules(schedules: ForecastSchedule[], from: Date, months = 12): Forecast {
  const today = noonOf(from)
  const windowEnd = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, 12))
  const inWindow = (d: Date) => dayKey(d) < dayKey(windowEnd)
  const occurrences: Occurrence[] = []
  let mileageOnly = 0

  for (const s of schedules) {
    if (!s.isActive || s.estimatedCost == null || s.estimatedCost <= 0) continue
    const kind = scheduleKind(s)
    if (kind === "interval" && !s.intervalDays) {
      mileageOnly++
      continue
    }
    const monthList = parseDueMonths(s.dueMonths)
    const first = kind === "calendar" ? s.nextDueDate ?? firstCalendarDue(monthList, s.dueDay ?? 1, today) : s.nextDueDate
    if (!first) {
      // Nothing dated to project. With only a due mileage it's mileage-based; with nothing at all it's done.
      if (s.nextDueMileage != null) mileageOnly++
      continue
    }

    const emit = (date: Date) => occurrences.push({ scheduleId: s.id, title: s.title, assetType: s.assetType, assetId: s.assetId, date, cost: s.estimatedCost! })

    // Overdue counts once, today; the next one counts from today, as completing it today would.
    let anchor = dayKey(first) < dayKey(today) ? today : noonOf(first)
    if (!inWindow(anchor)) continue
    emit(anchor)

    while (kind !== "once") {
      const next =
        kind === "interval"
          ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + s.intervalDays!, 12))
          : nextCalendarDue(monthList, s.dueDay ?? 1, anchor)
      if (!inWindow(next)) break
      emit(next)
      anchor = next
    }
  }

  occurrences.sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title))
  return { occurrences, total: cents(occurrences.reduce((n, o) => n + o.cost, 0)), mileageOnly }
}

export type ForecastMonth = { key: string; start: Date; total: number; count: number; share: number }

/// Exactly `months` entries from `from`'s UTC month, zero-filled. `share` is the month's total over the largest month's.
export function forecastByMonth(occurrences: Occurrence[], from: Date, months = 12): ForecastMonth[] {
  const buckets = Array.from({ length: months }, (_, i) => {
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1, 12))
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`
    return { key, start, total: 0, count: 0, share: 0 }
  })
  const byKey = new Map(buckets.map((b) => [b.key, b]))
  for (const o of occurrences) {
    const bucket = byKey.get(`${o.date.getUTCFullYear()}-${String(o.date.getUTCMonth() + 1).padStart(2, "0")}`)
    if (!bucket) continue
    bucket.total += o.cost
    bucket.count++
  }
  const max = Math.max(0, ...buckets.map((b) => cents(b.total)))
  return buckets.map((b) => ({ ...b, total: cents(b.total), share: max > 0 ? cents(b.total) / max : 0 }))
}

export type PlannedItem = { scheduleId: string; title: string; assetType: AssetType; assetId: string; total: number; count: number; next: Date; share: number }

/// One entry per reminder, largest total first (ties: earlier next date, then id). `share` is the total over the largest.
export function largestPlanned(occurrences: Occurrence[], limit: number): PlannedItem[] {
  const byId = new Map<string, Omit<PlannedItem, "share">>()
  for (const o of occurrences) {
    const item = byId.get(o.scheduleId)
    if (item) {
      item.total += o.cost
      item.count++
      if (o.date < item.next) item.next = o.date
    } else {
      byId.set(o.scheduleId, { scheduleId: o.scheduleId, title: o.title, assetType: o.assetType, assetId: o.assetId, total: o.cost, count: 1, next: o.date })
    }
  }
  const items = [...byId.values()]
    .map((i) => ({ ...i, total: cents(i.total) }))
    .sort((a, b) => b.total - a.total || a.next.getTime() - b.next.getTime() || a.scheduleId.localeCompare(b.scheduleId))
    .slice(0, limit)
  const max = items[0]?.total ?? 0
  return items.map((i) => ({ ...i, share: max > 0 ? i.total / max : 0 }))
}

export function mileageNote(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? "1 mileage-based reminder isn't included." : `${count} mileage-based reminders aren't included.`
}
