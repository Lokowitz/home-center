// Expired / expiring / active for a warranty, by calendar day. An expiry date is
// stored as UTC midnight of its day and runs to the end of that day, so a
// warranty ending today still counts as expiring, not expired. "Today" is the
// calendar day on the server's clock, as UTC midnight to match the stored dates.

const DAY = 86_400_000
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

export const warrantyToday = (now: Date) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))

export type WarrantyState = { state: "expired" | "expiring" | "active"; daysLeft: number | null }

export function warrantyState(expiration: Date | null, now: Date, withinDays: number): WarrantyState {
  if (!expiration) return { state: "active", daysLeft: null }
  const daysLeft = Math.round((utcDay(expiration) - warrantyToday(now).getTime()) / DAY)
  if (daysLeft < 0) return { state: "expired", daysLeft }
  return { state: daysLeft <= withinDays ? "expiring" : "active", daysLeft }
}
