// How often the notification check runs. Pure so the rules can be tested
// without a database or the environment.

export const DEFAULT_INTERVAL_MINUTES = 360 // 6 hours
/** Below this the setting is refused; 0 still means "off". */
export const MIN_INTERVAL_MINUTES = 5
/** Below this the page warns about how often people are reminded. */
export const LOW_INTERVAL_MINUTES = 15
const DAY_MINUTES = 24 * 60

export type IntervalSource = "settings" | "env" | "default"

/** A valid interval: 0 (off) or a whole number of minutes from the minimum up. */
export function isValidInterval(minutes: number) {
  return Number.isInteger(minutes) && (minutes === 0 || minutes >= MIN_INTERVAL_MINUTES)
}

/**
 * The interval in effect. A value saved in Settings wins, then the
 * NOTIFY_INTERVAL_MINUTES environment variable, then the default. Anything
 * invalid falls through to the next source.
 */
export function effectiveInterval(
  saved: number | null | undefined,
  env: string | undefined,
): { minutes: number; source: IntervalSource } {
  if (saved !== null && saved !== undefined && isValidInterval(saved)) return { minutes: saved, source: "settings" }
  if (env !== undefined && env.trim() !== "") {
    const n = Number(env)
    if (Number.isFinite(n) && n >= 0) return { minutes: n, source: "env" }
  }
  return { minutes: DEFAULT_INTERVAL_MINUTES, source: "default" }
}

/** "6 hours", "90 minutes", "every day". Used in warnings. */
export function describeInterval(minutes: number) {
  if (minutes === 0) return "never"
  if (minutes % DAY_MINUTES === 0) return minutes === DAY_MINUTES ? "1 day" : `${minutes / DAY_MINUTES} days`
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`
  return minutes === 1 ? "1 minute" : `${minutes} minutes`
}

/** Warning for the interval field, or null when the value is fine. */
export function intervalWarning(minutes: number): string | null {
  if (minutes === 0 || minutes >= LOW_INTERVAL_MINUTES) return null
  return `Checking every ${describeInterval(minutes)} is very often. Anyone set to "Every check until dismissed" will be reminded that often, by the bell, by email and by push.`
}

/** How many checks run in a day, rounded; null when checks are off. */
export function checksPerDay(minutes: number) {
  return minutes === 0 ? null : Math.max(1, Math.round(DAY_MINUTES / minutes))
}

/**
 * Warning for "Every check until dismissed". That mode raises a read item again
 * on every check, so the interval decides how loud it is. Null only when
 * checks are off or run less than once a day.
 */
export function untilDismissedWarning(minutes: number): string | null {
  if (minutes === 0 || minutes > DAY_MINUTES) return null
  const per = checksPerDay(minutes)!
  return `You will likely be spammed. Checks run every ${describeInterval(minutes)}, so each item you've read comes back up to ${per} ${per === 1 ? "time" : "times"} a day until you dismiss it, in the bell, by email and by push.`
}
