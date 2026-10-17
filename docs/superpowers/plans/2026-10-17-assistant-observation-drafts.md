# Assistant Observation Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user describe an incident to the assistant and get an Observation draft card in the chat that they correct in plain language and save with a button.

**Architecture:** A new health-only tool `draft_observation` validates and normalises the model's arguments into an `ObservationDraft` and pushes it to the browser as a new `draft` agent event (tools get an optional `ctx.emit`). The browser stores cards on assistant messages in the sessionStorage thread, sends a one-line summary of each card back with history so the model can revise it by `draftId`, and saves through the existing `createObservation` server action. The model never writes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, zod (v3 for forms, `zod/v4` for tools), Prisma 7, Vitest, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-17-assistant-observation-drafts-design.md`

## Global Constraints

- Repo: `C:\Git\home-center`. Commands run from there. Tests: `npx vitest run <path>`; typecheck `npx tsc --noEmit -p .`; lint `npx eslint <files>`.
- **Do not commit.** The user reviews uncommitted work; the "Checkpoint" steps replace commits.
- The model never writes records. Only the user's Save click calls `createObservation`.
- Health off → `draft_observation` absent and refuses if called.
- Severity is always set: stated (number 1–5 or word) → `stated`; otherwise the model's `severityEstimate` → `estimated`.
- Estimated drafts save with the tag `severity-estimated`; stated drafts never carry it.
- One entry per card. Saved and discarded cards cannot be revised from chat.
- Dates are calendar days `YYYY-MM-DD`; "today" is the viewer's local day (sent by the browser), falling back to the server's UTC day.
- Copy uses plain words; no colour-only meaning (the *estimated* badge is text).

## Review Focus

1. **Evening "today" in a US timezone** — after 7–8 pm local the UTC day is tomorrow; "today" must be the viewer's day. Test: Task 1 `resolveDraftDate` with `today` from the client; Task 2 request-schema accepts `today`; Task 5 hook sends `localDay()`.
2. **The model revises a card that was already saved** — the saved card must not change. Test: Task 4 `mergeCards` ignores revisions to saved/discarded cards.
3. **A reply that is only a card, no text** — the turn must still be kept (the thread drops empty messages). Test: Task 4 `mergeCards` + Task 5 fallback text.
4. **A "reset" event after a draft** (model prefaced text, then called the tool, or a link recheck) — the card must survive; only text is reset. Test: Task 5 hook keeps `turn.cards` across `reset` (code path), Task 4 covers storage.
5. **Name that matches two people or a non-person** ("Indy" vs "Indy (timeline demo)", or a vehicle named like a person) — must ask, not guess. Test: Task 3 `buildDraft` ambiguous and non-person cases.

---

## File Structure

- Create `lib/observation-draft.ts` — pure draft types and helpers (client-safe): severity parsing, date words, type matching, form values, summary line, card validation, `localDay`.
- Create `lib/observation-draft.test.ts`.
- Modify `lib/llm/types.ts` — `draft` AgentEvent.
- Modify `lib/llm/query.ts` — `ToolContext.emit`, `ToolContext.today`.
- Modify `lib/llm/agent.ts` — pass `emit` into tool ctx.
- Modify `lib/llm/request-schema.ts`, `app/api/chat/route.ts` — optional `today`.
- Modify `lib/llm/agent.test.ts` — emit test.
- Create `lib/llm/tools/observation-draft.ts` — `buildDraft` + `draftObservationTool`.
- Create `lib/llm/tools/observation-draft.test.ts`.
- Modify `lib/llm/tools/index.ts`, `lib/llm/tools/shortcuts.ts` (export only if needed), `lib/llm/prompt.ts`, `lib/llm/model-test/checks.ts`, `lib/llm/model-test/cases-observations.ts`, `lib/llm/health-off.test.ts`.
- Modify `lib/llm/thread-storage.ts` + test — cards on messages, `mergeCards`, `updateCard`, summary lines in `requestMessages`.
- Modify `components/chat/use-chat-thread.ts` — handle `draft`, live cards, `updateCard`, send `today`.
- Create `components/chat/observation-draft-card.tsx`.
- Modify `components/chat/chat-thread.tsx` — render cards.
- Modify `docs/product-discovery/prioritized-roadmap.md`, `docs/product-discovery/feature-opportunities.md`.

---

### Task 1: Pure draft helpers

**Files:**
- Create: `lib/observation-draft.ts`
- Test: `lib/observation-draft.test.ts`

**Interfaces:**
- Consumes: `normalizeTags(raw)` from `lib/health-schemas.ts`; `RATING_WORDS` from `lib/day-ratings.ts`.
- Produces:
  - `type Severity = 1 | 2 | 3 | 4 | 5`
  - `type ObservationDraft = { draftId: string; personId: string; personName: string; date: string; time: string | null; type: string; severity: Severity; severitySource: "stated" | "estimated"; durationMinutes: number | null; notes: string | null; tags: string[] }`
  - `type DraftState = "draft" | "saved" | "discarded"`
  - `type DraftCard = { draft: ObservationDraft; state: DraftState; savedId?: string; error?: string }`
  - `ESTIMATED_TAG = "severity-estimated"`
  - `parseSeverity(input: unknown): Severity | null`
  - `resolveDraftDate(input: string, today: string): { date: string } | { error: string }`
  - `matchExistingType(type: string, known: string[]): string`
  - `toFormValues(d: ObservationDraft): Record<string, string>`
  - `draftSummaryLine(card: DraftCard): string`
  - `isDraftCard(v: unknown): v is DraftCard`
  - `severityLabel(s: Severity): string` → e.g. `"3 / 5 · Moderate"`
  - `localDay(d?: Date): string` (viewer's local calendar day)

- [ ] **Step 1: Write the failing tests**

```ts
// lib/observation-draft.test.ts
import { describe, expect, it } from "vitest"
import {
  draftSummaryLine, isDraftCard, localDay, matchExistingType, parseSeverity, resolveDraftDate, severityLabel, toFormValues,
  type DraftCard, type ObservationDraft,
} from "./observation-draft"

const draft: ObservationDraft = {
  draftId: "obs-abc123", personId: "p1", personName: "Indy", date: "2026-10-17", time: "15:30",
  type: "Aggression", severity: 4, severitySource: "estimated", durationMinutes: 20,
  notes: "Hit her brother after school", tags: ["school"],
}

describe("parseSeverity", () => {
  it.each([
    [3, 3], ["4", 4], ["4/5", 4], [" 2 / 5 ", 2], ["mild", 1], ["Slight", 1], ["minor", 2], ["mild-moderate", 2],
    ["mild–moderate", 2], ["moderate", 3], ["moderate-severe", 4], ["bad", 4], ["severe", 5], ["EXTREME", 5],
  ])("%s → %i", (input, out) => {
    expect(parseSeverity(input)).toBe(out)
  })
  it.each([0, 6, 2.5, "", "awful-ish", null, undefined, {}])("%s → null", (input) => {
    expect(parseSeverity(input)).toBeNull()
  })
})

describe("resolveDraftDate", () => {
  const today = "2026-10-17" // a Saturday
  it.each([
    ["today", "2026-10-17"], ["Today", "2026-10-17"], ["yesterday", "2026-10-16"],
    ["2026-10-01", "2026-10-01"], ["saturday", "2026-10-17"], ["last saturday", "2026-10-10"],
    ["monday", "2026-10-12"], ["Last Monday", "2026-10-12"],
  ])("%s → %s", (input, date) => {
    expect(resolveDraftDate(input, today)).toEqual({ date })
  })
  it("rejects the future, dates over a year back and nonsense", () => {
    expect(resolveDraftDate("2026-10-18", today)).toMatchObject({ error: expect.stringMatching(/future/) })
    expect(resolveDraftDate("2025-10-16", today)).toMatchObject({ error: expect.stringMatching(/year/) })
    expect(resolveDraftDate("2026-02-30", today)).toMatchObject({ error: expect.any(String) })
    expect(resolveDraftDate("soonish", today)).toMatchObject({ error: expect.any(String) })
  })
})

describe("matchExistingType", () => {
  it("reuses the person's spelling when it is the same type", () => {
    expect(matchExistingType("  aggression ", ["Meltdown", "Aggression"])).toBe("Aggression")
    expect(matchExistingType("bad  night", ["Bad night"])).toBe("Bad night")
  })
  it("keeps a new type, trimmed", () => {
    expect(matchExistingType(" Hitting ", ["Meltdown"])).toBe("Hitting")
  })
})

describe("toFormValues", () => {
  it("gives the strings createObservation expects and tags an estimate", () => {
    expect(toFormValues(draft)).toEqual({
      date: "2026-10-17", time: "15:30", type: "Aggression", severity: "4", durationMinutes: "20",
      conditionId: "", tags: "school, severity-estimated", notes: "Hit her brother after school",
    })
  })
  it("never tags a stated severity, and blanks empty fields", () => {
    const v = toFormValues({ ...draft, severitySource: "stated", tags: ["Severity-Estimated"], time: null, durationMinutes: null, notes: null })
    expect(v).toMatchObject({ time: "", durationMinutes: "", notes: "", tags: "" })
  })
})

describe("draftSummaryLine", () => {
  it("states id, state and every value", () => {
    expect(draftSummaryLine({ draft, state: "draft" })).toBe(
      '[observation draft obs-abc123, not saved: Indy · 2026-10-17 15:30 · Aggression · severity 4 (estimated) · 20 min · tags school · "Hit her brother after school"]'
    )
  })
  it("marks saved and discarded cards as final", () => {
    expect(draftSummaryLine({ draft, state: "saved", savedId: "o1" })).toContain("saved, can't be changed here")
    expect(draftSummaryLine({ draft, state: "discarded" })).toContain("discarded")
  })
  it("truncates long notes", () => {
    const line = draftSummaryLine({ draft: { ...draft, notes: "x".repeat(500) }, state: "draft" })
    expect(line.length).toBeLessThan(400)
  })
})

describe("isDraftCard", () => {
  const card: DraftCard = { draft, state: "draft" }
  it("accepts a well-formed card and rejects junk", () => {
    expect(isDraftCard(card)).toBe(true)
    expect(isDraftCard({ ...card, state: "weird" })).toBe(false)
    expect(isDraftCard({ ...card, draft: { ...draft, severity: 9 } })).toBe(false)
    expect(isDraftCard({ state: "draft" })).toBe(false)
    expect(isDraftCard(null)).toBe(false)
  })
})

describe("labels", () => {
  it("names a severity and a local day", () => {
    expect(severityLabel(3)).toBe("3 / 5 · Moderate")
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/observation-draft.test.ts`
Expected: FAIL — cannot resolve `./observation-draft`.

- [ ] **Step 3: Implement**

```ts
// lib/observation-draft.ts
// An observation the assistant has drafted from what the user said, shown as a
// card in the chat and saved only when the user presses Save. Pure and
// client-safe: the tool builds drafts with these helpers, the chat stores and
// summarises them, and the card turns one into the form values
// createObservation takes.

import { normalizeTags } from "./health-schemas"
import { RATING_WORDS } from "./day-ratings"

const DAY = 86_400_000

export type Severity = 1 | 2 | 3 | 4 | 5

export type ObservationDraft = {
  /// "obs-" + six base36 characters, made by the tool; kept across revisions.
  draftId: string
  personId: string
  personName: string
  /// YYYY-MM-DD, and HH:MM (24-hour) when the user said when.
  date: string
  time: string | null
  type: string
  severity: Severity
  /// "estimated" when the user gave none and the model judged it.
  severitySource: "stated" | "estimated"
  durationMinutes: number | null
  notes: string | null
  tags: string[]
}

export type DraftState = "draft" | "saved" | "discarded"
export type DraftCard = { draft: ObservationDraft; state: DraftState; savedId?: string; error?: string }

/// Saved on estimated entries so a guess stays distinguishable from a rating.
export const ESTIMATED_TAG = "severity-estimated"

const SEVERITY_WORDS: [RegExp, Severity][] = [
  [/^(mild|slight|light|very mild)$/, 1],
  [/^(minor|mild[\s\-–]*(to[\s]*)?moderate)$/, 2],
  [/^(moderate|medium)$/, 3],
  [/^(bad|serious|moderate[\s\-–]*(to[\s]*)?severe)$/, 4],
  [/^(severe|extreme|very severe|worst)$/, 5],
]

export function parseSeverity(input: unknown): Severity | null {
  if (typeof input === "number") return Number.isInteger(input) && input >= 1 && input <= 5 ? (input as Severity) : null
  if (typeof input !== "string") return null
  const s = input.trim().toLowerCase()
  const n = s.match(/^([1-5])(\s*\/\s*5)?$/)
  if (n) return Number(n[1]) as Severity
  for (const [re, v] of SEVERITY_WORDS) if (re.test(s)) return v
  return null
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10)

/// "today", "yesterday", "monday" (the most recent, today included), "last
/// monday" (before today), or YYYY-MM-DD; `today` is the viewer's YYYY-MM-DD.
export function resolveDraftDate(input: string, today: string): { date: string } | { error: string } {
  const base = Date.parse(`${today}T00:00:00Z`)
  const s = input.trim().toLowerCase().replace(/\s+/g, " ")
  let t: number | null = null
  if (s === "today") t = base
  else if (s === "yesterday") t = base - DAY
  else {
    const wd = s.match(/^(last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
    if (wd) {
      const back = (new Date(base).getUTCDay() - WEEKDAYS.indexOf(wd[2]) + 7) % 7
      t = base - (back === 0 && wd[1] ? 7 : back) * DAY
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(Date.parse(`${s}T00:00:00Z`) || 0) === s) {
      t = Date.parse(`${s}T00:00:00Z`)
    }
  }
  if (t === null) return { error: `"${input}" isn't a date. Use YYYY-MM-DD, "today", "yesterday" or a weekday.` }
  if (t > base) return { error: `${isoOf(t)} is in the future. Ask the user which day it happened.` }
  if (t < base - 365 * DAY) return { error: `${isoOf(t)} is more than a year ago. Ask the user to add it from the Observations tab instead.` }
  return { date: isoOf(t) }
}

const typeKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/// The person's own spelling when it is the same type, so drafts don't fork "Meltdown" into "meltdown".
export function matchExistingType(type: string, known: string[]): string {
  return known.find((k) => typeKey(k) === typeKey(type)) ?? type.trim().replace(/\s+/g, " ")
}

export function toFormValues(d: ObservationDraft): Record<string, string> {
  const tags = d.tags.filter((t) => t.trim().toLowerCase() !== ESTIMATED_TAG)
  if (d.severitySource === "estimated") tags.push(ESTIMATED_TAG)
  return {
    date: d.date,
    time: d.time ?? "",
    type: d.type,
    severity: String(d.severity),
    durationMinutes: d.durationMinutes == null ? "" : String(d.durationMinutes),
    conditionId: "",
    tags: normalizeTags(tags.join(",")) ?? "",
    notes: d.notes ?? "",
  }
}

const STATE_WORDS: Record<DraftState, string> = {
  draft: "not saved",
  saved: "saved, can't be changed here",
  discarded: "discarded",
}
const NOTE_LIMIT = 200

/// The line the model sees in history for each card, so it can revise by id.
export function draftSummaryLine({ draft: d, state }: DraftCard): string {
  const notes = d.notes && d.notes.length > NOTE_LIMIT ? `${d.notes.slice(0, NOTE_LIMIT)}…` : d.notes
  const parts = [
    d.personName,
    `${d.date}${d.time ? ` ${d.time}` : ""}`,
    d.type,
    `severity ${d.severity}${d.severitySource === "estimated" ? " (estimated)" : ""}`,
    ...(d.durationMinutes != null ? [`${d.durationMinutes} min`] : []),
    ...(d.tags.length ? [`tags ${d.tags.join(", ")}`] : []),
    ...(notes ? [`"${notes}"`] : []),
  ]
  return `[observation draft ${d.draftId}, ${STATE_WORDS[state]}: ${parts.join(" · ")}]`
}

const str = (v: unknown) => typeof v === "string"
const strOrNull = (v: unknown) => v === null || typeof v === "string"

export function isDraftCard(v: unknown): v is DraftCard {
  const c = v as DraftCard | null
  if (!c || typeof c !== "object" || !["draft", "saved", "discarded"].includes(c.state)) return false
  const d = c.draft
  return !!d && str(d.draftId) && str(d.personId) && str(d.personName) && str(d.date) && strOrNull(d.time) && str(d.type)
    && parseSeverity(d.severity) !== null && (d.severitySource === "stated" || d.severitySource === "estimated")
    && (d.durationMinutes === null || typeof d.durationMinutes === "number") && strOrNull(d.notes)
    && Array.isArray(d.tags) && d.tags.every(str)
}

export const severityLabel = (s: Severity) => `${s} / 5 · ${RATING_WORDS[s]}`

/// Today on the viewer's calendar, as YYYY-MM-DD.
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/observation-draft.test.ts`
Expected: PASS. If `RATING_WORDS[3]` is not `"Moderate"`, read `lib/day-ratings.ts` and fix the test expectation to the actual word.

- [ ] **Step 5: Checkpoint** — `npx eslint lib/observation-draft.ts lib/observation-draft.test.ts` clean. Do not commit.

---

### Task 2: Tools can emit events; the browser sends its day

**Files:**
- Modify: `lib/llm/types.ts:36-46` (AgentEvent)
- Modify: `lib/llm/query.ts:20` (ToolContext)
- Modify: `lib/llm/agent.ts:110` (tool ctx)
- Modify: `lib/llm/request-schema.ts`, `app/api/chat/route.ts:82`
- Test: `lib/llm/agent.test.ts`, `lib/llm/request-schema` test if one exists (`ls lib/llm/*request*`), else add cases to `lib/llm/agent.test.ts` only.

**Interfaces:**
- Consumes: `ObservationDraft` (Task 1).
- Produces:
  - `AgentEvent` adds `{ type: "draft"; draft: ObservationDraft }`
  - `ToolContext = { userId: string; now: Date; health?: boolean; today?: string; emit?: (event: AgentEvent) => void }`
  - `chatRequestSchema` accepts optional `today: string` matching `/^\d{4}-\d{2}-\d{2}$/`

- [ ] **Step 1: Write the failing tests**

Add to `lib/llm/agent.test.ts` inside `describe("runAgent", …)`:

```ts
  it("lets a tool send its own event to the page", async () => {
    const shout = defineTool({
      name: "shout",
      description: "Emits.",
      schema: z.object({}),
      label: () => "Shouting…",
      run: async (_a, c) => {
        c.emit?.({ type: "status", tool: "shout", label: "from the tool", round: 0 })
        return { ok: true }
      },
    })
    const { chat } = scripted([
      { content: "", toolCalls: [{ id: "c1", name: "shout", arguments: "{}" }] },
      { content: "Done", toolCalls: [] },
    ])
    const events = await run(chat, { tools: [shout] })
    expect(events).toContainEqual({ type: "status", tool: "shout", label: "from the tool", round: 0 })
  })
```

Create `lib/llm/request-schema.test.ts` if absent (else add the `describe` to it):

```ts
import { describe, expect, it } from "vitest"
import { chatRequestSchema } from "./request-schema"

describe("chatRequestSchema today", () => {
  const messages = [{ role: "user" as const, content: "hi" }]
  it("accepts the viewer's day or none", () => {
    expect(chatRequestSchema.safeParse({ messages, today: "2026-10-17" }).success).toBe(true)
    expect(chatRequestSchema.safeParse({ messages }).success).toBe(true)
  })
  it("rejects anything else", () => {
    expect(chatRequestSchema.safeParse({ messages, today: "Oct 17" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/llm/agent.test.ts lib/llm/request-schema.test.ts`
Expected: FAIL — emitted status missing (ctx has no `emit`); `today: "Oct 17"` accepted (unknown keys stripped).

- [ ] **Step 3: Implement**

`lib/llm/types.ts` — add the import at the top and the union member after `error`:

```ts
import type { ObservationDraft } from "../observation-draft"
```
```ts
  | { type: "error"; message: string }
  /** An observation the assistant drafted; the page shows it as a card with Save. */
  | { type: "draft"; draft: ObservationDraft }
```

`lib/llm/query.ts:20` — replace the ToolContext line:

```ts
/**
 * health: false while Health is off in Settings → Features; absent means on.
 * today: the viewer's calendar day (YYYY-MM-DD), when the page sent it.
 * emit: sends an event straight to the page (only draft tools use it).
 */
export type ToolContext = { userId: string; now: Date; health?: boolean; today?: string; emit?: (event: AgentEvent) => void }
```
and add `import type { AgentEvent } from "./types"` to its imports (check `query.ts` doesn't already import from `./types`; extend that import if it does).

`lib/llm/agent.ts:110`:

```ts
        return runToolCall(o.tools, call, { ...o.ctx, emit: o.emit })
```

`lib/llm/request-schema.ts` — inside `z.object({ … })` after `messages`:

```ts
    /** The viewer's calendar day, so "today" means their today, not UTC's. */
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
```

`app/api/chat/route.ts:82`:

```ts
          ctx: { userId, now, health, today: parsed.data.today },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/llm/agent.test.ts lib/llm/request-schema.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Checkpoint** — lint the touched files. Do not commit.

---

### Task 3: The `draft_observation` tool

**Files:**
- Create: `lib/llm/tools/observation-draft.ts`
- Test: `lib/llm/tools/observation-draft.test.ts`
- Modify: `lib/llm/tools/index.ts:23` (HEALTH_TOOLS) and the `SHORTCUT_TOOLS` list (append after `observationLogTool`)
- Modify: `lib/llm/prompt.ts:50-51`
- Modify: `lib/llm/model-test/checks.ts:8-21`, `lib/llm/model-test/cases-observations.ts`
- Modify: `lib/llm/health-off.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `ToolContext.emit/today` (Task 2); `findAsset(raw, ctx, types)` from `./shortcuts` (returns `{ asset: { type, id, name, href } } | { reply: unknown }`); `observationSchema` from `@/lib/health-schemas`; `healthOn`, `ToolInputError` from `../query`; `toDay(d)` from `../serialize`.
- Produces:
  - `type DraftArgs` (the zod schema's type)
  - `type DraftDeps = { findPerson(raw: string): Promise<{ person: { id: string; name: string } } | { reply: unknown }>; knownTypes(personId: string): Promise<string[]>; today: string; newId(): string }`
  - `buildDraft(a: DraftArgs, deps: DraftDeps): Promise<{ draft: ObservationDraft; knownTypes: string[] } | { reply: unknown }>`
  - `draftObservationTool: RegisteredTool` named `"draft_observation"`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/llm/tools/observation-draft.test.ts
import { describe, expect, it, vi } from "vitest"

// The module reaches Prisma at import; buildDraft gets fakes instead.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { buildDraft, draftObservationTool, type DraftDeps } from "./observation-draft"

const deps = (over: Partial<DraftDeps> = {}): DraftDeps => ({
  findPerson: async () => ({ person: { id: "p1", name: "Indy" } }),
  knownTypes: async () => ["Meltdown", "Aggression"],
  today: "2026-10-17",
  newId: () => "obs-new001",
  ...over,
})
const base = { person: "Indy", date: "today", type: "aggression", notes: "Hit her brother after school" }

describe("buildDraft", () => {
  it("builds an estimated draft, reusing the person's type spelling", async () => {
    const out = await buildDraft({ ...base, severityEstimate: 4, durationMinutes: 20 }, deps())
    expect(out).toEqual({
      knownTypes: ["Meltdown", "Aggression"],
      draft: {
        draftId: "obs-new001", personId: "p1", personName: "Indy", date: "2026-10-17", time: null,
        type: "Aggression", severity: 4, severitySource: "estimated", durationMinutes: 20,
        notes: "Hit her brother after school", tags: [],
      },
    })
  })
  it("prefers a stated severity, by word or number, over an estimate", async () => {
    const word = await buildDraft({ ...base, severity: "severe", severityEstimate: 2 }, deps())
    expect(word).toMatchObject({ draft: { severity: 5, severitySource: "stated" } })
    const num = await buildDraft({ ...base, severity: 2 }, deps())
    expect(num).toMatchObject({ draft: { severity: 2, severitySource: "stated" } })
  })
  it("asks for an estimate when no severity came through", async () => {
    expect(await buildDraft(base, deps())).toMatchObject({ reply: { error: expect.stringMatching(/severityEstimate/) } })
    expect(await buildDraft({ ...base, severity: "kinda bad?" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/severity/) } })
  })
  it("keeps the draft id on a revision", async () => {
    expect(await buildDraft({ ...base, severity: 3, draftId: "obs-abc123" }, deps())).toMatchObject({ draft: { draftId: "obs-abc123" } })
  })
  it("uses the viewer's today and refuses the future", async () => {
    expect(await buildDraft({ ...base, severity: 3, date: "yesterday" }, deps())).toMatchObject({ draft: { date: "2026-10-16" } })
    expect(await buildDraft({ ...base, severity: 3, date: "2026-10-18" }, deps())).toMatchObject({ reply: { error: expect.stringMatching(/future/) } })
  })
  it("passes an ambiguous or unknown person back as the reply", async () => {
    const reply = { note: "matches 2 records" }
    expect(await buildDraft({ ...base, severity: 3 }, deps({ findPerson: async () => ({ reply }) }))).toEqual({ reply })
  })
  it("returns field errors for a draft that wouldn't save", async () => {
    const out = await buildDraft({ ...base, severity: 3, time: "25:99" }, deps())
    expect(out).toMatchObject({ reply: { error: expect.stringMatching(/wouldn't save/), issues: { time: expect.any(Array) } } })
  })
})

describe("draftObservationTool", () => {
  it("refuses with Health off", async () => {
    const out = await draftObservationTool.execute({ ...base, severity: 3 }, { userId: "u", now: new Date(), health: false })
    expect(out).toMatch(/Health is turned off/)
  })
})
```

Add to `lib/llm/health-off.test.ts` in "keeps health out of the prompt and the tools":

```ts
    expect(names).not.toContain("draft_observation")
    expect(chatTools({ enabled: false, includeHealth: false }).map((t) => t.name)).toContain("draft_observation")
    expect(buildSystemPrompt({ now: off.now, health: false })).not.toContain("draft_observation")
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/llm/tools/observation-draft.test.ts lib/llm/health-off.test.ts`
Expected: FAIL — module missing; tool not registered.

- [ ] **Step 3: Implement the tool**

```ts
// lib/llm/tools/observation-draft.ts
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

const schema = z.object({
  person: z.string().min(1).describe("Who it's about: the person's name as the user said it, or their id."),
  date: z.string().min(1).describe('The day it happened: YYYY-MM-DD, "today", "yesterday", or a weekday such as "monday".'),
  time: z.string().optional().describe("HH:MM, 24-hour — only if the user said when."),
  type: z.string().min(1).max(60).describe("A short label such as Meltdown, Aggression, Bad night. Reuse one of the person's existing types when it fits."),
  severity: z.union([z.number(), z.string()]).optional().describe("Only a severity the user stated: 1-5, or a word such as mild, moderate, severe."),
  severityEstimate: z.number().int().min(1).max(5).optional().describe(`Your estimate when the user gave no severity. ${RUBRIC}`),
  durationMinutes: z.number().int().min(0).optional().describe("How long it lasted, in minutes, if the user said."),
  notes: z.string().optional().describe("What happened, in the user's words, tidied. Keep their details; add nothing."),
  tags: z.array(z.string()).optional().describe("Short tags the user implied, e.g. school, bedtime."),
  draftId: z.string().optional().describe("To change a draft already shown, its id (obs-…) from the conversation, with every field sent again. Omit for a new entry."),
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
    draftId: a.draftId?.trim() || deps.newId(),
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

const newId = () => `obs-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`

const SHOWN =
  "Shown to the user as a card with a Save button. It is NOT saved. In one or two sentences say what you filled in, " +
  "which values you guessed (especially an estimated severity), and ask them to press Save or tell you what to change."

export const draftObservationTool = defineTool({
  name: "draft_observation",
  description:
    "Drafts one Observation entry (a meltdown, symptom, incident, bad night…) from what the user described, for them to review and save. " +
    "Call it whenever the user tells you something that happened to a person. One call per incident. You cannot save; the user saves from the card. " +
    "To change a draft, call again with its draftId and every field.",
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
```

If `findAsset` is not exported from `shortcuts.ts`, export it (it is `export async function findAsset` at line 126 — confirm). If `toDay` returns something other than `YYYY-MM-DD`, use `ctx.now.toISOString().slice(0, 10)` instead.

- [ ] **Step 4: Register, prompt, model-test**

`lib/llm/tools/index.ts`: import `draftObservationTool` from `./observation-draft`; add it to the `HEALTH_TOOLS` set and to the end of `SHORTCUT_TOOLS` (after `observationLogTool`).

`lib/llm/prompt.ts` — after the medication_history line (50) add:

```ts
    ...(health ? ["- When the user tells you something that happened to a person (a meltdown, symptom, incident, bad night), call draft_observation — one call per incident. You can't save: the user reviews the card and presses Save. If they ask for a change, call draft_observation again with that draft's id (from the [observation draft …] lines) and every field. A saved draft can't be changed here; point them to the entry."] : []),
```

`lib/llm/model-test/checks.ts` TOOL_WORDS: add `draft_observation: "an observation draft",`.

`lib/llm/model-test/cases-observations.ts` — add to the tool-choice cases (next to `choice-observations-not-health-alerts`):

```ts
  {
    id: "choice-observations-draft",
    stage: "tool-choice",
    category: "Observations",
    title: "Drafts an entry when told what happened, estimating severity",
    question: "Jamie was hitting his sister after school today, it went on for about 20 minutes.",
    check: calledTool("draft_observation", (a) => {
      if (!String(a.person ?? "").toLowerCase().includes("jamie")) return "it wasn't for Jamie"
      if (a.durationMinutes !== 20) return "it didn't record 20 minutes"
      if (a.severity === undefined && !(Number(a.severityEstimate) >= 3)) return "it didn't estimate a severity of at least 3 for hitting"
      return null
    }),
  },
```

If the model-test runner needs a fake result for every tool used by a case (check `lib/llm/model-test/runner.ts` for how tool-choice cases resolve calls), tool-choice cases stop at the first call, so no fixture is needed.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/llm/ && npx tsc --noEmit -p .`
Expected: PASS (includes `model-test/tools.test.ts` "plain-language description for every tool").

- [ ] **Step 6: Checkpoint** — lint touched files. Do not commit.

---

### Task 4: Cards in the stored thread

**Files:**
- Modify: `lib/llm/thread-storage.ts`
- Test: `lib/llm/thread-storage.test.ts`

**Interfaces:**
- Consumes: `DraftCard`, `isDraftCard`, `draftSummaryLine` (Task 1).
- Produces:
  - `ThreadMessage = HistoryMessage & { discarded?: string; cards?: DraftCard[] }`
  - `CARD_ONLY_TEXT = "Here's a draft. Check it and press Save, or tell me what to change."`
  - `mergeCards(thread: ThreadMessage[], answer: ThreadMessage, cards: DraftCard[]): ThreadMessage[]`
  - `updateCard(thread: ThreadMessage[], draftId: string, patch: Partial<Omit<DraftCard, "draft">>): ThreadMessage[]`
  - `requestMessages` appends each message's card summary lines.

- [ ] **Step 1: Write the failing tests** (append to `lib/llm/thread-storage.test.ts`; add the imports to its import lines)

```ts
import { CARD_ONLY_TEXT, mergeCards, updateCard } from "./thread-storage"
import type { DraftCard, ObservationDraft } from "../observation-draft"

const d = (id: string, over: Partial<ObservationDraft> = {}): ObservationDraft => ({
  draftId: id, personId: "p1", personName: "Indy", date: "2026-10-17", time: null, type: "Aggression",
  severity: 3, severitySource: "estimated", durationMinutes: null, notes: null, tags: [], ...over,
})
const card = (id: string, over: Partial<DraftCard> = {}): DraftCard => ({ draft: d(id), state: "draft", ...over })

describe("draft cards", () => {
  const q = { role: "user" as const, content: "Indy hit her brother" }
  const a1 = { role: "assistant" as const, content: "Drafted it.", cards: [card("obs-aaaaaa")] }

  it("attach new cards to the answer, and keep a card-only answer", () => {
    const t = mergeCards([q], { role: "assistant", content: "" }, [card("obs-aaaaaa")])
    expect(t).toEqual([q, { role: "assistant", content: CARD_ONLY_TEXT, cards: [card("obs-aaaaaa")] }])
  })
  it("revise an earlier unsaved card in place instead of adding one", () => {
    const revised = { draft: d("obs-aaaaaa", { severity: 4, severitySource: "stated" }), state: "draft" as const }
    const t = mergeCards([q, a1, { role: "user", content: "make it a 4" }], { role: "assistant", content: "Changed." }, [revised])
    expect(t[1].cards).toEqual([revised])
    expect(t[3]).toEqual({ role: "assistant", content: "Changed." })
  })
  it("never revise a saved or discarded card", () => {
    const saved = { ...a1, cards: [card("obs-aaaaaa", { state: "saved", savedId: "o1" })] }
    const t = mergeCards([q, saved], { role: "assistant", content: "ok" }, [card("obs-aaaaaa", { draft: d("obs-aaaaaa", { severity: 5 }) })])
    expect(t[1].cards![0]).toMatchObject({ state: "saved", draft: { severity: 3 } })
    expect(t[2].cards).toBeUndefined()
  })
  it("updates a card's state by id", () => {
    const t = updateCard([q, a1], "obs-aaaaaa", { state: "saved", savedId: "o9" })
    expect(t[1].cards![0]).toMatchObject({ state: "saved", savedId: "o9" })
  })
  it("round-trips cards through storage and drops malformed ones", () => {
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    saveThread(s, "u", [q, { ...a1, cards: [card("obs-aaaaaa"), { junk: true } as unknown as DraftCard] }])
    expect(loadThread(s, "u")[1].cards).toEqual([card("obs-aaaaaa")])
  })
  it("sends each card's summary with its message", () => {
    const sent = requestMessages([q, a1])
    expect(sent[1].content).toBe("Drafted it.\n\n[observation draft obs-aaaaaa, not saved: Indy · 2026-10-17 · Aggression · severity 3 (estimated)]")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/llm/thread-storage.test.ts`
Expected: FAIL — `mergeCards` not exported.

- [ ] **Step 3: Implement** in `lib/llm/thread-storage.ts`

Imports and type:

```ts
import { draftSummaryLine, isDraftCard, type DraftCard } from "../observation-draft"
```
```ts
/**
 * A message as the page keeps it. `discarded` is a first answer that was
 * thrown out by the link check; it is shown struck through and never sent.
 * `cards` are observation drafts the answer produced, with their Save state.
 */
export type ThreadMessage = HistoryMessage & { discarded?: string; cards?: DraftCard[] }

export const CARD_ONLY_TEXT = "Here's a draft. Check it and press Save, or tell me what to change."
```

In `loadThread`, replace the `.map(...)`:

```ts
      .map((m) => {
        const cards = Array.isArray(m.cards) ? m.cards.filter(isDraftCard) : []
        return {
          role: m.role,
          content: m.content,
          ...(typeof m.discarded === "string" && m.discarded ? { discarded: m.discarded } : {}),
          ...(cards.length ? { cards } : {}),
        }
      })
```

New functions (after `clearThread`):

```ts
/**
 * Adds a finished answer and its cards. A card whose id is already in the
 * thread revises that card in place while it is unsaved; a saved or
 * discarded card stays as it is.
 */
export function mergeCards(thread: ThreadMessage[], answer: ThreadMessage, cards: DraftCard[]): ThreadMessage[] {
  const fresh: DraftCard[] = []
  const seen = new Set(thread.flatMap((m) => m.cards ?? []).map((c) => c.draft.draftId))
  let next = thread
  for (const c of cards) {
    if (!seen.has(c.draft.draftId)) { fresh.push(c); continue }
    next = next.map((m) => m.cards?.some((x) => x.draft.draftId === c.draft.draftId)
      ? { ...m, cards: m.cards.map((x) => (x.draft.draftId === c.draft.draftId && x.state === "draft" ? { ...x, draft: c.draft, error: undefined } : x)) }
      : m)
  }
  const content = answer.content.trim() ? answer.content : fresh.length || cards.length ? CARD_ONLY_TEXT : answer.content
  return [...next, { ...answer, content, ...(fresh.length ? { cards: fresh } : {}) }]
}

export function updateCard(thread: ThreadMessage[], draftId: string, patch: Partial<Omit<DraftCard, "draft">>): ThreadMessage[] {
  return thread.map((m) => m.cards?.some((c) => c.draft.draftId === draftId)
    ? { ...m, cards: m.cards.map((c) => (c.draft.draftId === draftId ? { ...c, ...patch } : c)) }
    : m)
}
```

In `requestMessages`, replace `const content = m.content.slice(0, MAX_MESSAGE_CHARS)` with:

```ts
    const withCards = m.cards?.length ? `${m.content}\n\n${m.cards.map(draftSummaryLine).join("\n")}` : m.content
    const content = withCards.slice(0, MAX_MESSAGE_CHARS)
```

Note on the round-trip test's `{ error: undefined }` from `mergeCards`: `toEqual` treats an `undefined` property as absent, so revised-card equality holds.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/llm/thread-storage.test.ts`
Expected: PASS, existing tests still green.

- [ ] **Step 5: Checkpoint** — lint. Do not commit.

---

### Task 5: Chat hook and the card

**Files:**
- Modify: `components/chat/use-chat-thread.ts`
- Create: `components/chat/observation-draft-card.tsx`
- Modify: `components/chat/chat-thread.tsx`

**Interfaces:**
- Consumes: `mergeCards`, `updateCard`, `ThreadMessage` (Task 4); `DraftCard`, `toFormValues`, `severityLabel`, `localDay` (Task 1); `createObservation(personId, values): Promise<ActionResult>` from `@/lib/actions/health`; `ActionResult` from `@/lib/form-types`.
- Produces: hook returns additionally `liveCards: DraftCard[]` and `updateCard(draftId: string, patch: Partial<Omit<DraftCard, "draft">>): void`.

No component tests exist in this repo (Vitest covers pure lib only); the logic is in Task 4. Verify in the browser (Step 5).

- [ ] **Step 1: Hook changes** in `components/chat/use-chat-thread.ts`

Imports:

```ts
import { clearThread, loadThread, mergeCards, requestMessages, saveThread, shouldPersist, updateCard as updateThreadCard, type ThreadMessage } from "@/lib/llm/thread-storage"
import { localDay, type DraftCard } from "@/lib/observation-draft"
```

State (next to `notices`):

```ts
  /** Cards drafted during the running turn; saved into the thread when it ends. */
  const [liveCards, setLiveCards] = useState<DraftCard[]>([])
```

In `run`: after `setStatusLabel(null)` at the top add `setLiveCards([])`. Change `turn` and `answer`:

```ts
      const turn = { text: "", discarded: null as string | null, failure: null as string | null, done: false, cards: [] as DraftCard[] }
```

Body of the fetch:

```ts
          body: JSON.stringify({ messages: requestMessages(thread), today: localDay() }),
```

In the event handler add a branch (before `status`). `reset` must not touch `turn.cards`:

```ts
          } else if (event.type === "draft") {
            // A revision within the same turn replaces that card; text resets never drop cards.
            turn.cards = [...turn.cards.filter((c) => c.draft.draftId !== event.draft.draftId), { draft: event.draft, state: "draft" }]
            setLiveCards(turn.cards)
```

Replace both persist sites:

```ts
        if ((turn.text.trim() || turn.cards.length) && shouldPersist(started, generation.current)) {
          persist(mergeCards(thread, answer(), turn.cards))
        }
```
```ts
          if (turn.text.trim() || turn.cards.length) persist(mergeCards(thread, answer(), turn.cards))
```

In `finally` (inside the `shouldPersist` block) and in `reset`, add `setLiveCards([])`.

New callback before `return`:

```ts
  const updateCard = useCallback(
    (draftId: string, patch: Partial<Omit<DraftCard, "draft">>) => {
      setMessages((current) => {
        const next = updateThreadCard(current, draftId, patch)
        saveThread(storage(), userId, next)
        return next
      })
    },
    [userId]
  )
```

Return: add `liveCards, updateCard`.

- [ ] **Step 2: The card** — `components/chat/observation-draft-card.tsx`

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ClipboardList, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createObservation } from "@/lib/actions/health"
import type { ActionResult } from "@/lib/form-types"
import { severityLabel, toFormValues, type DraftCard } from "@/lib/observation-draft"
import { cn } from "@/lib/utils"

function errorText(r: ActionResult): string {
  if (typeof r.error === "string") return r.error
  const all = Object.values(r.error ?? {}).flat().filter(Boolean)
  return all.length ? all.join(" ") : "Couldn't save it. Try again."
}

/// One drafted observation in the chat. Nothing is written until Save, which
/// goes through the same server action as the Observations form.
export function ObservationDraftCard({
  card, onChange, live = false,
}: {
  card: DraftCard
  onChange?: (patch: Partial<Omit<DraftCard, "draft">>) => void
  /// Still streaming: shown, but Save waits for the answer to finish.
  live?: boolean
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const d = card.draft

  if (card.state === "discarded") {
    return <p className="text-xs text-muted-foreground">Discarded draft · {d.personName} · {d.type} · {d.date}</p>
  }

  async function save() {
    if (saving || !onChange) return
    setSaving(true)
    try {
      const r = await createObservation(d.personId, toFormValues(d))
      if (r.success && r.id) {
        onChange({ state: "saved", savedId: r.id, error: undefined })
        router.refresh()
      } else onChange({ error: errorText(r) })
    } catch {
      onChange({ error: "Couldn't reach the server. Try again." })
    } finally {
      setSaving(false)
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  )

  return (
    <div className={cn("max-w-md rounded-lg border bg-card text-sm shadow-sm", card.state === "saved" && "border-[var(--chart-4)]/50")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{card.state === "saved" ? "Observation saved" : "Draft observation"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{card.state === "saved" ? "" : "Not saved yet"}</span>
      </div>
      <dl className="space-y-1 px-3 py-2 text-xs">
        {row("Person", d.personName)}
        {row("When", `${d.date}${d.time ? ` · ${d.time}` : ""}`)}
        {row("What", d.type)}
        {row("Severity", (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {severityLabel(d.severity)}
            {d.severitySource === "estimated" && (
              <span className="rounded border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">estimated</span>
            )}
          </span>
        ))}
        {d.durationMinutes != null && row("Duration", `${d.durationMinutes} min`)}
        {d.notes && row("Notes", <span className="whitespace-pre-wrap">{d.notes}</span>)}
        {d.tags.length > 0 && row("Tags", d.tags.join(", "))}
      </dl>
      {card.error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{card.error}</p>}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {card.state === "saved" ? (
          <>
            <Check className="h-4 w-4 text-[var(--chart-4)]" aria-hidden="true" />
            <span className="text-xs">Saved</span>
            <Link className="ml-auto text-xs font-medium underline-offset-2 hover:underline" href={`/assets/people/${d.personId}?tab=observations&open=${card.savedId}`}>
              Open entry
            </Link>
          </>
        ) : (
          <>
            <Button size="sm" onClick={save} disabled={saving || live || !onChange}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange?.({ state: "discarded", error: undefined })} disabled={saving || live || !onChange}>
              <X className="h-3.5 w-3.5" />
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

Before writing, confirm `@/components/ui/button` exports `Button` with `size="sm"` and `variant="ghost"` (chat-thread already uses both), and that the person page reads `?tab=observations&open=<id>` (it does: `openId={tab === "observations" ? open : undefined}` in `app/(app)/assets/people/[id]/page.tsx`).

- [ ] **Step 3: Render cards** in `components/chat/chat-thread.tsx`

Import `ObservationDraftCard` from `./observation-draft-card`. Replace the messages map and the pending bubble:

```tsx
        {chat.messages.map((m, i) => [
          <Bubble key={i} role={m.role} content={m.content} discarded={m.discarded} />,
          ...(m.cards ?? []).map((c) => (
            <ObservationDraftCard key={c.draft.draftId} card={c} onChange={chat.busy ? undefined : (p) => chat.updateCard(c.draft.draftId, p)} />
          )),
          ...noticesAfter(i + 1),
        ])}
        {chat.draft || chat.discarded ? <Bubble role="assistant" content={chat.draft ?? ""} discarded={chat.discarded} pending /> : null}
        {chat.liveCards.map((c) => <ObservationDraftCard key={`live-${c.draft.draftId}`} card={c} live />)}
```

Also add `chat.liveCards.length === 0 &&` to the `empty` condition.

- [ ] **Step 4: Typecheck, lint, tests**

Run: `npx tsc --noEmit -p . && npx eslint components/chat lib/observation-draft.ts lib/llm && npx vitest run`
Expected: clean; all tests pass.

- [ ] **Step 5: Browser check** (needs the user's dev server on :3000 and a configured model; do NOT create a junction worktree for previews)

Ask the user to: open the assistant, send "Indy (timeline demo) was hitting her brother after school today for about 20 minutes", confirm a card with severity marked *estimated*, say "make it a 3", confirm the same card updates and the badge goes, press Save, confirm "Saved · Open entry" and the entry on the Observations tab with tag `severity-estimated` absent (stated now). Reload the page: cards persist with state.

- [ ] **Step 6: Checkpoint** — do not commit.

---

### Task 6: Roadmap note and final verification

**Files:**
- Modify: `docs/product-discovery/prioritized-roadmap.md:214`
- Modify: `docs/product-discovery/feature-opportunities.md:542`

- [ ] **Step 1: Update the roadmap rows**

`prioritized-roadmap.md:214` — replace the row's last cell text with:
`Error-prone on local models and hard to audit. F6 provides reviewed creation. Observation drafts (2026-10) follow the allowed shape: the assistant drafts, the user saves from a card. Direct writes stay out.`

`feature-opportunities.md:542` — append to the last cell:
` Observations now work this way (draft card, user presses Save); see docs/superpowers/specs/2026-10-17-assistant-observation-drafts-design.md.`

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit -p . && npx eslint . && npx vitest run`
Expected: typecheck clean; lint shows only the pre-existing warnings in other files; every test passes. Report the counts.

- [ ] **Step 3: Checkpoint** — summarise for the user; do not commit.
