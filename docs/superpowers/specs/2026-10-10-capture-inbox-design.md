# Capture inbox (F6 / M3) — design

Date: 2026-10-10. Spike result (F6): deterministic parser 71% date+total on 31 real receipts
(~85% excluding answer-key mismatches); local LLM on extracted text 77% raw (~92% adjusted),
vendor 92%; LLM on page images slower and worse. Gate passed → build with auto-fill.

## Goal
Drop or photograph a receipt/invoice without choosing a record first. HomeCenter extracts
text, proposes date, total, vendor and asset, and the user confirms in one step.

## Scope (v1)
- `/inbox` page: drop zone + file picker (`accept`, `capture` on mobile), list of items.
- Auto-fill with a setting **Receipt reading: Off / Basic / Local AI** (default Basic).
  Local AI uses the configured LLM on extracted text; falls back to Basic when the LLM
  is disabled or errors. No page-image (vision) mode.
- Asset suggestion by identifier match (vehicle VIN/plate/make+model, property address,
  equipment model/serial/name) against extracted text.
- Actions per item: **Create service record** (asset, date, title, cost, vendor, optional
  reminder to complete via the F1 loop), **Keep as asset document**, **Discard**.
- Sidebar "Inbox" item with a count badge.

Deferred: attach to an existing record, `.eml`/`.msg` drop, `entity_vec` asset suggestion,
fixture-accuracy CI.

## Data
- `AttachmentRecordType` gains `INBOX`.
- New model `InboxItem { id, createdAt, createdById, status (PENDING|READY|FAILED),
  parsedDate?, parsedTotal?, parsedVendor?, parseMethod?, suggestedAssetType?,
  suggestedAssetId?, error? }`; `Attachment.inboxItemId` nullable FK, cascade.
- `DocumentSettings.captureParser` enum `OFF|BASIC|LLM`, default `BASIC`.
- Files live at `uploads/inbox/<itemId>/<uuid>.<ext>`; `attachmentDir()` knows INBOX so the
  indexer's reconcile keeps them. Filing moves the file into the target dir and rewrites the
  attachment's recordType/FK in one step (rename back if the DB write fails).

## Flow
1. Client: `createInboxItem()` → id; `uploadFile(file, "INBOX", id)` (existing route).
2. Indexer extracts text as for any attachment. After an INBOX attachment is indexed, a hook
   runs the parser (setting-dependent) and the asset matcher, saves fields, status READY
   (FAILED with message on extraction failure; user can still file manually).
3. `/inbox` refreshes while any item is PENDING.
4. File / keep / discard via server actions; filing reuses `createServiceRecord` logic,
   including `scheduleCompletionWrites`.

## Privacy
Text goes only to the household's configured LLM endpoint and only when the setting is
Local AI and the LLM is enabled. Items whose suggested asset is a PERSON skip the LLM
unless `healthDocumentsEnabled`.

## Testing
TDD on pure modules (`lib/capture/parse.ts`, `lib/capture/match.ts`,
`lib/capture/llm-parse.ts` response handling, file-move planning). Server actions verified
with a scratch-DB repro script (not in the repo suite, which is pure-logic only).
