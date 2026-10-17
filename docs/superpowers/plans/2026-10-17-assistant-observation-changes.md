# Assistant Observation Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the assistant propose edits and deletes of existing observations as chat cards the user confirms (Apply; two-click Delete), alongside the existing add drafts.

**Architecture:** New pure card model (`lib/observation-cards.ts`) unions the existing `DraftCard` with `EditCard` / `DeleteCard`. Two health-only tools load the target entry server-side, build a proposal and emit a new `change` agent event. Thread storage, merge/update, summaries and Health-off stripping are generalised to `ChatCard` by `cardId`. Two new session-checked server actions apply atomically, guarded by the entry's `updatedAt`. A new card component renders edit diffs and the two-click delete.

**Tech Stack:** Next.js 16, React 19, TypeScript, zod (`zod` for forms, `zod/v4` for tools), Prisma 7, Vitest, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-17-assistant-observation-changes-design.md` (builds on `docs/superpowers/specs/2026-10-17-assistant-observation-drafts-design.md`)

## Global Constraints

- Repo `C:\Git\home-center`. Tests `npx vitest run <path>`; typecheck `npx tsc --noEmit -p .`; lint `npx eslint <files>`.
- **Do not commit, stage or stash.** Work stays uncommitted.
- The model never writes. Only the user's click on a card calls a server action.
- Delete needs two clicks: **Delete** → **Confirm delete**; resets after 5 seconds or on blur.
- One card per entry. Edit cards show only changed fields, old → new.
- Changing severity on an edit makes it stated and removes the `severity-estimated` tag; untouched severity stays exactly as it was.
- Apply/Delete refuse when the entry's `updatedAt` differs from the card's: error text exactly `This entry changed after the card was made. Ask the assistant again.`
- Health off → the new tools are absent and refuse if called; their summary lines are stripped from history.
- Cards stored before this change (no `kind`) load and behave as add drafts.

## Review Focus

1. **Entry with no severity** (existing rows may have `severity: null`) — edit card must show "—", not crash, and an edit that doesn't touch severity must keep it null. Test: Task 1 `changedFields`/`valuesToForm`; Task 3 `buildEdit` with null severity.
2. **Entry edited on the Observations tab after the card was made** — Apply must refuse with the stale message, not overwrite. Test: Task 2 actions.
3. **Model reuses a proposal id for another entry** — must become a new card, not overwrite. Test: Task 4 `mergeCards` subject change.
4. **Proposal for an entry the user can't reach / unknown id / Health off** — readable reply, nothing emitted. Test: Task 3.
5. **Double-click on Delete** — first click only arms; a fast second click confirms (that's intended); a third click while deleting does nothing. Test: Task 5 code path (`busy` guard) + browser check.

---

## File Structure

- Create `lib/observation-cards.ts` + `lib/observation-cards.test.ts` — card union, ids, diff, form values, summaries, validation.
- Modify `lib/observation-draft.ts` + test — saved add card summary names its entry id.
- Modify `lib/actions/health.ts`; create `lib/actions/health-changes.test.ts`.
- Create `lib/llm/tools/observation-change.ts` + test; modify `lib/llm/types.ts`, `lib/llm/tools/index.ts`, `lib/llm/prompt.ts`, `lib/llm/model-test/checks.ts`, `lib/llm/model-test/cases-observations.ts`, `lib/llm/health-off.test.ts`.
- Modify `lib/llm/thread-storage.ts` + test, `lib/llm/strip-drafts.ts` + test.
- Modify `components/chat/use-chat-thread.ts`, `components/chat/chat-thread.tsx`; create `components/chat/observation-change-card.tsx`.

---

### Task 1: Card model

**Files:** Create `lib/observation-cards.ts`, `lib/observation-cards.test.ts`. Modify `lib/observation-draft.ts` (`STATE_WORDS` / `draftSummaryLine`), `lib/observation-draft.test.ts`.

**Interfaces:**
- Consumes: `DraftCard`, `DraftState`, `Severity`, `isDraftCard`, `draftSummaryLine`, `parseSeverity`, `severityLabel` (lib/observation-draft.ts); `normalizeTags` (lib/health-schemas.ts).
- Produces:
  - `type ObservationValues = { date: string; time: string | null; type: string; severity: Severity | null; durationMinutes: number | null; notes: string | null; tags: string[]; conditionId: string | null }`
  - `type EntryRef = { observationId: string; updatedAt: string; personId: string; personName: string; attachments: number; before: ObservationValues }`
  - `type EditCard = { kind: "edit"; id: string; target: EntryRef; after: ObservationValues; state: DraftState; error?: string }`
  - `type DeleteCard = { kind: "delete"; id: string; target: EntryRef; state: DraftState; error?: string }`
  - `type ChangeCard = EditCard | DeleteCard`; `type ChatCard = DraftCard | ChangeCard`
  - `type CardPatch = { state?: DraftState; savedId?: string; error?: string }`
  - `isChangeCard(c: ChatCard): c is ChangeCard`, `cardId(c: ChatCard): string`, `cardSubject(c: ChatCard): string`
  - `FIELD_LABELS: Record<ChangeField, string>`, `type ChangeField = Exclude<keyof ObservationValues, "conditionId">`
  - `changedFields(before: ObservationValues, after: ObservationValues): ChangeField[]`
  - `formatValue(field: ChangeField, v: ObservationValues): string`
  - `valuesToForm(v: ObservationValues): Record<string, string>`
  - `changeSummaryLine(c: ChangeCard): string`, `cardSummaryLine(c: ChatCard): string`, `isChatCard(v: unknown): v is ChatCard`

- [ ] **Step 1: Failing tests** — `lib/observation-cards.test.ts`

```ts
import { describe, expect, it } from "vitest"
import {
  cardId, cardSubject, cardSummaryLine, changedFields, formatValue, isChatCard, valuesToForm,
  type DeleteCard, type EditCard, type ObservationValues,
} from "./observation-cards"
import type { DraftCard } from "./observation-draft"

const before: ObservationValues = {
  date: "2026-10-14", time: null, type: "Meltdown", severity: 3, durationMinutes: 15,
  notes: "At bedtime", tags: ["bedtime", "severity-estimated"], conditionId: "c1",
}
const target = { observationId: "o1", updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Indy", attachments: 0, before }
const edit: EditCard = { kind: "edit", id: "chg-aaaaaa", target, after: { ...before, severity: 4, tags: ["bedtime"] }, state: "draft" }
const del: DeleteCard = { kind: "delete", id: "chg-bbbbbb", target, state: "draft" }
const add: DraftCard = {
  draft: { draftId: "obs-cccccc", personId: "p1", personName: "Indy", date: "2026-10-17", time: null, type: "Aggression", severity: 4, severitySource: "estimated", durationMinutes: null, notes: null, tags: [] },
  state: "draft",
}

describe("ids and subjects", () => {
  it("names every kind of card", () => {
    expect([add, edit, del].map(cardId)).toEqual(["obs-cccccc", "chg-aaaaaa", "chg-bbbbbb"])
    expect([add, edit, del].map(cardSubject)).toEqual(["person:p1", "entry:o1:edit", "entry:o1:delete"])
  })
})

describe("changedFields", () => {
  it("lists only what differs, tags by value", () => {
    expect(changedFields(before, edit.after)).toEqual(["severity", "tags"])
    expect(changedFields(before, { ...before, tags: ["bedtime", "severity-estimated"] })).toEqual([])
  })
  it("handles an entry without severity", () => {
    const none = { ...before, severity: null }
    expect(changedFields(none, none)).toEqual([])
    expect(formatValue("severity", none)).toBe("—")
  })
})

describe("formatValue", () => {
  it("reads like the card", () => {
    expect(formatValue("severity", before)).toBe("3 / 5 · Moderate")
    expect(formatValue("durationMinutes", before)).toBe("15 min")
    expect(formatValue("time", before)).toBe("—")
    expect(formatValue("tags", before)).toBe("bedtime, severity-estimated")
  })
})

describe("valuesToForm", () => {
  it("gives the strings the observation schema takes, keeping the condition", () => {
    expect(valuesToForm({ ...before, severity: null, durationMinutes: null, notes: null })).toEqual({
      date: "2026-10-14", time: "", type: "Meltdown", severity: "", durationMinutes: "", conditionId: "c1",
      tags: "bedtime, severity-estimated", notes: "",
    })
  })
})

describe("summary lines", () => {
  it("describes an edit by entry and change", () => {
    expect(cardSummaryLine(edit)).toBe(
      "[observation edit chg-aaaaaa, not applied: Indy · entry o1 (2026-10-14 Meltdown) · severity 3 → 4 · tags bedtime, severity-estimated → bedtime]"
    )
    expect(cardSummaryLine({ ...edit, state: "saved" })).toContain("applied, can't be changed here")
  })
  it("describes a delete", () => {
    expect(cardSummaryLine(del)).toBe("[observation delete chg-bbbbbb, not deleted: Indy · entry o1 (2026-10-14 Meltdown)]")
    expect(cardSummaryLine({ ...del, state: "saved" })).toContain("deleted")
  })
  it("still describes adds", () => {
    expect(cardSummaryLine(add)).toMatch(/^\[observation draft obs-cccccc, not saved:/)
  })
})

describe("isChatCard", () => {
  it("accepts every kind, including stored adds without a kind", () => {
    expect([add, edit, del].every(isChatCard)).toBe(true)
  })
  it("rejects malformed change cards", () => {
    expect(isChatCard({ ...edit, target: { ...target, updatedAt: 5 } })).toBe(false)
    expect(isChatCard({ ...edit, after: { ...edit.after, severity: "4" } })).toBe(false)
    expect(isChatCard({ ...del, kind: "rename" })).toBe(false)
    expect(isChatCard(null)).toBe(false)
  })
})
```

Add to `lib/observation-draft.test.ts` `describe("draftSummaryLine")`:

```ts
  it("names the saved entry so a change can target it", () => {
    expect(draftSummaryLine({ draft, state: "saved", savedId: "o42" })).toContain("saved as entry o42; to change it, call propose_observation_edit with observationId o42")
  })
```
and change the existing saved-state assertion (`"saved, can't be changed here"`) to expect `"saved as entry o1"` (its card uses `savedId: "o1"`).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/observation-cards.test.ts lib/observation-draft.test.ts` (module missing; saved wording).

- [ ] **Step 3: Implement**

In `lib/observation-draft.ts`, replace the saved branch of the state words so `draftSummaryLine` uses the card's `savedId`:

```ts
const stateWords = (c: DraftCard) =>
  c.state === "draft" ? "not saved"
  : c.state === "discarded" ? "discarded"
  : c.savedId ? `saved as entry ${c.savedId}; to change it, call propose_observation_edit with observationId ${c.savedId}` : "saved"
```
use `stateWords(card)` in place of `STATE_WORDS[state]` (destructure `card` rather than `{ draft: d, state }`), and delete `STATE_WORDS`.

Create `lib/observation-cards.ts`:

```ts
// Every card the assistant can put in the chat: an add (a draft from
// observation-draft), an edit of an existing entry, or a delete. Pure and
// client-safe. Nothing here writes: the card's button calls a server action.

import { normalizeTags } from "./health-schemas"
import {
  draftSummaryLine, isDraftCard, parseSeverity, severityLabel,
  type DraftCard, type DraftState, type Severity,
} from "./observation-draft"

export type ObservationValues = {
  date: string
  time: string | null
  type: string
  severity: Severity | null
  durationMinutes: number | null
  notes: string | null
  tags: string[]
  conditionId: string | null
}

/// The entry a change targets, as it was when the card was made.
export type EntryRef = {
  observationId: string
  /// ISO; Apply/Delete refuse if the entry has changed since.
  updatedAt: string
  personId: string
  personName: string
  attachments: number
  before: ObservationValues
}

export type EditCard = { kind: "edit"; id: string; target: EntryRef; after: ObservationValues; state: DraftState; error?: string }
export type DeleteCard = { kind: "delete"; id: string; target: EntryRef; state: DraftState; error?: string }
export type ChangeCard = EditCard | DeleteCard
export type ChatCard = DraftCard | ChangeCard
export type CardPatch = { state?: DraftState; savedId?: string; error?: string }

export const isChangeCard = (c: ChatCard): c is ChangeCard => "kind" in c && (c.kind === "edit" || c.kind === "delete")
export const cardId = (c: ChatCard) => (isChangeCard(c) ? c.id : c.draft.draftId)
/// What a card is about. A revision must keep it; a reused id with another subject is a new card.
export const cardSubject = (c: ChatCard) => (isChangeCard(c) ? `entry:${c.target.observationId}:${c.kind}` : `person:${c.draft.personId}`)

export type ChangeField = Exclude<keyof ObservationValues, "conditionId">
const FIELDS: ChangeField[] = ["date", "time", "type", "severity", "durationMinutes", "notes", "tags"]
export const FIELD_LABELS: Record<ChangeField, string> = {
  date: "Date", time: "Time", type: "What", severity: "Severity", durationMinutes: "Duration", notes: "Notes", tags: "Tags",
}
const SUMMARY_NAMES: Record<ChangeField, string> = {
  date: "date", time: "time", type: "type", severity: "severity", durationMinutes: "duration", notes: "notes", tags: "tags",
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function changedFields(before: ObservationValues, after: ObservationValues): ChangeField[] {
  return FIELDS.filter((f) => !same(before[f], after[f]))
}

export function formatValue(field: ChangeField, v: ObservationValues): string {
  switch (field) {
    case "severity": return v.severity == null ? "—" : severityLabel(v.severity)
    case "durationMinutes": return v.durationMinutes == null ? "—" : `${v.durationMinutes} min`
    case "tags": return v.tags.length ? v.tags.join(", ") : "—"
    default: return v[field] == null || v[field] === "" ? "—" : String(v[field])
  }
}

/// The FormValues the observation schema and server actions take.
export function valuesToForm(v: ObservationValues): Record<string, string> {
  return {
    date: v.date,
    time: v.time ?? "",
    type: v.type,
    severity: v.severity == null ? "" : String(v.severity),
    durationMinutes: v.durationMinutes == null ? "" : String(v.durationMinutes),
    conditionId: v.conditionId ?? "",
    tags: normalizeTags(v.tags.join(",")) ?? "",
    notes: v.notes ?? "",
  }
}

const NOTE_LIMIT = 200
const short = (s: string, whole: boolean) => (whole || s.length <= NOTE_LIMIT ? s : `${s.slice(0, NOTE_LIMIT)}…`)
const plain = (field: ChangeField, v: ObservationValues, whole: boolean) => {
  if (field === "severity") return v.severity == null ? "none" : String(v.severity)
  if (field === "notes") return v.notes ? `"${short(v.notes, whole)}"` : "none"
  if (field === "tags") return v.tags.length ? v.tags.join(", ") : "none"
  return v[field] == null ? "none" : String(v[field])
}

/// The line the model sees in history: id, state, and the entry it targets.
export function changeSummaryLine(c: ChangeCard): string {
  const open = c.state === "draft"
  const done = c.kind === "edit" ? "applied, can't be changed here" : "deleted"
  const word = open ? (c.kind === "edit" ? "not applied" : "not deleted") : c.state === "discarded" ? "discarded" : done
  const t = c.target
  const head = `${t.personName} · entry ${t.observationId} (${t.before.date} ${t.before.type})`
  if (c.kind === "delete") return `[observation delete ${c.id}, ${word}: ${head}]`
  const diffs = changedFields(t.before, c.after).map((f) => `${SUMMARY_NAMES[f]} ${plain(f, t.before, open)} → ${plain(f, c.after, open)}`)
  return `[observation edit ${c.id}, ${word}: ${[head, ...diffs].join(" · ")}]`
}

export const cardSummaryLine = (c: ChatCard) => (isChangeCard(c) ? changeSummaryLine(c) : draftSummaryLine(c))

const str = (v: unknown) => typeof v === "string"
const strOrNull = (v: unknown) => v === null || typeof v === "string"
const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v))

function isValues(v: unknown): v is ObservationValues {
  const x = v as ObservationValues | null
  return !!x && str(x.date) && strOrNull(x.time) && str(x.type)
    && (x.severity === null || (typeof x.severity === "number" && parseSeverity(x.severity) !== null))
    && numOrNull(x.durationMinutes) && strOrNull(x.notes) && Array.isArray(x.tags) && x.tags.every(str) && strOrNull(x.conditionId)
}

function isTarget(v: unknown): v is EntryRef {
  const t = v as EntryRef | null
  return !!t && str(t.observationId) && str(t.updatedAt) && str(t.personId) && str(t.personName)
    && typeof t.attachments === "number" && isValues(t.before)
}

export function isChatCard(v: unknown): v is ChatCard {
  if (isDraftCard(v)) return true
  const c = v as ChangeCard | null
  if (!c || typeof c !== "object" || !str(c.id) || !["draft", "saved", "discarded"].includes(c.state) || !isTarget(c.target)) return false
  if (c.kind === "delete") return true
  return c.kind === "edit" && isValues((c as EditCard).after)
}
```

If `isDraftCard` accepts objects that also have `kind: "edit"` (it checks `draft`, so it won't), no change is needed.

- [ ] **Step 4: Run, expect PASS** — same command; then `npx eslint lib/observation-cards.ts lib/observation-cards.test.ts lib/observation-draft.ts`.
- [ ] **Step 5: Checkpoint** — no commit.

---

### Task 2: Server actions

**Files:** Modify `lib/actions/health.ts` (append after `deleteObservation`). Create `lib/actions/health-changes.test.ts`.

**Interfaces:**
- Consumes: existing `requireSession`, `conditionError`, `revalidatePerson`, the not-found result used by `updateObservation` (find its name in the file, e.g. `NOT_FOUND`), `observationSchema`, `removeUploadDir`.
- Produces:
  - `STALE_ENTRY = "This entry changed after the card was made. Ask the assistant again."` (exported)
  - `applyObservationEdit(id: string, values: FormValues, expectedUpdatedAt: string): Promise<ActionResult>`
  - `deleteObservationIfUnchanged(id: string, expectedUpdatedAt: string): Promise<ActionResult>`

- [ ] **Step 1: Failing tests** — `lib/actions/health-changes.test.ts`

Read the top of `lib/actions/health.ts` for what `requireSession` imports (`@/auth`'s `auth`, `next/navigation` `redirect`) and mock accordingly:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = {
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  conditionFind: vi.fn(),
}
vi.mock("@/lib/prisma", () => ({
  prisma: {
    observation: { findUnique: db.findUnique, updateMany: db.updateMany, deleteMany: db.deleteMany },
    healthCondition: { findFirst: db.conditionFind, findUnique: db.conditionFind },
  },
}))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect") } }))
const removeUploadDir = vi.fn(async () => undefined)
vi.mock("@/lib/upload-fs", () => ({ removeUploadDir }))

import { applyObservationEdit, deleteObservationIfUnchanged, STALE_ENTRY } from "./health"

const at = "2026-10-15T10:00:00.000Z"
const values = { date: "2026-10-14", time: "", type: "Meltdown", severity: "4", durationMinutes: "", conditionId: "", tags: "", notes: "" }

beforeEach(() => {
  vi.clearAllMocks()
  db.findUnique.mockResolvedValue({ personId: "p1" })
})

describe("applyObservationEdit", () => {
  it("updates only if the entry is unchanged", async () => {
    db.updateMany.mockResolvedValue({ count: 1 })
    expect(await applyObservationEdit("o1", values, at)).toEqual({ success: true, id: "o1" })
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "o1", updatedAt: new Date(at) } }))
  })
  it("refuses a stale card", async () => {
    db.updateMany.mockResolvedValue({ count: 0 })
    expect(await applyObservationEdit("o1", values, at)).toEqual({ error: STALE_ENTRY })
  })
  it("returns field errors and never writes on bad values", async () => {
    const r = await applyObservationEdit("o1", { ...values, severity: "9" }, at)
    expect(typeof r.error).toBe("object")
    expect(db.updateMany).not.toHaveBeenCalled()
  })
  it("reports a missing entry", async () => {
    db.findUnique.mockResolvedValue(null)
    expect((await applyObservationEdit("o1", values, at)).error).toBeTruthy()
    expect(db.updateMany).not.toHaveBeenCalled()
  })
})

describe("deleteObservationIfUnchanged", () => {
  it("deletes an unchanged entry and its uploads", async () => {
    db.deleteMany.mockResolvedValue({ count: 1 })
    expect(await deleteObservationIfUnchanged("o1", at)).toEqual({ success: true })
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: "o1", updatedAt: new Date(at) } })
    expect(removeUploadDir).toHaveBeenCalledWith("observation", "o1")
  })
  it("refuses a stale card and keeps uploads", async () => {
    db.deleteMany.mockResolvedValue({ count: 0 })
    expect(await deleteObservationIfUnchanged("o1", at)).toEqual({ error: STALE_ENTRY })
    expect(removeUploadDir).not.toHaveBeenCalled()
  })
})
```

If `requireSession` uses a different auth module than `@/auth`, or `conditionError` queries a different model/method, adjust the mocks to match (keep the assertions). If the not-found result is a string error, `toBeTruthy()` still holds.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/actions/health-changes.test.ts` (exports missing).

- [ ] **Step 3: Implement** — append to `lib/actions/health.ts`:

```ts
export const STALE_ENTRY = "This entry changed after the card was made. Ask the assistant again."

/** An edit from an assistant card: applied only if the entry is as the card saw it. */
export async function applyObservationEdit(id: string, values: FormValues, expectedUpdatedAt: string): Promise<ActionResult> {
  await requireSession()
  const parsed = observationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.observation.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND
  const bad = await conditionError(existing.personId, parsed.data.conditionId)
  if (bad) return bad
  // Atomic: the filter on updatedAt is the check.
  const { count } = await prisma.observation.updateMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) }, data: parsed.data })
  if (count === 0) return { error: STALE_ENTRY }
  revalidatePerson(existing.personId)
  return { success: true, id }
}

/** A delete from an assistant card, refused if the entry changed since the card was made. */
export async function deleteObservationIfUnchanged(id: string, expectedUpdatedAt: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.observation.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND
  const { count } = await prisma.observation.deleteMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) } })
  if (count === 0) return { error: STALE_ENTRY }
  await removeUploadDir("observation", id)
  revalidatePerson(existing.personId)
  return { success: true }
}
```

Use the file's actual not-found constant name. A `"use server"` file may only export async functions — if exporting the `STALE_ENTRY` string breaks Next's rule, move it to `lib/observation-cards.ts` (export there, import in both) and update the test import.

- [ ] **Step 4: Run, expect PASS**; tsc; eslint.
- [ ] **Step 5: Checkpoint** — no commit.

---

### Task 3: Proposal tools

**Files:** Create `lib/llm/tools/observation-change.ts`, `lib/llm/tools/observation-change.test.ts`. Modify `lib/llm/types.ts` (AgentEvent), `lib/llm/tools/index.ts`, `lib/llm/prompt.ts`, `lib/llm/model-test/checks.ts`, `lib/llm/model-test/cases-observations.ts`, `lib/llm/health-off.test.ts`.

**Interfaces:**
- Consumes: Task 1 types/helpers; `parseSeverity`, `resolveDraftDate`, `matchExistingType`, `ESTIMATED_TAG` (lib/observation-draft.ts); `observationSchema`; `healthOn`, `ToolInputError`, `ToolContext` (`today?`, `emit?`); `toDay`; `defineTool`; prisma. Copy the numeric-string preprocess helper used in `lib/llm/tools/observation-draft.ts` (import it if exported; otherwise export it from there and import — don't duplicate).
- Produces:
  - `AgentEvent` adds `{ type: "change"; card: ChangeCard }`
  - `type EditArgs`, `type DeleteArgs`
  - `type ChangeDeps = { loadEntry(id: string): Promise<EntryRef | null>; knownTypes(personId: string): Promise<string[]>; today: string; newId(): string }`
  - `buildEdit(a: EditArgs, deps: ChangeDeps): Promise<{ card: EditCard } | { reply: unknown }>`
  - `buildDelete(a: DeleteArgs, deps: ChangeDeps): Promise<{ card: DeleteCard } | { reply: unknown }>`
  - `proposeEditTool` (`"propose_observation_edit"`), `proposeDeleteTool` (`"propose_observation_delete"`)

- [ ] **Step 1: Failing tests** — `lib/llm/tools/observation-change.test.ts`

```ts
import { describe, expect, it, vi } from "vitest"

const findUnique = vi.fn()
vi.mock("@/lib/prisma", () => ({ prisma: { observation: { findUnique, findMany: async () => [{ type: "Meltdown" }] } } }))
import { buildDelete, buildEdit, proposeDeleteTool, proposeEditTool, type ChangeDeps } from "./observation-change"
import type { EntryRef } from "@/lib/observation-cards"

const entry: EntryRef = {
  observationId: "o1", updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Indy", attachments: 1,
  before: { date: "2026-10-14", time: null, type: "Meltdown", severity: 3, durationMinutes: 15, notes: "At bedtime", tags: ["severity-estimated"], conditionId: null },
}
const deps = (over: Partial<ChangeDeps> = {}): ChangeDeps => ({
  loadEntry: async (id) => (id === "o1" ? entry : null),
  knownTypes: async () => ["Meltdown", "Aggression"],
  today: "2026-10-17",
  newId: () => "chg-new001",
  ...over,
})

describe("buildEdit", () => {
  it("changes only what was asked; a stated severity drops the estimate tag", async () => {
    const out = await buildEdit({ observationId: "o1", severity: "4" }, deps())
    expect(out).toMatchObject({ card: { kind: "edit", id: "chg-new001", target: entry, state: "draft", after: { ...entry.before, severity: 4, tags: [] } } })
  })
  it("keeps untouched severity, including none", async () => {
    const none = { ...entry, before: { ...entry.before, severity: null, tags: [] } }
    const out = await buildEdit({ observationId: "o1", date: "yesterday" }, deps({ loadEntry: async () => none }))
    expect(out).toMatchObject({ card: { after: { date: "2026-10-16", severity: null } } })
  })
  it("clears fields on request and reuses the person's type spelling", async () => {
    const out = await buildEdit({ observationId: "o1", type: "aggression", clear: ["durationMinutes", "notes"] }, deps())
    expect(out).toMatchObject({ card: { after: { type: "Aggression", durationMinutes: null, notes: null } } })
  })
  it("keeps the proposal id on a revision", async () => {
    expect(await buildEdit({ observationId: "o1", severity: 2, proposalId: "chg-abc123" }, deps())).toMatchObject({ card: { id: "chg-abc123" } })
  })
  it("refuses unknown entries, no-op edits, bad values and future dates", async () => {
    expect(await buildEdit({ observationId: "nope", severity: 4 }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/observation_log/) } })
    expect(await buildEdit({ observationId: "o1", severity: 3 }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/Nothing would change/) } })
    expect(await buildEdit({ observationId: "o1", time: "25:99" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/wouldn't save/) } })
    expect(await buildEdit({ observationId: "o1", date: "2026-10-20" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/future/) } })
    expect(await buildEdit({ observationId: "o1", severity: "kinda" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/isn't a severity/) } })
  })
})

describe("buildDelete", () => {
  it("proposes deleting a known entry", async () => {
    expect(await buildDelete({ observationId: "o1" }, deps())).toEqual({ card: { kind: "delete", id: "chg-new001", target: entry, state: "draft" } })
    expect(await buildDelete({ observationId: "nope" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/observation_log/) } })
  })
})

describe("tools", () => {
  const row = {
    id: "o1", updatedAt: new Date("2026-10-15T10:00:00.000Z"), date: new Date("2026-10-14T00:00:00Z"), time: null, type: "Meltdown",
    severity: 3, durationMinutes: 15, notes: "At bedtime", tags: "severity-estimated", conditionId: null,
    personId: "p1", person: { name: "Indy" }, _count: { attachments: 1 },
  }
  const ctx = (emit = vi.fn()) => ({ userId: "u", now: new Date("2026-10-17T12:00:00Z"), today: "2026-10-17", emit })

  it("emit one change event and say nothing was changed", async () => {
    findUnique.mockResolvedValue(row)
    const emit = vi.fn()
    const out = await proposeEditTool.execute({ observationId: "o1", severity: 4 }, ctx(emit))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toMatchObject({ type: "change", card: { kind: "edit", target: { observationId: "o1", attachments: 1 } } })
    expect(out).toMatch(/NOT applied/)
    const emit2 = vi.fn()
    await proposeDeleteTool.execute({ observationId: "o1" }, ctx(emit2))
    expect(emit2.mock.calls[0][0]).toMatchObject({ type: "change", card: { kind: "delete" } })
  })
  it("emit nothing for an unknown entry", async () => {
    findUnique.mockResolvedValue(null)
    const emit = vi.fn()
    expect(await proposeDeleteTool.execute({ observationId: "x" }, ctx(emit))).toMatch(/observation_log/)
    expect(emit).not.toHaveBeenCalled()
  })
  it("refuse with Health off", async () => {
    const off = { userId: "u", now: new Date(), health: false }
    expect(await proposeEditTool.execute({ observationId: "o1", severity: 4 }, off)).toMatch(/Health is turned off/)
    expect(await proposeDeleteTool.execute({ observationId: "o1" }, off)).toMatch(/Health is turned off/)
  })
})
```

Add to `lib/llm/health-off.test.ts` ("keeps health out of the prompt and the tools"):

```ts
    expect(names).not.toContain("propose_observation_edit")
    expect(names).not.toContain("propose_observation_delete")
    expect(buildSystemPrompt({ now: off.now, health: false })).not.toContain("propose_observation")
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/llm/tools/observation-change.test.ts lib/llm/health-off.test.ts`.

- [ ] **Step 3: Implement**

`lib/llm/types.ts`: `import type { ChangeCard } from "../observation-cards"` and add `| { type: "change"; card: ChangeCard }` after the `draft` member (doc comment: "A proposed edit or delete of an existing observation; applied only from its card.").

`lib/llm/tools/observation-change.ts`:

```ts
import { z } from "zod/v4"
import { prisma } from "@/lib/prisma"
import { observationSchema } from "@/lib/health-schemas"
import { changedFields, valuesToForm, type DeleteCard, type EditCard, type EntryRef, type ObservationValues } from "@/lib/observation-cards"
import { ESTIMATED_TAG, matchExistingType, parseSeverity, resolveDraftDate, type Severity } from "@/lib/observation-draft"
import { healthOn, ToolInputError, type ToolContext } from "../query"
import { toDay } from "../serialize"
import { defineTool } from "./registry"
import { numeric } from "./observation-draft"

// Proposals only: the card's Apply / Delete button is the one write, and the
// server action refuses if the entry changed after the card was made.

const CLEARABLE = ["time", "durationMinutes", "notes", "tags"] as const

const editSchema = z.object({
  observationId: z.string().min(1).describe("The entry's id, from observation_log (or the entry id in an [observation draft …, saved as entry …] line)."),
  date: z.string().optional().describe('New day: "today", "yesterday" or a weekday exactly as the user said it, or YYYY-MM-DD. Do not convert it yourself.'),
  time: z.string().optional().describe("New time, HH:MM 24-hour."),
  type: z.string().max(60).optional().describe("New label, reusing one of the person's types when it fits."),
  severity: z.union([z.number(), z.string()]).optional().describe("New severity the user stated: 1-5 or mild / moderate / severe."),
  durationMinutes: numeric(z.number().int().min(0)).optional().describe("New duration in minutes."),
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
  return { card: { kind: "edit", id: a.proposalId?.trim() || deps.newId(), target, after, state: "draft" } }
}

export async function buildDelete(a: DeleteArgs, deps: ChangeDeps): Promise<{ card: DeleteCard } | { reply: unknown }> {
  const target = await deps.loadEntry(a.observationId)
  if (!target) return { reply: UNKNOWN(a.observationId) }
  return { card: { kind: "delete", id: a.proposalId?.trim() || deps.newId(), target, state: "draft" } }
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
  loadEntry,
  knownTypes: async (personId) =>
    (await prisma.observation.findMany({ where: { personId }, select: { type: true }, distinct: ["type"], take: 100 })).map((o) => o.type),
  today: ctx.today ?? toDay(ctx.now),
  newId,
})

const requireHealth = (ctx: ToolContext, name: string) => {
  if (!healthOn(ctx)) throw new ToolInputError(`${name} isn't available: Health is turned off in Settings.`)
}

const SHOWN = (what: string) =>
  `Shown to the user as a card. It is NOT ${what}: nothing changes until they press the button. Say in one sentence what the card would change and ask them to confirm or tell you what to adjust.`

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
```

`numeric`: if `lib/llm/tools/observation-draft.ts` has the numeric-string preprocess under another name or unexported, export it as `numeric(schema)` (a function wrapping a zod number schema) and use it in both files.

Register: `lib/llm/tools/index.ts` — import both; add to `HEALTH_TOOLS` and append to `SHORTCUT_TOOLS` after `draftObservationTool`.

Prompt (`lib/llm/prompt.ts`), after the draft_observation rule, health-gated:

```ts
    ...(health ? ["- To change or delete an existing observation the user asks about, find it with observation_log (or use the entry id in a saved [observation draft …] line), then call propose_observation_edit or propose_observation_delete — one call per entry, only the fields to change. You can't apply or delete; the user confirms on the card. To adjust a proposal, call again with its proposalId (chg-…)."] : []),
```

`lib/llm/model-test/checks.ts` TOOL_WORDS: `propose_observation_edit: "an observation change",` and `propose_observation_delete: "an observation deletion",`.

`lib/llm/model-test/cases-observations.ts` (tool-choice):

```ts
  {
    id: "choice-observations-edit",
    stage: "tool-choice",
    category: "Observations",
    title: "Looks up the entry before proposing a change",
    question: "Change Jamie's meltdown on May 12 to a severity 4.",
    check: either(calledTool("observation_log"), calledTool("propose_observation_edit")),
  },
  {
    id: "choice-observations-delete",
    stage: "tool-choice",
    category: "Observations",
    title: "Looks up the entry before proposing a deletion",
    question: "Delete the duplicate meltdown entry for Jamie on May 12.",
    check: either(calledTool("observation_log"), calledTool("propose_observation_delete")),
  },
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run lib/llm/`; tsc; eslint touched files.
- [ ] **Step 5: Checkpoint** — no commit.

---

### Task 4: Thread storage over every card kind

**Files:** Modify `lib/llm/thread-storage.ts`, `lib/llm/thread-storage.test.ts`, `lib/llm/strip-drafts.ts`, its test (`lib/llm/strip-drafts.test.ts`).

**Interfaces:**
- Consumes: `ChatCard`, `CardPatch`, `cardId`, `cardSubject`, `cardSummaryLine`, `isChatCard` (Task 1).
- Produces: `ThreadMessage.cards?: ChatCard[]`; `mergeCards(thread, answer, cards: ChatCard[])`; `updateCard(thread, id: string, patch: CardPatch)`; `stripDraftLines` strips draft/edit/delete lines.

- [ ] **Step 1: Failing tests** — append to `lib/llm/thread-storage.test.ts` (reuse its `card`, `d`, `q` helpers):

```ts
import type { EditCard } from "../observation-cards"

const editCard = (id: string, observationId = "o1", over: Partial<EditCard> = {}): EditCard => ({
  kind: "edit", id, state: "draft",
  target: { observationId, updatedAt: "2026-10-15T10:00:00.000Z", personId: "p1", personName: "Indy", attachments: 0,
    before: { date: "2026-10-14", time: null, type: "Meltdown", severity: 3, durationMinutes: null, notes: null, tags: [], conditionId: null } },
  after: { date: "2026-10-14", time: null, type: "Meltdown", severity: 4, durationMinutes: null, notes: null, tags: [], conditionId: null },
  ...over,
})

describe("change cards", () => {
  const q2 = { role: "user" as const, content: "make the meltdown a 4" }
  it("store, revise in place and update by id", () => {
    const t1 = mergeCards([q2], { role: "assistant", content: "Proposed." }, [editCard("chg-aaaaaa")])
    expect(t1[1].cards).toEqual([editCard("chg-aaaaaa")])
    const revised = editCard("chg-aaaaaa", "o1", { after: { ...editCard("x").after, severity: 5 } })
    const t2 = mergeCards([...t1, { role: "user", content: "no, 5" }], { role: "assistant", content: "Changed." }, [revised])
    expect(t2[1].cards).toEqual([revised])
    expect(updateCard(t2, "chg-aaaaaa", { state: "saved" })[1].cards![0]).toMatchObject({ state: "saved" })
  })
  it("treat a reused id for another entry as a new card", () => {
    const t1 = mergeCards([q2], { role: "assistant", content: "Proposed." }, [editCard("chg-aaaaaa", "o1")])
    const t2 = mergeCards([...t1, { role: "user", content: "and the other" }], { role: "assistant", content: "Also." }, [editCard("chg-aaaaaa", "o2")])
    expect(t2[1].cards![0].kind).toBe("edit")
    expect((t2[3].cards![0] as EditCard).target.observationId).toBe("o2")
  })
  it("round-trip mixed cards and send their summaries", () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    saveThread(s, "u", [q2, { role: "assistant", content: "Two cards.", cards: [card("obs-aaaaaa"), editCard("chg-bbbbbb")] }])
    const loaded = loadThread(s, "u")
    expect(loaded[1].cards).toHaveLength(2)
    expect(requestMessages(loaded)[1].content).toContain("[observation edit chg-bbbbbb, not applied:")
  })
})
```

Append to `lib/llm/strip-drafts.test.ts`:

```ts
  it("also strips edit and delete lines", () => {
    const out = stripDraftLines([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Ok.\n\n[observation edit chg-a, not applied: Indy · entry o1 (2026-10-14 Meltdown) · severity 3 → 4]\n[observation delete chg-b, not deleted: Indy · entry o2 (2026-10-13 Rude)]" },
      { role: "user", content: "thanks" },
    ])
    expect(out[1].content).toBe("Ok.")
  })
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run lib/llm/thread-storage.test.ts lib/llm/strip-drafts.test.ts`.

- [ ] **Step 3: Implement**

`lib/llm/thread-storage.ts`:
- Import `cardId, cardSubject, cardSummaryLine, isChatCard, type CardPatch, type ChatCard` from `../observation-cards`; drop the now-unused draft imports.
- `ThreadMessage = HistoryMessage & { discarded?: string; cards?: ChatCard[] }`.
- `loadThread`: filter with `isChatCard`.
- `mergeCards(thread, answer, cards: ChatCard[])`: same algorithm, keyed by `cardId(c)` and `cardSubject(c)` instead of `c.draft.draftId` / `c.draft.personId`; an in-place revision replaces the whole card: `(x) => (cardId(x) === id && x.state === "draft" ? c : x)` (c arrives in state "draft" with no error).
- `updateCard(thread, id: string, patch: CardPatch)`: key by `cardId`.
- `requestMessages`: summaries via `cardSummaryLine`.

`lib/llm/strip-drafts.ts`: `const DRAFT_LINE = /^\[observation (?:draft|edit|delete) [^\n]*\]$/gm` and update the comment.

- [ ] **Step 4: Run, expect PASS**, then `npx vitest run lib/llm/`, tsc (the hook will now fail typecheck where it builds `DraftCard`s — that's Task 5; if tsc errors only in `components/chat/*`, note it and continue), eslint touched files.
- [ ] **Step 5: Checkpoint** — no commit.

---

### Task 5: Hook and change card UI

**Files:** Modify `components/chat/use-chat-thread.ts`, `components/chat/chat-thread.tsx`. Create `components/chat/observation-change-card.tsx`.

**Interfaces:**
- Consumes: `ChatCard`, `ChangeCard`, `CardPatch`, `cardId`, `isChangeCard`, `changedFields`, `formatValue`, `FIELD_LABELS`, `valuesToForm` (Task 1); `applyObservationEdit`, `deleteObservationIfUnchanged` (Task 2); `mergeCards`, `updateCard` (Task 4); existing `ObservationDraftCard`.
- Produces: hook `liveCards: ChatCard[]`, `updateCard(id: string, patch: CardPatch)`.

- [ ] **Step 1: Hook** (`use-chat-thread.ts`)
- Types: `DraftCard` → `ChatCard` for `liveCards`, `turn.cards`; `updateCard(id: string, patch: CardPatch)`.
- Upsert helper inside `run`: `const upsert = (c: ChatCard) => { turn.cards = [...turn.cards.filter((x) => cardId(x) !== cardId(c)), c]; setLiveCards(turn.cards) }`.
- `draft` branch: `upsert({ draft: event.draft, state: "draft" })`. New branch: `else if (event.type === "change") upsert(event.card)`.
- Everything else (messagesRef, mergeCards sites, guards) unchanged.

- [ ] **Step 2: Change card** — `components/chat/observation-change-card.tsx`

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Loader2, PencilLine, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { applyObservationEdit, deleteObservationIfUnchanged } from "@/lib/actions/health"
import type { ActionResult } from "@/lib/form-types"
import { changedFields, FIELD_LABELS, formatValue, valuesToForm, type CardPatch, type ChangeCard } from "@/lib/observation-cards"
import { cn } from "@/lib/utils"

const CONFIRM_MS = 5000

function errorText(r: ActionResult): string {
  if (typeof r.error === "string") return r.error
  const all = Object.values(r.error ?? {}).flat().filter(Boolean)
  return all.length ? all.join(" ") : "Couldn't do that. Try again."
}

/// A proposed edit or delete of an existing observation. Nothing changes until
/// Apply, or Delete then Confirm delete; the server refuses if the entry changed
/// after the card was made.
export function ObservationChangeCard({
  card, onChange, live = false,
}: { card: ChangeCard; onChange?: (patch: CardPatch) => void; live?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t = card.target
  const href = `/assets/people/${t.personId}?tab=observations&open=${t.observationId}`
  const isEdit = card.kind === "edit"
  const fields = isEdit ? changedFields(t.before, card.after) : []
  const disabled = busy || live || !onChange

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function disarm() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setConfirming(false)
  }

  async function run(action: () => Promise<ActionResult>) {
    if (busy || !onChange) return
    setBusy(true)
    try {
      const r = await action()
      if (r.success) {
        onChange({ state: "saved", error: undefined })
        router.refresh()
      } else onChange({ error: errorText(r) })
    } catch {
      onChange({ error: "Couldn't reach the server. Try again." })
    } finally {
      setBusy(false)
      disarm()
    }
  }

  function onDelete() {
    if (disabled) return
    if (!confirming) {
      setConfirming(true)
      timer.current = setTimeout(() => setConfirming(false), CONFIRM_MS)
      return
    }
    void run(() => deleteObservationIfUnchanged(t.observationId, t.updatedAt))
  }

  if (card.state === "discarded") {
    return <p className="text-xs text-muted-foreground">Discarded {isEdit ? "change" : "deletion"} · {t.personName} · {t.before.type} · {t.before.date}</p>
  }

  const done = card.state === "saved"
  const title = isEdit ? (done ? "Change applied" : "Proposed change") : done ? "Observation deleted" : "Delete this observation?"

  return (
    <div className={cn("max-w-md rounded-lg border bg-card text-sm shadow-sm", !isEdit && !done && "border-destructive/40")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {isEdit ? <PencilLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        <span className="font-medium">{title}</span>
        {!done && <span className="ml-auto text-xs text-muted-foreground">Nothing changed yet</span>}
      </div>
      <div className="px-3 pt-2 text-xs text-muted-foreground">{t.personName} · {t.before.date} · {t.before.type}</div>
      {isEdit ? (
        <dl className="space-y-1 px-3 py-2 text-xs">
          {fields.map((f) => (
            <div key={f} className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted-foreground">{FIELD_LABELS[f]}</dt>
              <dd className="min-w-0 flex-1">
                <span className="text-muted-foreground line-through">{formatValue(f, t.before)}</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changes to </span>
                <span className="font-medium">{formatValue(f, card.after)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="space-y-1 px-3 py-2 text-xs">
          {(["severity", "time", "durationMinutes", "notes", "tags"] as const).map((f) => (
            <div key={f} className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted-foreground">{FIELD_LABELS[f]}</dt>
              <dd className="min-w-0 flex-1 whitespace-pre-wrap">{formatValue(f, t.before)}</dd>
            </div>
          ))}
          {t.attachments > 0 && <p className="pt-1 text-destructive">Its {t.attachments} attachment{t.attachments === 1 ? "" : "s"} will be deleted too.</p>}
          {!done && <p className="pt-1 text-muted-foreground">This can&apos;t be undone.</p>}
        </dl>
      )}
      {card.error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{card.error}</p>}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {done ? (
          <>
            <Check className="h-4 w-4 text-[var(--chart-4)]" aria-hidden="true" />
            <span className="text-xs">{isEdit ? "Applied" : "Deleted"}</span>
            {isEdit && <Link className="ml-auto text-xs font-medium underline-offset-2 hover:underline" href={href}>Open entry</Link>}
          </>
        ) : (
          <>
            {isEdit ? (
              <Button size="sm" onClick={() => run(() => applyObservationEdit(t.observationId, valuesToForm(card.after), t.updatedAt))} disabled={disabled}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                Apply
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={onDelete} onBlur={disarm} disabled={disabled} aria-live="polite">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {confirming ? "Confirm delete" : "Delete"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { disarm(); onChange?.({ state: "discarded", error: undefined }) }} disabled={disabled}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
            <span className="ml-auto text-[11px] text-muted-foreground">{live ? "Finishing…" : "Or tell me what to change"}</span>
          </>
        )}
      </div>
    </div>
  )
}
```

Confirm `Button` supports `variant="destructive"` (check `components/ui/button.tsx`); if not, use the closest destructive styling the repo uses.

- [ ] **Step 3: Render** (`chat-thread.tsx`) — import `ObservationChangeCard` and `cardId, isChangeCard` from `@/lib/observation-cards`; add a small local renderer:

```tsx
function CardView({ card, onChange, live }: { card: ChatCard; onChange?: (p: CardPatch) => void; live?: boolean }) {
  return isChangeCard(card)
    ? <ObservationChangeCard card={card} onChange={onChange} live={live} />
    : <ObservationDraftCard card={card} onChange={onChange} live={live} />
}
```
and use it for persisted cards (`key={cardId(c)}`, `onChange={chat.busy ? undefined : (p) => chat.updateCard(cardId(c), p)}`) and live cards (`key={`live-${cardId(c)}`}`, `live`). If `ObservationDraftCard`'s `onChange` type is narrower than `CardPatch`, widen it to `CardPatch` (same fields).

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p .`, `npx eslint components/chat lib`, `npx vitest run`.

- [ ] **Step 5: Browser check (user)** — "Change Indy (timeline demo)'s most recent meltdown to a 5" → edit card severity old → new → Apply → "Applied · Open entry". "Delete that entry" → delete card → Delete shows "Confirm delete" → wait 5s, reverts → click twice → "Deleted". Edit the entry on the Observations tab, then Apply an older card → stale message.
- [ ] **Step 6: Checkpoint** — no commit.

---

### Task 6: Docs and final verification

**Files:** Modify `docs/product-discovery/prioritized-roadmap.md` (the "Assistant write tools" row) and `docs/product-discovery/feature-opportunities.md` (the "Assistant that writes records" row).

- [ ] **Step 1:** Change the wording added earlier so it covers adds, edits and deletes: "Observations (2026-10) follow the allowed shape: the assistant proposes adds, edits and deletes as chat cards and the user confirms each one. Direct writes stay out." (roadmap), and "Observations now work the propose-then-confirm way (cards in the chat for adds, edits and deletes; the user confirms each); see docs/superpowers/specs/2026-10-17-assistant-observation-changes-design.md." (opportunities). If the roadmap names a tool count, update it to match `chatTools(...)` with Health on.
- [ ] **Step 2:** `npx tsc --noEmit -p .`, `npx eslint .`, `npx vitest run` — report counts.
- [ ] **Step 3: Checkpoint** — no commit.
