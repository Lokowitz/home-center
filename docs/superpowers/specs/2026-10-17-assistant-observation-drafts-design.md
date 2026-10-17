# Assistant observation drafts — design

Date: 2026-10-17
Status: approved in conversation, awaiting spec review

## Goal

Let a household member tell the assistant what happened — "Today Indy was
hitting her brother after school, it lasted about 20 minutes" — and get an
Observation entry out of it without opening the form. The assistant fills in
person, date, type, severity (guessing when none is given), duration and notes,
shows the entry as a card in the chat, takes corrections in plain language
("make it a 4", "it was yesterday"), and saves only when the user clicks
**Save** on the card.

## Decisions (from the conversation)

- **Draft, then confirm.** The model never writes. It produces a draft; the
  user's click on the card's Save button calls the existing `createObservation`
  server action. This keeps the roadmap's line ("revisit only as the assistant
  drafts, never direct writes") and is the review point for a model that can
  pick the wrong person or date.
- **Severity is always set.** Stated by name or number → mapped directly.
  Otherwise the model estimates against a rubric and the draft is marked
  *estimated*. Estimated entries are saved with the tag `severity-estimated`.
- **One entry per card.** A message describing two incidents gives two cards.
- **No editing after save from the chat.** A saved card locks; the assistant
  points to the entry for later changes.

## Non-goals

- Drafting any other record type (medications, maintenance, costs).
- Editing or deleting saved observations through the assistant.
- Storing chat history on the server (it stays in sessionStorage).
- Attachments or condition linking from chat (the form still does those).

## Current state (what this builds on)

- Tools are declared with `defineTool` (`lib/llm/tools/registry.ts`) and
  registered per request by `chatTools(...)` (`lib/llm/tools/index.ts`); health
  tools are dropped when Health is off. All tools are read-only.
- The agent loop (`lib/llm/agent.ts`) streams NDJSON `AgentEvent`s
  (`status | reset | delta | done | error`, `lib/llm/types.ts`). Tool results
  never reach the browser.
- The browser keeps the thread in sessionStorage as `ThreadMessage`
  (`{ role, content, discarded? }`, `lib/llm/thread-storage.ts`) and sends the
  last messages as plain text via `requestMessages`.
- `createObservation(personId, values)` (`lib/actions/health.ts`) validates with
  `observationSchema` (`lib/health-schemas.ts`), checks the person, records
  `createdById`, and revalidates the person page.
- Person names resolve through `resolveAssetId` / `matchAsset`
  (`lib/llm/asset-ids.ts`).

## Design

### 1. Draft model (pure, `lib/observation-draft.ts`)

```ts
type ObservationDraft = {
  draftId: string            // "obs-" + 6 random base36 chars, made by the tool
  personId: string
  personName: string
  date: string               // YYYY-MM-DD
  time: string | null        // HH:MM
  type: string
  severity: 1 | 2 | 3 | 4 | 5
  severitySource: "stated" | "estimated"
  durationMinutes: number | null
  notes: string | null
  tags: string[]
}
type DraftState = "draft" | "saved" | "discarded"
```

Pure helpers, all unit-tested:

- `parseSeverity(input)` — `1`–`5`, `"4/5"`, and words: mild → 1,
  mild-moderate / minor → 2, moderate → 3, moderate-severe / bad → 4,
  severe / extreme → 5. Unknown → null.
- `resolveDraftDate(input, now)` — `YYYY-MM-DD`, `today`, `yesterday`, weekday
  names meaning the most recent such day; rejects future dates and dates more
  than a year back with a readable error.
- `matchExistingType(type, knownTypes)` — case/space-insensitive exact match
  returns the known spelling, so drafts reuse the person's existing types.
- `toFormValues(draft)` — the `FormValues` (all strings) `createObservation`
  expects; adds `severity-estimated` to tags when estimated, de-duplicated
  through the same normalisation the schema uses.
- `draftSummaryLine(draft, state)` — the one line sent back to the model with
  history, e.g.
  `[observation draft obs-k3x9q2, not saved: Indy · 2026-10-17 · Aggression · severity 3 (estimated) · 20 min · "Hit her brother after school"]`.

### 2. Tool (`lib/llm/tools/observation-draft.ts`)

`draft_observation`, health-only (added to `HEALTH_TOOLS`).

Arguments (zod): `person` (name or id), `date`, `time?`, `type`, `severity?`
(number or word), `severityEstimate?` (1–5, the model's guess when none was
stated), `durationMinutes?`, `notes?`, `tags?`, `draftId?` (revise an existing
draft).

Behaviour:

1. Resolve the person with `matchAsset` restricted to PERSON. Ambiguous → return
   candidates and ask the model to confirm with the user; none → error naming
   the people available.
2. Severity: `parseSeverity(severity)` → `stated`; else `severityEstimate` →
   `estimated`; else error asking the model to estimate.
3. Date via `resolveDraftDate`; type via `matchExistingType` against the
   person's distinct observation types (loaded in the tool).
4. Validate the result with `observationSchema.safeParse(toFormValues(draft))`
   so a draft that would fail on save fails now, with the field errors returned
   to the model.
5. Assign `draftId` (new: a fresh random id; revision: keep the given one) and emit a `draft` event (below). Return to the model the
   normalised draft, the known types, and the instruction: "Shown to the user as
   a card with a Save button. Not saved. Say what you filled in and what you
   guessed; ask them to Save or correct it."

The tool description carries the severity rubric:
1 brief/minor, redirected easily · 2 upset, took effort to settle ·
3 disruptive, hard to redirect, lasted a while · 4 physical aggression,
destruction, or unsafe behaviour · 5 injury, danger to self or others, or
emergency help needed. Estimate conservatively when unsure.

Tools emitting events: `ToolContext` gains an optional
`emit?: (event: AgentEvent) => void`, set by `runAgent` from its own emitter.
Only `draft_observation` uses it. Revisions use the `draftId` the model reads
from the history summary lines.

### 3. Event and transport

`AgentEvent` gains
`{ type: "draft"; draft: ObservationDraft }`.
The route needs no change beyond passing it through (it already writes every
event as a line).

### 4. Thread storage

`ThreadMessage` gains `drafts?: { draft: ObservationDraft; state: DraftState; savedId?: string; error?: string }[]`
on assistant messages.

- `use-chat-thread` handles `draft`: attaches it to the in-progress assistant
  message, replacing a card with the same `draftId` anywhere in the thread (a
  revision updates the original card in place and moves nothing).
- `loadThread` validates stored drafts and drops malformed ones.
- `requestMessages` appends each card's `draftSummaryLine` to its assistant
  message content, so the model sees current values and state next turn.
  Saved/discarded cards are summarised with their state so the model won't try
  to revise them.

### 5. Card UI (`components/chat/observation-draft-card.tsx`)

Rendered under the assistant bubble that produced it. Shows person, date
(+time), type, severity as "3 / 5 · Moderate" with an *estimated* badge,
duration, notes, tags.

- **Save** → `createObservation(personId, toFormValues(draft))` (server action,
  session-checked). Success → state `saved`, `savedId`, card locks and shows
  "Saved · Open entry" linking to `/assets/people/{id}?tab=observations&open={savedId}`.
  Field errors → shown on the card, state stays `draft`.
- **Discard** → state `discarded`, card collapses to one muted line.
- Buttons disabled while saving; double-click safe.
- Works in light/dark and on phone width.

### 6. Prompt and docs

- `prompt.ts`: one rule — "When the user describes something that happened to a
  person (a meltdown, symptom, incident), call `draft_observation`. You cannot
  save; the user saves from the card. To change a draft, call it again with its
  draftId. Saved drafts can't be changed here."
- `prioritized-roadmap.md` / `feature-opportunities.md`: note that observation
  drafting shipped under the draft-then-confirm rule; direct writes stay out.

## Error handling

- Health off → tool absent; the model cannot draft.
- Person ambiguous/unknown, future date, invalid fields → tool returns an error
  the model relays as a question; no card is emitted.
- Save failure (validation, person deleted, session expired) → error on the
  card, retryable.
- sessionStorage unavailable → cards still work for the live page, lost on
  reload (same as today's thread).

## Testing

- `lib/observation-draft.test.ts`: severity words/numbers, date words and
  limits, type matching, `toFormValues` (estimated tag, strings), summary line.
- Tool test with mocked prisma: ambiguous person, stated vs estimated severity,
  revision keeps `draftId`, schema failure returns field errors, emits one
  `draft` event.
- `thread-storage.test.ts`: drafts round-trip, malformed dropped, revision
  replaces in place, `requestMessages` appends summary lines.
- Agent test: a tool's `ctx.emit` event reaches the stream.
- Model-test case (`cases-observations.ts`): "Indy hit her brother today, it
  lasted 20 minutes" → `draft_observation` called with person Indy, today,
  duration 20, an estimate ≥ 3.
- Typecheck, lint, full Vitest suite.

## Open risks

- Small local models may skip the tool and just reply in text; the model-test
  case measures this per configured model.
- The model may estimate severity inconsistently; the badge and tag keep
  estimates visible and filterable.
