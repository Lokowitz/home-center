import { z } from "zod/v4"
import { prisma } from "@/lib/prisma"
import { observationSchema } from "@/lib/health-schemas"
import { changedFields, valuesToForm, type DeleteCard, type EditCard, type EntryRef, type ObservationValues } from "@/lib/observation-cards"
import { ESTIMATED_TAG, matchExistingType, parseSeverity, resolveDraftDate, type Severity } from "@/lib/observation-draft"
import { healthOn, ToolInputError, type ToolContext } from "../query"
import { toDay } from "../serialize"
import { defineTool } from "./registry"
import { numeric } from "./observation-draft"
import { assetInScope } from "@/lib/property-filter"

// Proposals only: the card's Apply / Delete button is the one write, and the
// server action refuses if the entry changed after the card was made.

const CLEARABLE = ["time", "durationMinutes", "notes", "tags"] as const

const editSchema = z.object({
  observationId: z.string().min(1).describe("The entry's id, from observation_log (or the entry id in an [observation draft …, saved as entry …] line)."),
  date: z.string().optional().describe('New day: "today", "yesterday" or a weekday exactly as the user said it, or YYYY-MM-DD. Do not convert it yourself.'),
  time: z.string().optional().describe("New time, HH:MM 24-hour."),
  type: z.string().max(60).optional().describe("New label, reusing one of the person's types when it fits."),
  severity: z.union([z.number(), z.string()]).optional().describe("New severity the user stated: 1-5 or mild / moderate / severe."),
  durationMinutes: z.preprocess(numeric, z.number().int().min(0)).optional().describe("New duration in minutes."),
  notes: z.string().optional().describe("Replacement notes, in the user's words."),
  tags: z.array(z.string()).optional().describe("Replacement tags."),
  clear: z.array(z.enum(CLEARABLE)).optional().describe("Fields to empty: time, durationMinutes, notes, tags."),
  proposalId: z.string().optional().describe("To change a proposal already shown, its id (chg-…) from the conversation, with the full set of changes again."),
})
export type EditArgs = z.infer<typeof editSchema>

const deleteSchema = z.object({
  observationId: z.string().min(1).describe("The entry's id, from observation_log."),
  proposalId: z.string().optional(),
})
export type DeleteArgs = z.infer<typeof deleteSchema>

export type ChangeDeps = {
  loadEntry(id: string): Promise<EntryRef | null>
  knownTypes(personId: string): Promise<string[]>
  today: string
  newId(): string
}

const UNKNOWN = (id: string) => ({ error: `No observation has id "${id}". Use observation_log to find the entry and its id.` })

export async function buildEdit(a: EditArgs, deps: ChangeDeps): Promise<{ card: EditCard } | { reply: unknown }> {
  const target = await deps.loadEntry(a.observationId)
  if (!target) return { reply: UNKNOWN(a.observationId) }
  const after: ObservationValues = { ...target.before, tags: [...target.before.tags] }

  if (a.date !== undefined) {
    const day = resolveDraftDate(a.date, deps.today)
    if ("error" in day) return { reply: { error: day.error } }
    after.date = day.date
  }
  if (a.time !== undefined) after.time = a.time.trim() || null
  if (a.type !== undefined) after.type = matchExistingType(a.type, await deps.knownTypes(target.personId))
  if (a.severity !== undefined) {
    const s = parseSeverity(a.severity)
    if (!s) return { reply: { error: `"${a.severity}" isn't a severity. Use 1-5 or mild / moderate / severe.` } }
    after.severity = s as Severity
  }
  if (a.durationMinutes !== undefined) after.durationMinutes = a.durationMinutes
  if (a.notes !== undefined) after.notes = a.notes.trim() || null
  if (a.tags !== undefined) after.tags = a.tags.map((t) => t.trim()).filter(Boolean)
  for (const f of a.clear ?? []) {
    if (f === "tags") after.tags = []
    else after[f] = null
  }
  // A severity the user changed is theirs, not an estimate.
  if (after.severity !== target.before.severity) after.tags = after.tags.filter((t) => t.toLowerCase() !== ESTIMATED_TAG)

  if (!changedFields(target.before, after).length) return { reply: { error: "Nothing would change: those are already the entry's values." } }
  const check = observationSchema.safeParse(valuesToForm(after))
  if (!check.success) return { reply: { error: "That change wouldn't save. Fix these and call again.", issues: check.error.flatten().fieldErrors } }
  return { card: { kind: "edit", id: proposalId(a.proposalId, deps), target, after, state: "draft" } }
}

export async function buildDelete(a: DeleteArgs, deps: ChangeDeps): Promise<{ card: DeleteCard } | { reply: unknown }> {
  const target = await deps.loadEntry(a.observationId)
  if (!target) return { reply: UNKNOWN(a.observationId) }
  return { card: { kind: "delete", id: proposalId(a.proposalId, deps), target, state: "draft" } }
}

// chg-… as minted here, optionally with the -2, -3 suffix thread storage gives a reused id.
const PROPOSAL_ID = /^chg-[a-z0-9]+(?:-\d+)?$/
const proposalId = (given: string | undefined, deps: ChangeDeps) => {
  const id = given?.trim()
  return id && PROPOSAL_ID.test(id) ? id : deps.newId()
}

const newId = () => `chg-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`

async function loadEntry(id: string): Promise<EntryRef | null> {
  const r = await prisma.observation.findUnique({
    where: { id },
    select: {
      id: true, updatedAt: true, date: true, time: true, type: true, severity: true, durationMinutes: true, notes: true,
      tags: true, conditionId: true, personId: true, person: { select: { name: true } }, _count: { select: { attachments: true } },
    },
  })
  if (!r) return null
  return {
    observationId: r.id,
    updatedAt: r.updatedAt.toISOString(),
    personId: r.personId,
    personName: r.person.name,
    attachments: r._count.attachments,
    before: {
      date: toDay(r.date), time: r.time, type: r.type, severity: (parseSeverity(r.severity) ?? null) as Severity | null,
      durationMinutes: r.durationMinutes, notes: r.notes,
      tags: (r.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean), conditionId: r.conditionId,
    },
  }
}

const depsFor = (ctx: ToolContext): ChangeDeps => ({
  // A person the property filter hides has no entries to change.
  loadEntry: async (id) => {
    const entry = await loadEntry(id)
    return entry && assetInScope(ctx.scope ?? null, "PERSON", entry.personId) ? entry : null
  },
  knownTypes: async (personId) =>
    (await prisma.observation.findMany({ where: { personId }, select: { type: true }, distinct: ["type"], take: 100 })).map((o) => o.type),
  today: ctx.today ?? toDay(ctx.now),
  newId,
})

const requireHealth = (ctx: ToolContext, name: string) => {
  if (!healthOn(ctx)) throw new ToolInputError(`${name} isn't available: Health is turned off in Settings.`)
}

const SHOWN = (what: string) =>
  `Shown to the user as a card. It is NOT ${what}: nothing changes until they press the button. The card already shows the entry and the change, so do not repeat them. In one short sentence ask them to confirm on the card or tell you what to adjust; add only what the card can't show, such as why you picked this entry when several matched.`

export const proposeEditTool = defineTool({
  name: "propose_observation_edit",
  description:
    "Proposes changing one existing Observation entry the user asked to change (fix a date, severity, type, notes…). " +
    "Find the entry and its id with observation_log first; if several match, ask the user which. One call per entry. " +
    "Send only the fields to change. You cannot apply it; the user does, from the card.",
  schema: editSchema,
  label: () => "Preparing the change…",
  async run(a, ctx) {
    requireHealth(ctx, "propose_observation_edit")
    const out = await buildEdit(a, depsFor(ctx))
    if ("reply" in out) return out.reply
    ctx.emit?.({ type: "change", card: out.card })
    return { proposal: out.card, note: SHOWN("applied") }
  },
})

export const proposeDeleteTool = defineTool({
  name: "propose_observation_delete",
  description:
    "Proposes deleting one existing Observation entry the user asked to remove (a duplicate, a mistake). " +
    "Find it with observation_log first; one call per entry. You cannot delete it; the user confirms on the card.",
  schema: deleteSchema,
  label: () => "Preparing the deletion…",
  async run(a, ctx) {
    requireHealth(ctx, "propose_observation_delete")
    const out = await buildDelete(a, depsFor(ctx))
    if ("reply" in out) return out.reply
    ctx.emit?.({ type: "change", card: out.card })
    return { proposal: out.card, note: SHOWN("deleted") }
  },
})
