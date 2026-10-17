import { z } from "zod/v4"
import { prisma } from "@/lib/prisma"
import { observationSchema } from "@/lib/health-schemas"
import {
  matchExistingType, parseSeverity, resolveDraftDate, toFormValues, type ObservationDraft, type Severity,
} from "@/lib/observation-draft"
import { healthOn, ToolInputError } from "../query"
import { toDay } from "../serialize"
import { defineTool } from "./registry"
import { findAsset } from "./shortcuts"

// The assistant's only way to help add a record: it drafts, the page shows the
// draft as a card, and the user's Save click writes it through the same server
// action as the form. Nothing here saves.

const RUBRIC =
  "1 brief or minor, redirected easily · 2 upset, took some effort to settle · 3 disruptive, hard to redirect, lasted a while · " +
  "4 physical aggression, destruction or unsafe behaviour · 5 injury, danger to self or others, or emergency help needed. " +
  "When unsure, pick the lower one."

// Models often send numbers as strings ("4"); accept those, keep "" and "abc" invalid.
export const numeric = (v: unknown) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v)

const schema = z.object({
  person: z.string().min(1).describe("Who it's about: the person's name as the user said it, or their id."),
  date: z.string().min(1).describe('The day it happened: YYYY-MM-DD, "today", "yesterday", or a weekday such as "monday". Pass "today", "yesterday" or a weekday exactly as the user said it; do not convert it to a date yourself.'),
  time: z.string().optional().describe("HH:MM, 24-hour — only if the user said when."),
  type: z.string().min(1).max(60).describe("A short label such as Meltdown, Aggression, Bad night. Reuse one of the person's existing types when it fits."),
  severity: z.union([z.number(), z.string()]).optional().describe("Only a severity the user stated: 1-5, or a word such as mild, moderate, severe."),
  severityEstimate: z.preprocess(numeric, z.number().int().min(1).max(5)).optional().describe(`Your estimate when the user gave no severity. ${RUBRIC}`),
  durationMinutes: z.preprocess(numeric, z.number().int().min(0)).optional().describe("How long it lasted, in minutes, if the user said."),
  notes: z.string().optional().describe("What happened, in the user's words, tidied. Keep their details; add nothing."),
  tags: z.array(z.string()).optional().describe("Short tags the user implied, e.g. school, bedtime."),
  draftId: z.string().optional().describe("To change a draft already shown, its id (obs-…) from the conversation, with every field sent again. Keep severityEstimate as severityEstimate unless the user gave a severity. Omit for a new entry."),
})
export type DraftArgs = z.infer<typeof schema>

export type DraftDeps = {
  findPerson(raw: string): Promise<{ person: { id: string; name: string } } | { reply: unknown }>
  knownTypes(personId: string): Promise<string[]>
  /** The viewer's YYYY-MM-DD. */
  today: string
  newId(): string
}

export async function buildDraft(a: DraftArgs, deps: DraftDeps): Promise<{ draft: ObservationDraft; knownTypes: string[] } | { reply: unknown }> {
  const found = await deps.findPerson(a.person)
  if ("reply" in found) return found

  const stated = a.severity === undefined ? null : parseSeverity(a.severity)
  let severity: Severity
  let severitySource: ObservationDraft["severitySource"]
  if (stated) {
    severity = stated
    severitySource = "stated"
  } else if (a.severity !== undefined && a.severityEstimate === undefined) {
    return { reply: { error: `"${a.severity}" isn't a severity. Use 1-5 or mild / moderate / severe, or give severityEstimate.` } }
  } else if (a.severityEstimate !== undefined) {
    severity = a.severityEstimate as Severity
    severitySource = "estimated"
  } else {
    return { reply: { error: `No severity. If the user gave none, estimate one and send it as severityEstimate: ${RUBRIC}` } }
  }

  const day = resolveDraftDate(a.date, deps.today)
  if ("error" in day) return { reply: { error: day.error } }

  const knownTypes = await deps.knownTypes(found.person.id)
  const draft: ObservationDraft = {
    draftId: draftIdFrom(a.draftId) ?? deps.newId(),
    personId: found.person.id,
    personName: found.person.name,
    date: day.date,
    time: a.time?.trim() || null,
    type: matchExistingType(a.type, knownTypes),
    severity,
    severitySource,
    durationMinutes: a.durationMinutes ?? null,
    notes: a.notes?.trim() || null,
    tags: (a.tags ?? []).map((t) => t.trim()).filter(Boolean),
  }
  // Fail now, not on Save: the same rules the form and the server action use.
  const check = observationSchema.safeParse(toFormValues(draft))
  if (!check.success) return { reply: { error: "That entry wouldn't save. Fix these and call again.", issues: check.error.flatten().fieldErrors } }
  return { draft, knownTypes }
}

// obs-… as minted here, optionally with thread storage's -2, -3 suffix. Anything else is
// ignored so a model-made id can't break the one-line summary format.
const DRAFT_ID = /^obs-[a-z0-9]+(?:-\d+)?$/
const draftIdFrom = (given: string | undefined) => {
  const id = given?.trim()
  return id && DRAFT_ID.test(id) ? id : undefined
}

const newId = () => `obs-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`

const SHOWN =
  "Shown to the user as a card with a Save button; the card already lists every value. It is NOT saved. " +
  "Do not repeat the card's values. In one or two short sentences say only what the card can't: which values you guessed " +
  "and why (especially an estimated severity), then ask them to press Save or tell you what to change."

export const draftObservationTool = defineTool({
  name: "draft_observation",
  description:
    "Drafts one Observation entry (a meltdown, symptom, incident, bad night…) from what the user described, for them to review and save. " +
    "Call it whenever the user tells you something that happened to a person. One call per incident. You cannot save; the user saves from the card. " +
    "To change a draft, call again with its draftId and every field; keep severityEstimate as severityEstimate unless the user gave a severity.",
  schema,
  label: (a) => `Drafting an observation for ${a.person}…`,
  async run(a, ctx) {
    if (!healthOn(ctx)) throw new ToolInputError("draft_observation isn't available: Health is turned off in Settings.")
    const out = await buildDraft(a, {
      findPerson: async (raw) => {
        const f = await findAsset(raw, ctx, ["PERSON"])
        if ("reply" in f) return f
        if (f.asset.type !== "PERSON") return { reply: { error: `"${raw}" is a ${f.asset.type.toLowerCase()}, not a person. Ask the user who this is about.` } }
        return { person: { id: f.asset.id, name: f.asset.name } }
      },
      knownTypes: async (personId) =>
        (await prisma.observation.findMany({ where: { personId }, select: { type: true }, distinct: ["type"], take: 100 })).map((o) => o.type),
      today: ctx.today ?? toDay(ctx.now),
      newId,
    })
    if ("reply" in out) return out.reply
    ctx.emit?.({ type: "draft", draft: out.draft })
    return { draft: out.draft, personTypes: out.knownTypes, note: SHOWN }
  },
})
