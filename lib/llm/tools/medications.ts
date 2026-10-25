import { z } from "zod/v4"
import { prisma } from "@/lib/prisma"
import { loadAssetIndex } from "@/lib/assets-server"
import { resolveAssetId } from "../asset-ids"
import { toDay } from "../serialize"
import { describeMedications, NOTES_BUDGET, withoutNotes, type MedRow } from "../medication-history"
import type { ToolContext } from "../query"
import { scopedNames, withScope } from "../property-scope"
import { personChildScopeWhere, type PropertyScope } from "@/lib/property-filter"
import { defineTool } from "./registry"

// A person's medications as the Medications tab's timeline sees them. The rows
// underneath are one per dose period, which read to a model as a jumble of
// duplicates when listed raw; this is the shape that answers "what is she on",
// "tell me about her fluoxetine" and "when did the dose change".

function loadRows(personId: string | undefined, scope: PropertyScope | null): Promise<MedRow[]> {
  return prisma.medication.findMany({
    where: withScope(personId ? { personId } : {}, personChildScopeWhere(scope)),
    include: {
      person: { select: { id: true, name: true } },
      prescriber: { select: { name: true } },
      condition: { select: { name: true } },
    },
  })
}

export const medicationHistoryTool = defineTool({
  name: "medication_history",
  description:
    "A person's medications, one entry per drug with every dose period in date order (dosage, from/to, how the dose changed, notes). " +
    "Use it for 'what is she taking', 'tell me about her fluoxetine', 'when did the Qelbree dose change', 'what has he tried for ADHD'. " +
    "Filter to one drug with medication; current: true for only what is taken now.",
  schema: z.object({
    person: z.string().optional().describe("The person's name as the user said it, or their id. Omit for everyone."),
    medication: z.string().optional().describe("Only drugs whose name contains this, e.g. 'fluoxetine'. Omit for all."),
    current: z.boolean().optional().describe("true: only medications currently being taken."),
  }),
  label: (a) => (a.medication ? `Reading the ${a.medication} history…` : "Reading medications…"),
  async run(a, ctx: ToolContext) {
    const personId = a.person ? resolveAssetId(scopedNames((await loadAssetIndex()).names, ctx.scope), a.person, ["PERSON"]) : undefined
    const rows = await loadRows(personId, ctx.scope ?? null)
    const { people, all } = describeMedications(rows, ctx.now, { medication: a.medication, current: a.current })
    if (people.length) {
      const reply = { asOf: toDay(ctx.now), people }
      if (JSON.stringify(reply).length <= NOTES_BUDGET) return reply
      return { ...withoutNotes(reply), note: "Period notes were left out to fit. Ask about one medication (medication argument) to see its notes." }
    }
    // An empty answer reads as "never took it"; say what is on file instead.
    const known = all.map((p) => `${p.person.name}: ${p.knownMedications.join(", ") || "none"}`).join("; ")
    return {
      asOf: toDay(ctx.now),
      people: [],
      note: rows.length
        ? `No ${a.current ? "current " : ""}medication matched${a.medication ? ` "${a.medication}"` : ""}. On file — ${known}.`
        : "No medications are recorded.",
    }
  },
})
