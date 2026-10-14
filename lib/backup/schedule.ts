// Engine file: pure. Server local time (TZ) throughout, like the digest hour.
export type ScheduleSettings = { schedule: "OFF" | "DAILY" | "WEEKLY"; time: string; weekday: number }

const DAY = 86_400_000

function hm(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [3, 0]
}

export function intervalMs(s: ScheduleSettings): number {
  return s.schedule === "WEEKLY" ? 7 * DAY : DAY
}

/** The most recent scheduled moment at or before now. */
export function lastSlot(s: ScheduleSettings, now: Date): Date | null {
  if (s.schedule === "OFF") return null
  const [h, m] = hm(s.time)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  if (s.schedule === "DAILY") {
    if (d > now) d.setDate(d.getDate() - 1)
    return d
  }
  let back = (d.getDay() - s.weekday + 7) % 7
  if (back === 0 && d > now) back = 7
  d.setDate(d.getDate() - back)
  return d
}

export function nextSlot(s: ScheduleSettings, now: Date): Date | null {
  const last = lastSlot(s, now)
  if (!last) return null
  const n = new Date(last)
  n.setDate(n.getDate() + (s.schedule === "WEEKLY" ? 7 : 1))
  return n
}

/** Due when nothing was attempted since the latest slot. A failure waits for the next slot. */
export function isDue(s: ScheduleSettings, lastAttemptAt: Date | null, now: Date): boolean {
  const slot = lastSlot(s, now)
  if (!slot) return false
  return !lastAttemptAt || lastAttemptAt < slot
}

/** Scheduled, and no backup within twice the interval (counted from when the schedule was turned on if none yet). */
export function isStale(s: ScheduleSettings, newestBackupAt: Date | null, enabledAt: Date, now: Date): boolean {
  if (s.schedule === "OFF") return false
  const since = newestBackupAt ?? enabledAt
  return now.getTime() - since.getTime() > 2 * intervalMs(s)
}
