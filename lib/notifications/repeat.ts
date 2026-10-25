// How often a due item is raised again, chosen per person under
// Settings → Notifications. Pure so the rules can be tested without a database.
//
// A "cycle" is one due date of one item. Logging the service, moving a refill
// date or editing a warranty changes the cycle key, so the next due date is
// treated as new whatever happened to the last one.

export type NotificationRepeat = "ONCE" | "REACHED_AND_DUE" | "UNTIL_DISMISSED"

/** REACHED: inside the warning window. DUE: on or after the due date. */
export type Stage = "REACHED" | "DUE"

export const REPEAT_OPTIONS: { value: NotificationRepeat; label: string; hint: string }[] = [
  { value: "REACHED_AND_DUE", label: "When it's coming up, and on the due date", hint: "Two reminders per item: a heads-up, then one on the day." },
  { value: "ONCE", label: "Only once", hint: "A single reminder per item." },
  { value: "UNTIL_DISMISSED", label: "Every check until dismissed", hint: "Comes back on every check after you read it, until you dismiss it. Very noisy: use only if checks run less than once a day." },
]

/** An existing notification for the same person, type and item. */
export type Prior = {
  id: string
  cycleKey: string | null
  stage: string | null
  isRead: boolean
  dismissedAt: Date | null
  createdAt: Date
}

export type Decision = { action: "create" } | { action: "resurface"; id: string } | { action: "skip" }

const CREATE: Decision = { action: "create" }
const SKIP: Decision = { action: "skip" }

export function decide(mode: NotificationRepeat, stage: Stage, cycleKey: string, prior: Prior[]): Decision {
  // Rows written before cycles were tracked can't be matched to a due date.
  // Keep the old rule for them: an unread one means "already told".
  if (prior.some((p) => p.cycleKey === null && !p.isRead)) return SKIP

  const current = prior.filter((p) => p.cycleKey === cycleKey)
  if (current.length === 0) return CREATE

  switch (mode) {
    case "ONCE":
      return SKIP
    case "REACHED_AND_DUE":
      return current.some((p) => p.stage === stage) ? SKIP : CREATE
    case "UNTIL_DISMISSED": {
      if (current.some((p) => p.dismissedAt)) return SKIP
      const latest = current.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
      return latest.isRead ? { action: "resurface", id: latest.id } : SKIP
    }
  }
}

/** Joins the fields that define one due date, so any change starts a new cycle. */
export function cycleKeyOf(...parts: (Date | number | string | null | undefined)[]): string {
  return parts.map((p) => (p instanceof Date ? p.toISOString() : p ?? "")).join("|")
}

/**
 * The cycle of a maintenance reminder's current due date. A snooze that has run
 * out starts a new cycle, so it's raised again whatever the repeat setting;
 * unsnoozed rows keep the original two-part key.
 */
export function maintenanceCycleKey(s: { nextDueDate: Date | null; nextDueMileage: number | null; snoozedUntil: Date | null }): string {
  return s.snoozedUntil
    ? cycleKeyOf(s.nextDueDate, s.nextDueMileage, s.snoozedUntil)
    : cycleKeyOf(s.nextDueDate, s.nextDueMileage)
}
