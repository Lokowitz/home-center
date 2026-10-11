// The Intake nudge: one notification per person when files have sat unfiled in
// Intake for more than a week. Pure so the rules can be tested without a
// database; ./intake-nudge-server.ts reads and writes.
//
// The nudge's cycleKey holds the createdAt of the newest item it covered. While
// one is open it is kept up to date; once dismissed, nothing new is raised until
// an item newer than that marker crosses the week.

export const INTAKE_NUDGE_AGE_DAYS = 7

/** Notification.relatedEntityType of the nudge; it has no relatedEntityId. */
export const INTAKE_NUDGE_ENTITY = "Intake"

/** An Intake item with at least one file. */
export type IntakeNudgeItem = { createdAt: Date; suggestedAssetType: string | null }

/** One of this person's earlier Intake nudges, open or dismissed. */
export type PriorNudge = { id: string; title: string; message: string; cycleKey: string | null; dismissedAt: Date | null }

export type IntakeNudgeDecision =
  | { action: "create"; title: string; message: string; cycleKey: string }
  | { action: "update"; id: string; title: string; message: string; cycleKey: string }
  | { action: "resolve"; id: string }
  | { action: "none" }

const NONE: IntakeNudgeDecision = { action: "none" }

/** Strictly more than a week old, matching "Added more than a week ago". */
export function intakeNudgeCutoff(now: Date): Date {
  return new Date(now.getTime() - INTAKE_NUDGE_AGE_DAYS * 86_400_000)
}

export function decideIntakeNudge({ items, now, prior, health }: {
  items: IntakeNudgeItem[]
  now: Date
  prior: PriorNudge[]
  /** With Health off, items suggested for a person don't count. */
  health: boolean
}): IntakeNudgeDecision {
  const cutoff = intakeNudgeCutoff(now).getTime()
  const old = items.filter((i) => i.createdAt.getTime() < cutoff && (health || i.suggestedAssetType !== "PERSON"))
  const open = prior.find((p) => p.dismissedAt === null)

  if (old.length === 0) return open ? { action: "resolve", id: open.id } : NONE

  const newest = old.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).createdAt
  const cycleKey = newest.toISOString()
  const n = old.length
  const title = `${n} ${n === 1 ? "item" : "items"} waiting in Intake`
  const message = `Added more than a week ago. File, keep or discard ${n === 1 ? "it" : "them"}.`

  if (open) {
    if (open.title === title && open.message === message && open.cycleKey === cycleKey) return NONE
    return { action: "update", id: open.id, title, message, cycleKey }
  }

  // ISO strings of the same format sort as their dates do.
  const covered = prior.reduce<string | null>((max, p) => (p.cycleKey && (!max || p.cycleKey > max) ? p.cycleKey : max), null)
  if (covered && cycleKey <= covered) return NONE
  return { action: "create", title, message, cycleKey }
}
