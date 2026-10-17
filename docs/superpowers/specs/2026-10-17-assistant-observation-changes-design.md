# Assistant observation changes (edit, delete) — design

Date: 2026-10-17
Status: approved in conversation
Builds on: `2026-10-17-assistant-observation-drafts-design.md` (adds)

## Goal

The assistant can propose any change to observations the user asks for —
**add, edit, delete** — and nothing changes until the user confirms on a card
in the chat. Adds already work (draft card, Save). This adds edit and delete.

## Decisions (from the conversation)

- **Propose, then confirm.** Model never writes. Edit cards apply with
  **Apply**; delete cards need **two clicks**: **Delete** turns into
  **Confirm delete**, and only the second click deletes. The confirm state
  resets after 5 seconds or when focus leaves the button.
- **One card per entry.** "Delete those three duplicates" → three cards.
- **Saved add cards can now be changed**: a follow-up on an entry saved from a
  card in this chat produces an edit card for that entry (reverses the earlier
  "no editing after save").
- **Stale guard.** A card records the entry's `updatedAt`. Apply/Delete refuse
  if the entry changed since ("This entry changed after the card was made. Ask
  the assistant again.").
- **Edits show only changed fields**, old → new. Changing severity makes it
  stated (drops the `severity-estimated` tag); untouched severity stays as is.
- Every card can still be revised in chat while unapplied, and discarded.

## Design

### Card model (`lib/observation-cards.ts`, pure)
- `ObservationValues` = date, time, type, severity (1–5 or null — existing
  entries may have none), durationMinutes, notes, tags[], conditionId.
- `EntryRef` = observationId, updatedAt (ISO), personId, personName,
  attachments (count), before: ObservationValues.
- `EditCard {kind:"edit", id, target, after, state, error?}`,
  `DeleteCard {kind:"delete", id, target, state, error?}`; `ChatCard =
  DraftCard | EditCard | DeleteCard`. States reuse `draft | saved | discarded`
  (saved = applied/deleted). Old stored cards (no `kind`) load as adds.
- Helpers: `cardId`, `cardSubject` (a revision must keep it), `changedFields`,
  `valuesToForm`, `changeSummaryLine`, `cardSummaryLine`, `isChatCard`.
- Saved add cards' summary line names the entry id and says to use
  `propose_observation_edit` to change it.

### Tools (health-only)
- `propose_observation_edit(observationId, changes…, clear?, proposalId?)` —
  loads the entry, applies only the given changes, validates with
  `observationSchema`, refuses "nothing would change", emits a `change` event.
- `propose_observation_delete(observationId, proposalId?)` — loads, emits.
- Unknown id → "use observation_log to find it". Health off → absent/refuses.

### Server actions (`lib/actions/health.ts`)
- `applyObservationEdit(id, values, expectedUpdatedAt)` and
  `deleteObservationIfUnchanged(id, expectedUpdatedAt)`: session required;
  atomic `updateMany`/`deleteMany` filtered by `id` + `updatedAt`; count 0 →
  stale error; delete removes the upload dir like `deleteObservation`.

### Transport, storage, UI
- `AgentEvent` gains `{type:"change"; card: ChangeCard}`.
- Thread storage, merge, update, summaries and Health-off stripping work over
  `ChatCard` by `cardId`.
- `observation-change-card.tsx`: edit diff rows + Apply/Discard; delete card
  with the whole entry, attachment note, two-click Delete; locked states show
  "Applied · Open entry" / "Deleted".

## Testing
Pure helpers, both tools (unknown id, Health off, nothing-changes, severity
→ stated, clear fields, emit once), both actions (success, stale, not found,
validation), thread storage over mixed cards (legacy load, revision in place,
subject change = new card), Health-off stripping of edit/delete lines,
model-test cases for edit and delete.
