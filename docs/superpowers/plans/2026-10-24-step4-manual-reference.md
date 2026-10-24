# Step 4: Manual reference on a reminder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A maintenance reminder can point at a file already filed on its asset (or attached to the reminder) plus a page number, and shows a "Manual, p. 42" link that opens the PDF at that page.

**Architecture:** Two nullable columns on `MaintenanceSchedule` (`referenceAttachmentId` with a `SetNull` foreign key to `Attachment`, and `referencePage`). One new pure module, `lib/manual-reference.ts`, holds every rule: which files a reminder may link, the file URL with `#page=N`, the labels and the input cleanup. A second pure module, `lib/manual-page.ts`, holds the "Find page" word match. A small server module loads the pickable files for an asset page and checks a posted reference. The form, the reminder rows, the complete dialog, the assistant, the readable export and the demo seed call into these.

**Tech Stack:** Next.js 16 (app router, server actions), Prisma 7 + SQLite/libSQL, zod, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-cost-planning-and-insurance-design.md`, section "Step 4: Manual reference on a reminder" (plus Goals, Anti-goals, Constraints).

## Decisions (check these)

Calls the spec left open, made here so the executor doesn't have to. Change any of them before execution starts.

1. **Which files can be picked.** DOCUMENT files whose `assetType`/`assetId` equal the reminder's, plus files attached to this reminder (`recordType` MAINTENANCE, `maintenanceScheduleId` = this reminder). A property reminder can't pick a manual filed on one of its equipment items, and the reverse. That is what the spec says ("same asset or this schedule"). Service, warranty, room, inbox and health record files are never pickable.
2. **New reminders.** Only the asset's documents are offered. Files staged in the same dialog can be picked after the first save, when they have become the reminder's own files.
3. **Any file type can be linked.** `#page=N` is added only when the stored filename ends in `.pdf` (any case). That's the rule the file route uses to serve `application/pdf` inline; the stored `mimeType` comes from the browser and isn't trusted for this.
4. **Page number.** Optional, a whole number from 1 to 9999. It isn't checked against the file's page count, because extracted text can be missing or truncated. A page sent without a file is saved as null.
5. **Deleting the file.** The foreign key is `onDelete: SetNull`, so every delete path (Documents tab, the reminder's own file list, asset delete, reminder delete) clears the link at the database level. `referencePage` is left in the row; nothing shows it without a file, and the next save of the form writes null. No trigger.
6. **Health off.** A person reminder can't be given a manual link, and "Find page" refuses person files. The loader returns no person files. Person pages are already blocked with Health off, and the file route already refuses `document/<personId>` paths.
7. **Where the link shows.** On reminder rows of the four asset pages (`maintenance-list.tsx`) and in the complete dialog opened from those rows. Not on `/maintenance`, the notifications page, the bell or the dashboard. The dashboard is off limits, and the other three would need the manual files loaded on pages that don't load them today.
8. **Empty stays empty.** The Manual row in the form only appears when there's at least one file to pick. The "Plan replacement" dialog (step 2) passes no files, so it shows no Manual row.
9. **Assistant.** `referenceAttachmentId` becomes a key and `referencePage` a field on `maintenanceSchedule`, described so the assistant can call `read_document(attachmentId, fromPage)`. `read_document` already hides health and room files. The `maintenance_status` tool doesn't change.
10. **Restore.** A backup is a whole-database `VACUUM INTO` copy (`lib/backup/snapshot.ts` `vacuumInto`) and restore swaps the database file, so table order and foreign keys during restore don't matter and `lib/backup/restore.ts` doesn't change. An older backup gets the new columns from the migration at boot; the existing test "accepts an older-schema backup" covers that automatically (it uses the second-newest migration).
11. **"Find page"** is the last task's last piece and can be cut on its own (Task 5 Step 5 and the `suggestManualPage` action) without touching the rest.

Open question for the user (default used if no answer): should a property reminder also be able to pick manuals filed on that property's equipment? Default: no, per the spec.

## Global Constraints

- Don't touch `app/(app)/page.tsx` or `components/dashboard/*`. `components/maintenance/complete-dialog.tsx` is used by `components/dashboard/reminder-row.tsx` through `reminder-actions.tsx`; the new prop is optional so those callers compile and behave as before.
- **The executor doesn't commit, push, `git add`, `stash` or `checkout` unless the user asks.** Each task ends with a commit step written out for when the user does ask; until then treat it as a checkpoint and leave everything uncommitted.
- Read the relevant guide in `node_modules/next/dist/docs/01-app/01-getting-started/` before writing page, client component or server action code (`05-server-and-client-components.md`, `07-mutating-data.md`).
- Read `prisma/schema.prisma` before data changes. Migrations go through `npx prisma migrate dev` and live in `prisma/migrations/YYYYMMDDHHMMSS_snake_name/`. After migrating, **also run `npx prisma generate`**; `tsc` fails without it.
- New logic goes in pure functions with Vitest tests beside them. Vitest only picks up `lib/**/*.test.ts`. There are no component tests, so components and server modules stay thin.
- `lib/manual-reference.ts` is imported by `lib/backup/readable.ts`, an engine file. It must have **no imports at all**, must be added to `helpers` in `lib/backup/import-rules.test.ts`, and needs `COPY --from=builder /app/lib/manual-reference.ts ./lib/manual-reference.ts` in the `Dockerfile` after the `lib/equipment-value.ts` line (:71). `import-rules.test.ts` fails without both.
- In react-hook-form components use `useWatch`, never `form.watch`. Don't add new `form.watch` calls; leave the existing ones in `maintenance-form-dialog.tsx` alone.
- The repo has exactly 8 pre-existing eslint warnings. No new ones.
- Never run `npm run db:seed:demo`. It wipes the dev DB. Type-check the seed only.
- Shell heredocs with quotes or apostrophes break in this environment. Use the Edit tool, or write a script to the scratchpad and run it.
- No browser tool is available. UI tasks end with a manual-verification list for the user, and the executor says it did **not** check in a browser.
- A task is done when `npx vitest run`, `npx eslint .` (0 errors, 8 warnings) and `npx tsc --noEmit` all pass.
- Three asset detail pages (repo CLAUDE.md), plus equipment: all four render `MaintenanceList`, so Task 6 changes all four in the same way.

## Review Focus

1. **The manual file is deleted.** The user removes the furnace manual from the Documents tab. The reminder stays, its link disappears, nothing errors, and the edit form shows "None". Task 3 tests the database `SET NULL` with foreign keys on; Task 1 tests that `resolveManual` returns null for an id that's no longer in the options.
2. **The reminder's target changes.** On a property page, a reminder for the property with a property manual picked is switched to the furnace in the "For" select. The pick clears in the form, and a stale id posted anyway is refused with a message instead of saving a link to another asset's file. Task 1 tests `referenceAllowed` for a document on another asset and for a same-id different-type asset; Task 5 clears the field.
3. **PDF detection.** `MANUAL.PDF` gets `#page=4`. `scan.jpg` with page 4 links without a fragment but still reads "Manual, p. 4". A PDF with no page links without a fragment. Task 1 tests these.
4. **Page input.** `"0"`, `"-1"`, `"2.5"`, `"abc"`, `"1e3"` and `"10000"` are refused with "Page must be a whole number from 1 to 9999." `""` saves null. `" 7 "` saves 7. Task 1 tests these.
5. **Health off.** Linking a person reminder to a file, or asking for "Find page" on a person's file, is refused on the server. Task 1 tests `referenceAllowed(..., health: false)`; Task 4 wires it into both actions.

---

### Task 1: Pure reference rules

**Files:**
- Create: `lib/manual-reference.ts`
- Test: `lib/manual-reference.test.ts`

**Interfaces:**
- Produces (no imports in this file):

```ts
export const MAX_REFERENCE_PAGE = 9999
export type ManualOption = {
  id: string
  name: string                     // Attachment.originalName
  filename: string                 // UUID name on disk
  recordType: "DOCUMENT" | "MAINTENANCE"
  assetType: string | null         // DOCUMENT: the asset it's filed on
  assetId: string | null
  maintenanceScheduleId: string | null
  hasText: boolean                 // AttachmentText DONE with charCount > 0
}
export type ReferenceTarget = { assetType: string; assetId: string }
export type ReferenceFields = { referenceAttachmentId: string | null; referencePage: number | null }
export function isPdfFile(filename: string): boolean
export function manualFileHref(o: Pick<ManualOption, "recordType" | "assetId" | "maintenanceScheduleId" | "filename">, page: number | null): string | null
export function manualLabel(page: number | null): string
export function manualText(name: string, page: number | null): string
export function referenceAllowed(
  a: { recordType: string; assetType: string | null; assetId: string | null; maintenanceScheduleId: string | null },
  target: ReferenceTarget, scheduleId: string | null, health: boolean,
): boolean
export function manualChoices(options: ManualOption[], target: ReferenceTarget, scheduleId: string | null): ManualOption[]
export function resolveManual(s: ReferenceFields, options: ManualOption[]): { href: string; label: string; title: string } | null
export function cleanReference(v: { attachmentId?: string; page?: string | number }):
  | { ok: true; value: ReferenceFields | undefined }
  | { ok: false; error: string }
```

- [ ] **Step 1: Write failing tests** in `describe("manual reference")`. Use a `doc(overrides)` helper returning a DOCUMENT option `{ id: "a1", name: "Furnace manual.pdf", filename: "f1.pdf", recordType: "DOCUMENT", assetType: "EQUIPMENT", assetId: "e1", maintenanceScheduleId: null, hasText: true }` and an `own(overrides)` helper returning a MAINTENANCE option on schedule `"s1"` with `assetType: null, assetId: null`.
  - `it("detects PDFs by file extension")`: `isPdfFile("f1.pdf")` → true, `"MANUAL.PDF"` → true, `"scan.jpg"` → false, `"pdf"` → false.
  - `it("builds the file URL and adds #page only for PDFs")`:
    - `manualFileHref(doc(), 42)` → `"/api/files/document/e1/f1.pdf#page=42"`.
    - `manualFileHref(own({ filename: "m.PDF" }), 3)` → `"/api/files/maintenance/s1/m.PDF#page=3"`.
    - `manualFileHref(doc({ filename: "scan.jpg" }), 4)` → `"/api/files/document/e1/scan.jpg"`.
    - `manualFileHref(doc(), null)` → `"/api/files/document/e1/f1.pdf"`.
    - `manualFileHref(doc({ assetId: null }), 1)` → `null`. `manualFileHref(own({ maintenanceScheduleId: null }), 1)` → `null`.
  - `it("labels the link")`: `manualLabel(42)` → `"Manual, p. 42"`, `manualLabel(null)` → `"Manual"`. `manualText("Furnace manual.pdf", 42)` → `"Furnace manual.pdf, p. 42"`, `manualText("Furnace manual.pdf", null)` → `"Furnace manual.pdf"`.
  - `it("allows only the reminder's own asset documents and its own files")`, target `{ assetType: "EQUIPMENT", assetId: "e1" }`:
    - `doc()` with scheduleId `null` → true.
    - `doc({ assetId: "e2" })` → false. `doc({ assetType: "PROPERTY" })` → false.
    - `own()` with scheduleId `"s1"` → true; with `"s2"` → false; with `null` → false.
    - `{ recordType: "SERVICE", assetType: null, assetId: null, maintenanceScheduleId: null }` → false. Same for `"ROOM"` and `"CONDITION"`.
  - `it("refuses a person's files while Health is off")`: target `{ assetType: "PERSON", assetId: "h1" }`, `doc({ assetType: "PERSON", assetId: "h1" })` → true with `health: true`, false with `health: false`. An `own()` file on a person reminder with `health: false` → false. An equipment `doc()` with `health: false` → true.
  - `it("lists the choices for a target, sorted by name")`: options `[doc({ id: "a2", name: "Warranty card.pdf" }), doc({ id: "a1", name: "Owner manual.pdf" }), doc({ id: "a3", assetId: "e2" }), own({ id: "a4", name: "Filter sizes.jpg" })]`, target e1, scheduleId `"s1"` → ids `["a4", "a1", "a2"]`. With scheduleId `null` → `["a1", "a2"]`.
  - `it("resolves a reminder's manual link")`: `resolveManual({ referenceAttachmentId: "a1", referencePage: 42 }, [doc()])` → `{ href: "/api/files/document/e1/f1.pdf#page=42", label: "Manual, p. 42", title: "Furnace manual.pdf, p. 42" }`. Id `"gone"` → null. `referenceAttachmentId: null` with a page → null.
  - `it("cleans the posted reference")`:
    - `cleanReference({})` → `{ ok: true, value: undefined }` (not sent: leave the row alone).
    - `{ attachmentId: "", page: "5" }` → `{ ok: true, value: { referenceAttachmentId: null, referencePage: null } }`.
    - `{ attachmentId: "a1", page: "" }` → page null. `{ attachmentId: "a1" }` → page null. `{ attachmentId: "a1", page: " 7 " }` → 7. `{ attachmentId: "a1", page: 12 }` → 12. `"9999"` → 9999.
    - Each of `"0"`, `"-1"`, `"2.5"`, `"abc"`, `"1e3"`, `"10000"`, `0`, `1.5` → `{ ok: false, error: "Page must be a whole number from 1 to 9999." }`.
- [ ] **Step 2: Run** `npx vitest run lib/manual-reference.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions above. Notes where the signature leaves a choice:
  - `isPdfFile`: `/\.pdf$/i`.
  - `manualFileHref`: DOCUMENT uses `document/${assetId}`, MAINTENANCE uses `maintenance/${maintenanceScheduleId}`, matching `lib/attachment-location.ts` `attachmentDir`. It's written out here rather than imported so the file stays import-free.
  - `cleanReference`: a page string is trimmed and must match `/^\d+$/` before `Number()`; a number must be an integer. Then 1 ≤ page ≤ `MAX_REFERENCE_PAGE`.
  - `manualChoices` calls `referenceAllowed(o, target, scheduleId, true)`; the loader already drops person files when Health is off. Sort with `localeCompare`.
  - File comment: "Imported by the backup engine (lib/backup/readable.ts): keep this file free of imports."
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** (only if the user asked for commits): `git add lib/manual-reference.ts lib/manual-reference.test.ts && git commit -m "Add the rules for linking a reminder to a manual page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 2: "Find page" word match

**Files:**
- Create: `lib/manual-page.ts`
- Test: `lib/manual-page.test.ts`

**Interfaces:**
- Consumes: `splitPages` from `lib/documents/normalize.ts` (pages are joined with `"\f"`).
- Produces:
  - `titleWords(title: string): string[]`: lowercase, split on anything that isn't a letter or digit (`/[^\p{L}\p{N}]+/u`), keep words of 3+ characters, drop `the, and, for, with, from, into, your, this, that`, fold a trailing `s` off words longer than 3, unique, in order.
  - `findManualPage(text: string, title: string): number | null`: the 1-based number of the first page containing the most distinct title words (page words folded the same way). Null when no page has any, the text is empty, or the title has no usable words.

- [ ] **Step 1: Write failing tests:**
  - `titleWords("Replace the furnace filters")` → `["replace", "furnace", "filter"]`. `titleWords("Do it")` → `[]`. `titleWords("A/C service")` → `["service"]`.
  - `findManualPage("Intro\fChanging the air filter\fFurnace filter: step by step", "Replace furnace filter")` → `3`.
  - Ties go to the first page: `findManualPage("filter here\ffilter there", "Filter")` → `1`.
  - Repeats don't count twice: `findManualPage("filter filter filter\ffurnace filter", "Furnace filter")` → `2`.
  - Case, punctuation and plurals: `findManualPage("Safety\fFURNACE-FILTERS", "Replace furnace filter")` → `2`.
  - No match → `null`. Empty text → `null`. Title `"Do it"` → `null`.
- [ ] **Step 2: Run** `npx vitest run lib/manual-page.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** (only if asked): `git add lib/manual-page.ts lib/manual-page.test.ts && git commit -m "Find the manual page that best matches a reminder title" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 3: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`model MaintenanceSchedule` :551, `model Attachment` :589)
- Create: `prisma/migrations/<timestamp>_maintenance_manual_reference/migration.sql` (generated)
- Test: `lib/backup/snapshot.test.ts`

**Interfaces:**
- Produces: `MaintenanceSchedule.referenceAttachmentId String?`, `MaintenanceSchedule.referencePage Int?`, relation field `referenceAttachment`, back relation `Attachment.referencedBySchedules`.

- [ ] **Step 1: Schema.** Two relations now join `MaintenanceSchedule` and `Attachment`, so Prisma needs both named:
  - Existing: `attachments Attachment[] @relation("ScheduleAttachments")` on the schedule and `maintenanceSchedule MaintenanceSchedule? @relation("ScheduleAttachments", fields: [maintenanceScheduleId], references: [id], onDelete: Cascade)` on `Attachment`. Naming changes no SQL.
  - New, after `dueDay` on the schedule:
    - `/// A manual (or any file) to open when doing this: a DOCUMENT on the same asset or a file on this reminder. Cleared when the file is deleted.` `referenceAttachmentId String?` and `referenceAttachment Attachment? @relation("ScheduleManual", fields: [referenceAttachmentId], references: [id], onDelete: SetNull)`.
    - `/// Page of that file, from 1. Ignored without a file.` `referencePage Int?`.
    - `@@index([referenceAttachmentId])`.
  - On `Attachment`, after `text`: `referencedBySchedules MaintenanceSchedule[] @relation("ScheduleManual")`.
- [ ] **Step 2: Migrate.** Run `npx prisma migrate dev --create-only --name maintenance_manual_reference`. Read the SQL. SQLite may rebuild `MaintenanceSchedule` (`CREATE TABLE "new_MaintenanceSchedule"`, `INSERT INTO ... SELECT`, `DROP`, `RENAME`). That's fine if the `INSERT ... SELECT` lists every existing column, including `estimatedCost`, `dueMonths`, `dueDay`, `snoozedUntil` and `roomId`. It must not touch any other table. Then run `npx prisma migrate dev`, then `npx prisma generate`.
- [ ] **Step 3: Write the test** in `snapshot.test.ts`: `it("keeps reminders through the manual reference migration and clears the link when the file goes")`.
  - `createMigratedDb(db, { upTo: "20261024154941_equipment_value_and_lifespan" })`. Insert a user, a property `p1`, a schedule `m1` on `p1` with `estimatedCost 85`, `dueMonths '10'`, `dueDay 15`, and a DOCUMENT attachment `d1` on `p1` (`assetType 'PROPERTY'`, `assetId 'p1'`).
  - Find the new migration folder (name ends `_maintenance_manual_reference`) under `prisma/migrations` and `executeMultiple` its `migration.sql`.
  - `SELECT` `m1`: `estimatedCost` 85, `dueMonths` `"10"`, `dueDay` 15, `referenceAttachmentId` null, `referencePage` null.
  - `UPDATE` `m1` to `referenceAttachmentId 'd1'`, `referencePage 3`. Then `PRAGMA foreign_keys = ON; DELETE FROM "Attachment" WHERE id = 'd1'`. `m1.referenceAttachmentId` is null; the row still exists.
- [ ] **Step 4: Run** `npx vitest run lib/backup/snapshot.test.ts lib/backup/restore.test.ts`. Expected: PASS ("accepts an older-schema backup" now restores a step-3-era backup).
- [ ] **Step 5: Checkpoint.** `npx tsc --noEmit` passes. If it flags test fixtures typed as a full `MaintenanceSchedule`, add `referenceAttachmentId: null, referencePage: null` to them, nothing else.
- [ ] **Step 6: Commit** (only if asked): `git add prisma/schema.prisma prisma/migrations lib/backup/snapshot.test.ts && git commit -m "Reminders can store a manual file and page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 4: Server side: loader, reference check, actions

**Files:**
- Create: `lib/manual-reference-server.ts`
- Modify: `lib/actions/maintenance.ts` (`schema` :18, `createMaintenanceSchedule` :78, `updateMaintenanceSchedule` :94, new action at the end)

**Interfaces:**
- Consumes: `referenceAllowed`, `cleanReference`, `type ManualOption`, `type ReferenceFields` (Task 1); `findManualPage` (Task 2); `loadFeatures` (`lib/features-server.ts`).
- Produces:

```ts
// lib/manual-reference-server.ts
/// DOCUMENT files on these assets plus files on their reminders. Person targets drop out while Health is off.
export async function loadManualOptions(targets: { assetType: AssetType; assetId: string }[]): Promise<ManualOption[]>
/// undefined in = leave the row's reference alone.
export async function checkReference(
  ref: ReferenceFields | undefined, target: { assetType: AssetType; assetId: string }, scheduleId: string | null,
): Promise<{ value: ReferenceFields | undefined } | { error: string }>

// lib/actions/maintenance.ts
export async function suggestManualPage(input: {
  attachmentId: string; assetType: AssetType; assetId: string; scheduleId: string | null; title: string
}): Promise<{ page: number | null } | { error: string }>
```

- [ ] **Step 1: Read** `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`.
- [ ] **Step 2: `loadManualOptions`.** One `prisma.attachment.findMany`, `where: { OR: targets.flatMap((t) => [{ recordType: "DOCUMENT", assetType: t.assetType, assetId: t.assetId }, { recordType: "MAINTENANCE", maintenanceSchedule: { assetType: t.assetType, assetId: t.assetId } }]) }`, selecting the `ManualOption` fields plus `text: { select: { status: true, charCount: true } }`. Map `name` from `originalName` and `hasText` from `status === "DONE" && (charCount ?? 0) > 0`. Return `[]` for an empty target list.
- [ ] **Step 3: `checkReference`.** Return `{ value: undefined }` for `undefined`, and `{ value: ref }` when `ref.referenceAttachmentId` is null. Otherwise load the attachment (`recordType`, `assetType`, `assetId`, `maintenanceScheduleId`) and `loadFeatures()`. Missing, or `referenceAllowed(...)` false → `{ error: "Pick a file from this item's documents or this reminder's files." }`.
- [ ] **Step 4: Actions.**
  - Add `referenceAttachmentId: z.string().optional()` and `referencePage: z.string().or(z.number()).optional()` to `schema`.
  - In create and update, after the room check: `const cleaned = cleanReference({ attachmentId: v.referenceAttachmentId, page: v.referencePage })`. Not ok → `{ error: { referencePage: [cleaned.error] } }`. Then `checkReference(cleaned.value, { assetType, assetId }, id-or-null)`; error → `{ error: { referenceAttachmentId: [error] } }`. Spread `...(value ?? {})` into the `data` next to `roomId`. `clean()` doesn't change.
  - `suggestManualPage`: `auth()` as the other actions. Load the attachment with its location fields and `text: { select: { status: true, text: true } }`, plus `loadFeatures()`. Missing, or `referenceAllowed(row, { assetType, assetId }, scheduleId, features.health)` false → `{ error: "Not found" }`. That keeps it from reading text of files the reminder couldn't link, health files included. No text, or status not DONE → `{ page: null }`. Otherwise `{ page: findManualPage(text, title) }`. It returns a number only, never text.
- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass.
- [ ] **Step 6: Commit** (only if asked): `git add lib/manual-reference-server.ts lib/actions/maintenance.ts && git commit -m "Check and save a reminder's manual reference on the server" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 5: Manual picker in the reminder form

**Files:**
- Modify: `components/maintenance/maintenance-form-dialog.tsx` (`schema` :26, `Props` :63, both `form.reset` branches :129–151, the "For" select :259, `handleDeleteExisting` :168, `onSubmit` :178, a new row before Notes :435)

**Interfaces:**
- Consumes: `manualChoices`, `type ManualOption` (Task 1); `suggestManualPage` (Task 4).
- Produces: prop `manualOptions?: ManualOption[]`. Missing means "this caller doesn't offer manuals": the row is hidden and the payload sends `referenceAttachmentId: undefined`, so an edit keeps the stored link (same rule as `roomId`).

- [ ] **Step 1: Read** `05-server-and-client-components.md`.
- [ ] **Step 2: Form state.** Add `referenceAttachmentId: z.string().optional()` and `referencePage: z.string().optional()` to the zod schema, `""` defaults in `defaultValues` and the new-schedule reset, and in the edit reset `schedule.referenceAttachmentId ?? ""` and `schedule.referencePage?.toString() ?? ""`.
  - Watch with one `useWatch({ control: form.control, name: ["assetType", "assetId", "referenceAttachmentId", "title"] })`.
  - `const choices = manualChoices(manualOptions ?? [], { assetType, assetId }, schedule?.id ?? createdScheduleId)`. A stored id not in `choices` shows as None.
- [ ] **Step 3: Clearing.** In the "For" select's `onValueChange`, also `setValue("referenceAttachmentId", "")` and `setValue("referencePage", "")`. In `handleDeleteExisting`, clear both when the removed file is the picked one.
- [ ] **Step 4: The row.** Render only when `choices.length > 0`, as a `col-span-2` block before Notes, labelled "Manual":
  - A Select with a `NO_MANUAL = "__none__"` sentinel mapped to `""` (Base UI Select has no empty option, same as `NO_PROPERTY`). Options: "None", then each choice's `name`. Picking None also clears the page.
  - When a file is picked: a "Page" input (`type="number" min={1} max={9999} step={1}`, placeholder `42`, `w-24`).
  - Payload: `referenceAttachmentId: manualOptions ? values.referenceAttachmentId : undefined`, `referencePage: manualOptions ? values.referencePage : undefined`.
  - Error toast: add `"referenceAttachmentId" in result.error ? ... : undefined` and the same for `referencePage` to the existing `roomError ?? monthsError` chain.
- [ ] **Step 5: "Find page"** (cuttable). Next to the page input, shown when the picked choice has `hasText`: an outline `sm` button "Find page", disabled while pending or while the title is blank. It calls `suggestManualPage({ attachmentId, assetType, assetId, scheduleId: schedule?.id ?? createdScheduleId, title })`. A page sets `referencePage` with `shouldDirty: true` and toasts `Found on page ${page}.`. `{ page: null }` toasts "No page mentions this title. Type the page instead." An error toasts "Couldn't search this file."
- [ ] **Step 6: Checkpoint.** `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass.
- [ ] **Step 7: Commit** (only if asked): `git add components/maintenance/maintenance-form-dialog.tsx && git commit -m "Pick a manual and page when editing a reminder" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 6: Show the link on reminder rows and in the complete dialog

**Files:**
- Modify: `components/maintenance/maintenance-list.tsx` (`Props` :41, title cell :187–193, `<MaintenanceFormDialog>` :295, `<CompleteDialog>` :309)
- Modify: `components/maintenance/complete-dialog.tsx` (props :18, under the header :64)
- Modify: `app/(app)/assets/properties/[id]/page.tsx` (:52 equipment round, :147), `app/(app)/assets/vehicles/[id]/page.tsx` (:29, :103), `app/(app)/assets/equipment/[id]/page.tsx` (:37, :132), `app/(app)/assets/people/[id]/page.tsx` (:64, :178)

**Interfaces:**
- Consumes: `resolveManual`, `type ManualOption` (Task 1); `loadManualOptions` (Task 4); `manualOptions` prop (Task 5).
- Produces: `MaintenanceList` prop `manualOptions?: ManualOption[]`. `CompleteDialog` prop `manual?: { href: string; label: string; title: string } | null`.

- [ ] **Step 1: Pages.** Add `loadManualOptions(...)` to each page's existing `Promise.all`:
  - Vehicle: `[{ assetType: "VEHICLE", assetId: id }]`. Equipment: `[{ assetType: "EQUIPMENT", assetId: id }]`. Person: `[{ assetType: "PERSON", assetId: id }]`.
  - Property: in the second round (equipment ids are known only after the first), `loadManualOptions([{ assetType: "PROPERTY", assetId: id }, ...equipmentIds.map((e) => ({ assetType: "EQUIPMENT" as const, assetId: e }))])`, run even when `equipmentIds` is empty.
  - Pass `manualOptions={manualOptions}` to `MaintenanceList`. Leave the existing `documents` queries alone; they feed the Documents tab.
- [ ] **Step 2: Rows.** In `MaintenanceList`, `const manual = resolveManual(s, manualOptions ?? [])` per row. When set, under the "Est." line in the title cell: an `<a href={manual.href} target="_blank" rel="noopener noreferrer" title={manual.title}>` with a `BookOpen` icon (`h-3 w-3`) and `manual.label`, `text-xs text-muted-foreground hover:underline`, with `onClick={(e) => e.stopPropagation()}` so it doesn't open the edit form. Pass `manualOptions` through to `MaintenanceFormDialog`.
- [ ] **Step 3: Complete dialog.** `MaintenanceList` passes `manual={resolveManual(completing, manualOptions ?? [])}`. `CompleteDialog` renders the same link under the header when `manual` is set. Callers that don't pass it (`reminder-actions.tsx`, `notification-bell.tsx`) are unchanged.
- [ ] **Step 4: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass. `git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing.
- [ ] **Step 5: Manual verification list for the user** (the executor says it didn't run a browser):
  - Equipment page with a PDF in Documents: edit a reminder, pick it under Manual, type 3, save. The row shows "Manual, p. 3"; clicking it opens the PDF at page 3 in a new tab and doesn't open the edit form.
  - Complete from that row: the dialog shows the same link.
  - An image picked with page 2 shows "Manual, p. 2" and opens the image.
  - Delete the PDF from the Documents tab: the link is gone, and the edit form shows None.
  - A vehicle, a property and a person (Health on) behave the same. On a property, switch a reminder's "For" from the property to an equipment item: the Manual pick resets, and only that item's documents are listed.
  - An asset with no documents and a reminder with no files: no Manual row in the form.
  - "Find page" appears only for files with extracted text and fills in a page for a matching title.
- [ ] **Step 6: Commit** (only if asked): `git add components/maintenance "app/(app)/assets" && git commit -m "Reminder rows link to their manual page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 7: Assistant, export, docs, demo data and testing checklist

**Files:**
- Modify: `lib/llm/ontology.ts` (`maintenanceSchedule` :196)
- Modify: `lib/backup/readable.ts` (imports :4–5, `PublicReminder` :19, reminders :189, `reminders.csv` columns :263)
- Modify: `lib/backup/import-rules.test.ts` (`helpers` :12), `Dockerfile` (after :71)
- Modify: `docs/export-format.md` (:56, :71)
- Modify: `prisma/seed-demo.ts` (`receiptPdf` :323, `MAINTENANCE` type :541 and the "Replace furnace filter" entry :551, the creation loop :742)
- Modify: `TESTING-CHECKLIST.md` (untracked, temporary; read it first)
- Test: `lib/llm/ontology.test.ts`, `lib/backup/readable.test.ts`

**Interfaces:**
- Consumes: `manualText` (Task 1).
- Produces: `PublicReminder.manual: string | null`; a `manual` column in `reminders.csv` after `estimatedCost`.

- [ ] **Step 1: Write failing tests.**
  - `ontology.test.ts`, `it("lets the assistant open a reminder's manual page")`: `ENTITIES.maintenanceSchedule.keys` contains `"referenceAttachmentId"`; `fields.referencePage.type` is `"int"`; `fields.referencePage.description` matches `/read_document/`.
  - `readable.test.ts`, `it("reminders: manual names the file and page")`, using `snap()` like the equipment test. Insert DOCUMENT `d1` on `v1` (`'Owner manual.pdf'`) and reminders `m1` (`referenceAttachmentId 'd1'`, `referencePage 42`), `m2` (`'d1'`, NULL page) and `m3` (no reference) on `v1`. Expect `manual` `"Owner manual.pdf, p. 42"`, `"Owner manual.pdf"` and `null`; `csvTables(data)["reminders.csv"]` header contains `estimatedCost,manual,`.
  - Run `npx vitest run lib/llm/ontology.test.ts lib/backup/readable.test.ts`. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - Ontology: add `"referenceAttachmentId"` to `keys`. Add `referencePage: { type: "int", description: "Page of the reminder's linked manual. To read it, call read_document with attachmentId = referenceAttachmentId and fromPage = referencePage." }`.
  - `readable.ts`: `import { manualText } from "../manual-reference"` (relative). In each reminder, `const ref = attachments.find((a) => a.id === r.referenceAttachmentId)` and `manual: ref ? manualText(String(ref.originalName), num(r.referencePage)) : null`.
  - Add `"lib/manual-reference.ts"` to `helpers`, and `COPY --from=builder /app/lib/manual-reference.ts ./lib/manual-reference.ts` to the `Dockerfile` after the `equipment-value.ts` line.
  - `docs/export-format.md`: add `manual` (file name and page, for example "Owner manual.pdf, p. 42") after `estimatedCost` in the `reminders.json` bullet and the `reminders.csv` row.
- [ ] **Step 3: Run** `npx vitest run lib/llm/ontology.test.ts lib/backup/readable.test.ts lib/backup/import-rules.test.ts`. Expected: PASS.
- [ ] **Step 4: Demo seed.** Turn `receiptPdf(lines)` into `pdfPages(pages: string[][])` (one `/Page` object and content stream per page, `/Count pages.length`) and keep `receiptPdf = (lines) => pdfPages([lines])`. Before the `MAINTENANCE` loop, write a 3-page "Carrier 59SC5A owner's manual.pdf" as a DOCUMENT on the Gas Furnace (`E(6)`): page 1 "Safety", page 2 "Thermostat settings", page 3 "Replacing the air filter" with a few lines about the 16x25x4 filter. Add `manualPage?: number` to the `MAINTENANCE` type, set `manualPage: 3` on "Replace furnace filter", and set `referenceAttachmentId`/`referencePage` in the create call when `manualPage` is set. Don't run the seed; `npx tsc --noEmit` covers it.
- [ ] **Step 5: Testing checklist.** Change the intro to include step 4 and the Setup line to "three new database migrations (reminder cost and calendar, equipment value and lifespan, manual page on a reminder)". Add `## 13. Manual page on a reminder (step 4)` before `## Known gaps`, in the file's style:

```markdown
## 13. Manual page on a reminder (step 4)

- [ ] Put a PDF manual in an equipment item's Documents tab. Edit one of its reminders: a **Manual** choice lists that file. Pick it and type a page.
- [ ] After saving, the reminder row shows "Manual, p. 12". Clicking it opens the PDF at that page in a new tab, and the edit form doesn't open.
- [ ] **Complete** on that row shows the same link, so the steps are at hand while you work.
- [ ] A photo or Word file can be picked too. Its link opens the file without jumping to a page.
- [ ] A file attached to the reminder itself can be picked after the reminder is saved once.
- [ ] Files from other assets, service records and warranties aren't offered.
- [ ] On a property, switch a reminder from the property to one of its equipment items. The Manual choice resets and lists only that item's documents.
- [ ] Page 0, a negative page or 2.5 is refused with a clear message. A blank page is fine and the link reads "Manual".
- [ ] Delete the manual from the Documents tab. The reminder stays, its link disappears, and editing it shows no manual.
- [ ] On an asset with no documents, the reminder form looks exactly as before: no Manual row.
- [ ] **Find page** appears next to the page box once the file's text has been read, which happens in the background after upload. It fills in the page that best matches the reminder's title, or says no page matched.
- [ ] With Health on, a person's reminder can link one of that person's documents. Turn Health off: the person page stays hidden as before.

**With the demo data**
- [ ] The Gas Furnace's "Replace furnace filter" reminder shows "Manual, p. 3", and the link opens page 3 ("Replacing the air filter").

**Export and assistant (optional)**
- [ ] A readable export's `reminders.csv` has a `manual` column with the file name and page.
- [ ] Ask the assistant "what page of the furnace manual covers the filter?" It can name page 3 and read it.
```

  Under "Known gaps", add that step 4 wasn't checked in a browser either.
- [ ] **Step 6: Final checkpoint.** Run `npx vitest run`, `npx eslint .` and `npx tsc --noEmit`, and quote the summary lines (eslint: 0 errors, 8 warnings). Confirm `git diff --stat -- "app/(app)/page.tsx" components/dashboard lib/backup/restore.ts` prints nothing. Run `git status` and list the files this step changed. Don't commit unless the user asked. Say that Task 6's manual-verification list and checklist section 13 are open for the user and that nothing was checked in a browser.
- [ ] **Step 7: Commit** (only if asked): `git add lib/llm/ontology.ts lib/llm/ontology.test.ts lib/backup/readable.ts lib/backup/readable.test.ts lib/backup/import-rules.test.ts Dockerfile docs/export-format.md prisma/seed-demo.ts && git commit -m "Export, assistant and demo data know a reminder's manual page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` (`TESTING-CHECKLIST.md` stays uncommitted; it's deleted before the PR).
