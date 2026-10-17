import { assetHref } from "@/lib/assets"
import { buildTimeline, daysBetween, type TimelineMedication, type TimelineSegment } from "@/lib/medication-timeline"
import { compact, toDay } from "./serialize"

// Shapes a person's medication rows the way the Medications tab's timeline
// sees them: one entry per drug, its dose periods in date order, each saying
// how the dose changed. Pure, so it is tested without a database; the
// medication_history tool loads the rows and hands them here.

const DAY = 86_400_000

export type MedRow = TimelineMedication & {
  person: { id: string; name: string }
  prescriber: { name: string } | null
  condition: { name: string } | null
}

function changeText(s: TimelineSegment): string {
  switch (s.change) {
    case "start": return "started"
    case "restart": return "restarted after a gap"
    case "up": return `increased from ${s.previousDosage}`
    case "down": return `decreased from ${s.previousDosage}`
    default:
      // Doses that can't be compared (one not recorded, or written differently).
      if (s.previousDosage && s.previousDosage !== s.med.dosage) return `changed from ${s.previousDosage}`
      if (!s.previousDosage && s.med.dosage) return `changed to ${s.med.dosage} (previous dose not recorded)`
      return "continued"
  }
}

const medsHref = (personId: string) => `${assetHref("PERSON", personId)}?tab=medications`

/// The tool reply's size budget is 12,000 characters; past this the period
/// notes are dropped (and the reply says so) rather than the reply being cut.
export const NOTES_BUDGET = 10_000

/// The same reply without period notes, for when the full one is too long.
export function withoutNotes<T extends { people: { medications: Record<string, unknown>[] }[] }>(reply: T): T {
  return {
    ...reply,
    people: reply.people.map((p) => ({
      ...p,
      medications: p.medications.map((m) => ({
        ...m,
        periods: (m.periods as Record<string, unknown>[]).map((period) => {
          const rest = { ...period }
          delete rest.notes
          return rest
        }),
      })),
    })),
  }
}

export function describeMedications(rows: MedRow[], now: Date, opts: { medication?: string; current?: boolean }) {
  const wanted = opts.medication?.trim().toLowerCase()
  const byPerson = new Map<string, MedRow[]>()
  for (const r of rows) byPerson.set(r.person.id, [...(byPerson.get(r.person.id) ?? []), r])

  const people = [...byPerson.values()].map((list) => {
    const person = list[0].person
    const extra = new Map(list.map((r) => [r.id, r]))
    const lanes = buildTimeline(list, now)
      .filter((l) => !wanted || l.key.includes(wanted))
      .filter((l) => !opts.current || l.active)
    return {
      person: { id: person.id, name: person.name, href: medsHref(person.id) },
      medications: lanes.map((l) => {
        const lastEnd = l.active ? null : toDay(new Date(l.last - DAY))
        return compact({
          medication: l.name,
          status: l.active ? "currently taking" : "stopped",
          currentDosage: l.current?.med.dosage ?? null,
          firstStarted: toDay(new Date(l.first)),
          lastTaken: lastEnd,
          doseChanges: l.segments.filter((s) => s.change === "up" || s.change === "down").length,
          periods: l.segments.map((s) => {
            const row = extra.get(s.med.id)!
            return compact({
              id: s.med.id,
              dosage: s.med.dosage ?? "not recorded",
              frequency: s.med.frequency,
              from: toDay(new Date(s.start)),
              to: s.ongoing && !s.med.endDate ? "ongoing" : toDay(new Date(s.end - DAY)),
              days: daysBetween(s.start, s.end),
              change: changeText(s),
              prescriber: row.prescriber?.name,
              forCondition: row.condition?.name,
              notes: s.med.notes,
            })
          }),
        })
      }),
      // Without a start date a row can't be placed in time; list it rather than drop it.
      undated: list.filter((r) => !r.startDate && (!wanted || r.name.toLowerCase().includes(wanted)))
        .map((r) => compact({ id: r.id, medication: r.name, dosage: r.dosage, frequency: r.frequency, notes: r.notes })),
      knownMedications: [...new Set(list.map((r) => r.name.trim()))].sort(),
    }
  })

  const matched = people.filter((p) => p.medications.length || p.undated.length)
  return { people: matched, all: people }
}

