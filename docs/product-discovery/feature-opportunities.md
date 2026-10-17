# HomeCenter: feature opportunities

*Product discovery, 2026-10-09. Read alongside `current-state-assessment.md`, which has the code evidence these proposals rest on. Paths are relative to the repo root.*

## How to read this

- Each serious candidate has an ID (F1, F2, …) and the same 14-part evaluation.
- **Complexity:** S = days, M = 1–2 weeks, L = 3–6 weeks, XL = more, for one experienced contributor. These are rough; nothing has been prototyped.
- **Assumption** and **Hypothesis** mark things that are not established by the code. No user research exists for this product, so every demand claim is a hypothesis.

### Opportunity map

| Category | Candidates |
|---|---|
| Core product | F1 Close the maintenance loop · F2 Snooze, skip and pause · F3 Actionable "This week" dashboard |
| Reduce manual entry | F4 Maintenance starter plans · F5 Odometer log and mileage projection |
| AI and document intelligence | F6 Capture inbox (document-first records) · F7 Asset-level documents · F8 Related documents on records |
| Predictive and financial | F9 Renewals and fixed costs · F10 Repair-or-replace signals |
| Integrations and import | F11 Calendar (ICS) feed · F12 Spreadsheet and LubeLogger/HomeBox import |
| Collaboration | F13 Task owners and targeted reminders |
| Mobile | F14 Installable mobile capture (PWA + camera) |
| Privacy and portability | F15 Full export, scheduled backup and verified restore |
| Differentiating | F16 Home history packet · F17 Household emergency binder · F18 Recall alerts |
| Adoption | F19 Localization basics (km, currency) |

---

## Core product improvements

### F1. Close the maintenance loop

1. **Description.** When a reminder is completed, create (or link) a service record, capturing cost, vendor, notes and files in the same dialog. When a service record is saved, offer to mark a matching schedule complete. Both directions update the vehicle odometer.
2. **User problem.** Completing a reminder leaves no history and no cost. Logging a service leaves the reminder overdue. Users have to enter everything twice, or their records quietly lose the work that was done.
3. **Target user.** Every household that uses reminders, which is the core audience.
4. **Example.** The furnace filter reminder is overdue. The user taps Complete, enters "$24, Home Depot" and attaches a photo of the receipt. The filter change now appears in Service history and in Costs, and the next due date moves 90 days out.
5. **Benefit.** History becomes complete without extra effort, and the cost analytics finally reflect routine upkeep. Trust follows: "if it's done, it's in HomeCenter."
6. **Current findings.**
   - `completeMaintenanceSchedule` only updates the dates and the odometer (`lib/actions/maintenance.ts:76-116`).
   - `createServiceRecord` never touches schedules or mileage (`lib/actions/service-records.ts`).
   - PLANNING already lists this as an open question (`PLANNING.md:418`).
7. **New vs existing.** Both actions and both dialogs exist. What is new is linking them, and adding the cost, vendor and file fields to Complete.
8. **Proposed UX.**
   - The Complete dialog gains optional fields (cost, vendor, notes, files), with a "Log as service record" checkbox that defaults on.
   - The service-record dialog shows "This also completes: [Oil change ▾]" when an active schedule on the same asset has a similar title. It defaults to the best match and can be cleared.
   - The vehicle odometer moves up to `mileageAtService` when that is higher.
9. **Technical approach.**
   - Wrap both writes in one `prisma.$transaction`.
   - Add an optional `maintenanceScheduleId` on `ServiceRecord` (schema change, nullable, no backfill). This allows "last done → see record" and shows schedules with their history.
   - Match titles deterministically with normalized token overlap; no LLM.
   - Reuse `scheduleDue` for the next due date.
10. **Complexity.** S–M.
11. **Maintenance burden.** Low.
12. **Risks.** A wrong auto-match could complete the wrong schedule. Mitigate by always showing the match and letting the user change it. Undo is simply editing the schedule.
13. **Assumptions.**
    - Users log routine work at all. *Hypothesis:* many log reminders but not services. That would be exactly the gap this fixes.
14. **Validation.**
    - Ask in a GitHub Discussion: "When you complete a reminder, do you also add a service record?"
    - After shipping, compare service records created through Complete with those created directly, using a local count shown to the admin.

### F2. Snooze, skip and pause reminders

1. **Description.**
   - *Snooze* for N days or miles without changing the cycle.
   - *Skip this occurrence*: advance one interval, no record.
   - *Pause*: use the existing `isActive` field properly.
2. **User problem.** The only way to defer a reminder is to edit its due date, which corrupts the interval. A seasonal task (pool, lawn mower) cannot be paused.
3. **Target user.** All reminder users; anyone with seasonal equipment in particular.
4. **Example.** In January the user snoozes "Clean gutters" until April, and pauses "Winterize sprinklers" in summer.
5. **Benefit.** Fewer stale overdue items, which keeps notifications meaningful.
6. **Current findings.**
   - `isActive` exists (`schema.prisma:456`), but `clean()` forces it to `true` (`lib/actions/maintenance.ts:36`).
   - Search still labels "Paused" items (`lib/search/global-server.ts:457`).
   - PLANNING lists "Skip / snooze" (`PLANNING.md:192`).
7. **New vs existing.** The field and the label exist. The behaviour is new.
8. **Proposed UX.** A "…" menu on each reminder row, on the dashboard and on notifications, offering Snooze 1 week, 1 month or a chosen date, Skip, and Pause/Resume.
9. **Technical approach.**
   - Add `snoozedUntil DateTime?`. `scheduleDue` treats a snoozed item as not due until then.
   - The notification checker's `cycleKey` stays the same, so a snooze does not spawn a new cycle (`lib/notifications/repeat.ts:56-58`).
10. **Complexity.** S.
11. **Maintenance burden.** Low.
12. **Risks.** A forgotten pause hides real safety items. Show paused items in a collapsed group, not nowhere.
13. **Assumptions.** None significant; this is standard reminder behaviour.
14. **Validation.** No validation is needed beyond use; it is table stakes.

### F3. An actionable "This week" dashboard

1. **Description.** Turn the dashboard's Reminders and Expiring Warranties panels into an action list: Complete (F1), Snooze (F2), or Open, directly on each row. Include renewals (F9) when they exist.
2. **User problem.** The dashboard shows what is due but sends the user to the asset page to act. Rows link to the asset, not the schedule (`app/(app)/page.tsx:151-170`).
3. **Target user.** All users. This is the main reason to open the app.
4. **Example.** On a Monday, three items are listed. The user completes one, snoozes one and opens the third, in 30 seconds.
5. **Benefit.** It shortens the core loop from five clicks to one. *Hypothesis:* that makes users more likely to come back.
6. **Current findings.** Display only. The `?tab=&open=` deep link exists on asset pages (`lib/search/global-server.ts:56-57`) and is unused here.
7. **New vs existing.** Data and ranking exist. The inline actions are new.
8. **Proposed UX.** Each row shows a status chip, the asset, the item, a Complete button and a "…" menu. Notification rows in the bell get the same actions.
9. **Technical approach.** Reuse the F1 and F2 server actions and `revalidatePath`. Extract the Complete dialog from `components/maintenance/maintenance-list.tsx:266-313` into a shared component.
10. **Complexity.** S, once F1 and F2 exist.
11. **Maintenance burden.** Low.
12. **Risks.** Minimal.
13. **Assumptions.** Users open the dashboard. *Assumption:* the digest email is the real entry point for many. Add the same deep links to the email.
14. **Validation.** Dogfood it; this is mostly UX hygiene.

---

## Automation and reduced manual entry

### F4. Maintenance starter plans

1. **Description.** When an asset is created, or from an empty Maintenance tab, offer a checklist of common schedules for that kind of asset, with sensible intervals the user can edit.
   - Car: oil and filter, tire rotation, cabin filter, brake fluid.
   - House: HVAC filter, smoke and CO detector test, gutter cleaning, water heater flush, dryer vent.
   - Equipment by category, e.g. `HVAC` gets an annual service and `WATER` a softener salt or filter change.
2. **User problem.** A new user faces an empty Maintenance tab and has to know what to track and how often. That is the slowest part of setup, and it is where self-hosted apps lose people.
3. **Target user.** New installs, new homeowners, and anyone adding an asset.
4. **Example.** The user adds "2019 Honda CR-V". HomeCenter suggests seven schedules, and the user ticks five. Reminders exist immediately.
5. **Benefit.** Instant value on day one, and the reminder engine has something to do.
6. **Current findings.**
   - No templates exist; only placeholder text (`components/maintenance/maintenance-form-dialog.tsx`).
   - The empty state is "No maintenance schedules yet." (`components/maintenance/maintenance-list.tsx:115-117`).
   - `EquipmentCategory` (`schema.prisma:69-78`) and `PropertyType` provide the keys.
7. **New vs existing.** Entirely new; it reuses `createMaintenanceSchedule`.
8. **Proposed UX.**
   - After saving an asset, show "Suggested reminders for this vehicle" with checkboxes and editable intervals, then "Add selected".
   - Offer the same list later from the empty tab.
9. **Technical approach.**
   - A versioned static file (`lib/maintenance-templates.ts`) keyed by asset type and category, with no AI.
   - Intervals are labelled "typical; check your manual".
   - Optionally, admins can edit a household copy in a later version.
   - Optional future step: when the owner's manual is uploaded, the assistant can be asked "what intervals does my manual recommend?". `search_documents` can already do this.
10. **Complexity.** S–M. Most of the effort is curating the content.
11. **Maintenance burden.** Medium-low: the content must stay sensible, and community PRs can help.
12. **Risks.** Liability-flavoured trust risk if an interval is wrong for a specific vehicle. Always label intervals as generic and editable, and never present them as manufacturer guidance.
13. **Assumptions.**
    - *Hypothesis:* empty-state friction is a top reason trials stall.
    - Generic intervals are useful enough.
14. **Validation.**
    - Post a draft template list in Discussions or on r/selfhosted and ask which items people actually track.
    - After release, count how many template items are accepted per new asset (local, admin-visible).

### F5. Odometer log and mileage projection

1. **Description.** Keep a history of meter readings, taken from service records, completions and a quick "Update odometer" action. From that history, estimate miles per day and project when mileage-based items will fall due.
2. **User problem.**
   - Mileage reminders only fire if someone updates `currentMileage`, which is a single manually edited field.
   - Mileage-only items sort wrongly on `/maintenance` (`app/(app)/maintenance/page.tsx:22-25`).
   - Users cannot see "oil change due in about 3 weeks".
3. **Target user.** Vehicle owners, plus mowers and generators that use the HOURS unit.
4. **Example.** Readings of 41,200 on May 1 and 43,900 on Sep 1 give about 22 mi/day. "Oil change at 45,000" is projected for about Oct 21 and enters the normal date-based reminder window.
5. **Benefit.** Mileage reminders work even when nobody remembers to update the odometer, and all items become comparable on one timeline.
6. **Current findings.**
   - No odometer history exists. Only Complete updates the odometer (`lib/actions/maintenance.ts:105-111`).
   - `mileageAtService` is recorded but never fed back.
   - `costPerMeter` already uses the span of mileage readings (`lib/costs.ts:274-283`).
7. **New vs existing.** The readings partly exist on service records. The log, the projection and the quick-update action are new.
8. **Proposed UX.**
   - "Update odometer" on the vehicle header and in the mobile quick actions.
   - The reminder row shows "≈ Oct 21 (projected)".
   - A small mileage-over-time sparkline on the vehicle page.
9. **Technical approach.**
   - A new `MeterReading` table (vehicleId, date, value, source), backfilled from `mileageAtService`.
   - A linear rate over the last N readings, deterministic and testable.
   - `scheduleDue` gains a `projectedDueDate`.
10. **Complexity.** M.
11. **Maintenance burden.** Low.
12. **Risks.** Projections are wrong for irregular use. Show them as approximate, and never let a projection *suppress* a real mileage trigger.
13. **Assumptions.** Users enter at least occasional readings. F1 makes this happen as a side effect.
14. **Validation.** Check how many demo or real vehicles have two or more `mileageAtService` values. If most do, the backfill alone provides value.

---

## AI and document intelligence

### F6. Capture inbox: document-first records

1. **Description.**
   - A household **Inbox** where anyone drops or photographs a document (a receipt, invoice, warranty card or `.eml`) with no record yet.
   - HomeCenter extracts the text (existing OCR), then proposes a draft: the record type, the asset, the date, the amount and the vendor.
   - The user confirms or edits, and the document is filed on the new record.
   - Extraction is **deterministic first** (dates, currency amounts, known vendor names, model and serial patterns, asset name and VIN matches). When the assistant is configured, an LLM can optionally fill the gaps.
2. **User problem.**
   - Data entry is the main cost of using HomeCenter.
   - The user has the paper in hand and must first find the asset, open a tab, create a record, type the fields, and only then attach the file.
   - Documents with no obvious record (manuals, a purchase receipt for a new appliance) have nowhere to go.
3. **Target user.** All users, and especially the non-admin household members who hold the receipts.
4. **Example.** A partner photographs a $412 plumber invoice. The Inbox shows: "Service record · Main House · 2026-10-07 · $412.00 · Rapid Rooter Plumbing — [Confirm] [Edit]". One tap and it is filed, costed and searchable.
5. **Benefit.** Turns HomeCenter from "a form you fill in" into "a place you throw paper", which is the core promise of a household memory. It also uses the OCR and indexing that already run on every upload.
6. **Current findings.**
   - Uploads require `recordId` (`app/api/uploads/route.ts:20-31`).
   - OCR and extraction produce `AttachmentText.text` for every file (`lib/documents/indexer.ts`), which today is used only for search.
   - No LLM extraction exists: no `response_format` usage, and `createChatClient` is used only by chat and tests.
   - Receipt parsing is PLANNING's Phase 6 (`PLANNING.md:309-326`).
   - Uncommitted `.eml`/`.msg` extraction (`lib/documents/extract/mail.ts`) makes forwarded receipt emails a natural input.
7. **New vs existing.** Extraction, OCR and the index exist. Unfiled documents, field parsing, asset matching, the draft-review UI and the optional LLM structured call are new.
8. **Proposed UX.**
   - An "Inbox" nav item with a badge count.
   - Drag-and-drop or a camera button, from anywhere in the app and in the mobile quick action (F14).
   - Each item shows a thumbnail, the extracted text preview, and the proposed fields with a confidence hint ("found", "guessed", "missing").
   - Actions: Confirm, Change type, Attach to an existing record (search picker), or "Keep as asset document" (F7).
   - Nothing is ever created without a click.
9. **Technical approach.**
   - Schema: allow `Attachment` with no owning record and an `inboxStatus` (or a dedicated `InboxItem` table pointing to an attachment). This needs a new `AttachmentRecordType` value, or nullable ownership.
   - The indexer already handles orphan cleanup in `reconcile()` (`lib/documents/indexer.ts:228-245`). Inbox files must be exempted from it.
   - A deterministic parser module (`lib/documents/parse/*`): date and amount regexes with "total" keyword weighting, vendor taken from the top lines, and VIN, serial and model regexes. It is pure functions with fixture-based tests, matching the repo's test style.
   - Asset suggestion: an exact match on asset name, VIN or serial first, then the existing `entity_vec` semantic match (`lib/search/entities/*`).
   - Optional LLM step: one JSON-schema completion through the existing `lib/llm/client.ts` settings, gated by an admin toggle, with the same "document text is data" guardrail. Many local models handle JSON poorly, so the deterministic result is always the fallback.
   - Queue: reuse the indexer's single-file queue and run parsing after text extraction.
10. **Complexity.** L. The deterministic path is M; the inbox UI is M; the LLM step is S on top.
11. **Maintenance burden.** Medium. Receipt formats vary endlessly, so expect a long tail of "it picked the wrong total" issues. Fixture-driven tests keep this manageable.
12. **Risks.**
    - *Reliability:* wrong totals, or the subtotal taken instead of the total. Always require review, and show the source line.
    - *Privacy:* the LLM step sends document text to the configured provider. Gate it separately, as is done for health documents, and default it off for person-owned files.
    - *Prompt injection* through documents: keep the extraction call tool-less and schema-bound.
    - *OCR quality* on phone photos: tesseract is English only and CPU-bound on a NAS. Expect 10–60 s per photo, so the queue must show progress.
13. **Assumptions.**
    - *Hypothesis:* capture friction, not lack of features, limits how much data households enter.
    - Deterministic parsing gets date and total right on a useful share of real receipts. **Unvalidated.** Measure it before building the UI.
14. **Validation.**
    - Collect 30–50 real household receipts and invoices (the maintainer's own, with consent).
    - Run the existing extractor plus a prototype parser offline. Measure field accuracy for date, total, vendor and asset.
    - If date and total are right in at least 70% of cases with no LLM, build it. If not, decide whether the LLM step carries it.
    - Separately, ask in Discussions: "would you photograph receipts into HomeCenter?"

### F7. Asset-level documents (manuals, titles, deeds, purchase receipts)

1. **Description.** Let files attach directly to a property, vehicle, equipment item or person, in a "Documents" tab, with a light type label: Manual, Purchase, Title/Deed, Insurance, Photo, Other.
2. **User problem.** An appliance manual, a car title or a house survey belongs to the *asset*, not to a service event. Today users create fake service records or warranties to hold them, which pollutes history and costs.
3. **Target user.** All users. This is the "household memory" job.
4. **Example.** The user uploads the dishwasher manual to the dishwasher. Later the assistant answers "how do I clean the filter?" from page 23, using existing `search_documents` scoped to that asset.
5. **Benefit.** A clean model, better assistant answers, and a "Download all files" that is truly complete.
6. **Current findings.**
   - Attachments are tied to 9 record types only (`schema.prisma:108-118`).
   - The assistant reaches asset files only through records (`lib/documents/tool-helpers.ts`, `attachmentIdsForAsset`).
7. **New vs existing.** Attachments, extraction and search exist. Direct asset ownership and the Documents tab are new.
8. **Proposed UX.** A Documents tab on each asset page with type chips, upload (with camera on mobile) and preview. Also the "Keep as asset document" target from the F6 Inbox.
9. **Technical approach.**
   - Add `ASSET` to `AttachmentRecordType` plus `assetId`/`assetType` columns on `Attachment`. This mirrors the polymorphic pattern used elsewhere.
   - Update `attachmentIdsForAsset`, the health gating for `PERSON` (`tool-helpers.ts:29-31`), the zip route and file-owner deep links (`lib/attachment-location.ts`).
10. **Complexity.** M. It touches several files, but each change is mechanical.
11. **Maintenance burden.** Low.
12. **Risks.** Health gating must treat person-owned asset documents as health documents. That is the existing rule, so extend its tests.
13. **Assumptions.** Low risk; this is a common model in competitors (HomeBox attachments, Centriq manuals).
14. **Validation.** Count, on the demo data or the maintainer's own data, how many service records exist only to hold a document.

### F8. Related documents on records and assets

1. **Description.** On a service record, warranty or asset page, show "Possibly related documents": files whose text mentions this asset's name, model, serial or VIN, or that are semantically close, but which are filed elsewhere.
2. **User problem.** Documents get filed on the wrong record, or on one record when they are relevant to several (a home warranty covering five appliances).
3. **Target user.** Users with a large document base.
4. **Example.** The water heater page shows "Mentioned in: Home inspection report 2024, p.14".
5. **Benefit.** Surfaces knowledge the user already has, using an index that already exists.
6. **Current findings.**
   - The FTS5 and vector indexes exist (`lib/documents/index-db.ts`).
   - Record embeddings exist (`lib/search/entities/*`).
   - Nothing cross-links them on detail pages.
7. **New vs existing.** Only the panel and the query are new.
8. **Proposed UX.** A collapsed panel at most 5 items long, each with a page and snippet, and a "Not related" dismiss stored per pair.
9. **Technical approach.** An FTS query on identifiers plus a `vector_top_k` from the record's own embedding. Cache the results.
10. **Complexity.** S–M.
11. **Maintenance burden.** Low.
12. **Risks.** Noise. Use a strict threshold and identifiers first.
13. **Assumptions.** Users have enough documents. This value grows over time, so it suits a later release.
14. **Validation.** Run the query offline on the demo data and judge precision by hand.

---

## Predictive insight and financial visibility

### F9. Renewals and fixed costs

1. **Description.** A general "Renewal" item for anything that expires and usually costs money: car registration and inspection, home and auto insurance, property tax installments, HOA dues, passports and driver's licenses. Each has a due date, an optional amount and a recurrence, and is attached to an asset or person.
   - Renewals feed reminders (existing checker) and costs, so spend includes fixed costs and not only repairs.
2. **User problem.**
   - The most painful household misses are often renewals, not maintenance: an expired registration, a lapsed policy, a passport found expired three weeks before travel.
   - Today these are hacked in as warranties or reminders with no cost.
   - Insurance is people-only and has no premium (`schema.prisma:372-391`).
   - Costs ignore everything but service records (`lib/costs-server.ts`).
3. **Target user.** All households. Multi-vehicle and multi-property owners in particular.
4. **Example.** "Registration — Truck — due Mar 31 — $186/yr" gets a reminder 30 days out. Marking it renewed logs $186 in Costs under the truck and rolls it to next year.
5. **Benefit.** True cost of ownership per asset, and coverage of the high-consequence deadlines.
6. **Current findings.**
   - Warranties already have an expiry and the checker handles them (`lib/notifications/checker.ts:73-83`).
   - The "FinancialTransactions" design was never built (`PLANNING.md:275-307`).
   - Health insurance expiry notifications exist (`INSURANCE_EXPIRING`).
7. **New vs existing.** Reminders and checker infrastructure exist. A renewal entity with a cost and a "renew" action is new.
8. **Proposed UX.** A "Renewals" tab on assets and people, plus a global Renewals page. "Mark renewed" asks for the amount paid (defaulting to last time) and writes a cost entry.
9. **Technical approach.**
   - Option A, which is simpler: a `Renewal` model, where "Mark renewed" creates a `ServiceRecord` with category `OTHER` (or a new `FEE`/`INSURANCE` category), so costs need no new pipeline.
   - Option B: the full `FinancialTransaction` design. **Recommend A.** Do not build a ledger.
   - Add a `RENEWAL_DUE` notification type.
10. **Complexity.** M.
11. **Maintenance burden.** Low-medium.
12. **Risks.**
    - Scope creep toward budgeting and bank sync. Explicitly out of scope (see Rejected).
    - Identity documents (passports) are sensitive. Store only the expiry and an optional scan, and treat them under the same Health/person privacy gating.
13. **Assumptions.** *Hypothesis:* renewal misses are as frequent and costly as maintenance misses. Plausible, but unvalidated.
14. **Validation.** In Discussions, ask: "What deadline did your household last miss?" and categorize the answers as maintenance, renewal or other.

### F10. Repair-or-replace signals

1. **Description.** Deterministic flags on equipment and vehicles. Examples:
   - "Repairs in the last 24 months exceed 40% of the purchase price."
   - "Age 13 years; typical life for this category is 10–15 years."
   - "Third repair of the same kind in 18 months."
   Shown on the asset page and as a monthly digest line.
2. **User problem.** Households discover too late that they have been repairing a dying appliance. HomeCenter has the data (purchase price, install date, costed repairs) but never says anything.
3. **Target user.** Owners of older homes and vehicles.
4. **Example.** The dishwasher page shows: "$620 in repairs since 2025 (78% of its $795 price). Consider replacement."
5. **Benefit.** The first "proactive intelligence" that is reliable and explainable. *Hypothesis:* it is a talking point that differentiates HomeCenter.
6. **Current findings.**
   - `purchasePrice` and `installDate` exist (`schema.prisma:208-210`).
   - The share of service cost against purchase price is already computed in the cost panel (`components/costs/asset-cost-panel.tsx:79-116`).
7. **New vs existing.** The arithmetic exists. Rules, lifespan reference data and the presentation are new.
8. **Proposed UX.** A quiet callout on the asset page with a "Why?" link that shows the numbers. Dismissible.
9. **Technical approach.** A rule module plus a small static lifespan table per `EquipmentCategory`. No LLM.
10. **Complexity.** S–M.
11. **Maintenance burden.** Medium: the lifespan figures need sources and humility.
12. **Risks.** Bad advice. Present facts ("78% of price") over verdicts, and cite the lifespan ranges as typical.
13. **Assumptions.** Enough users record purchase price and repair costs. **Unvalidated, and probably a minority today.** That is why this comes after F1 and F6.
14. **Validation.** Check data density: what share of equipment has `purchasePrice` and at least two costed records?

---

## Integrations and data import

### F11. Calendar feed (ICS)

1. **Description.** A per-user secret calendar URL listing due maintenance, warranty expiries, renewals and health reminders (when Health is enabled). It can be subscribed to from Google, Apple or Outlook calendars, or from Home Assistant's calendar integration.
2. **User problem.** The household already lives in a shared calendar. HomeCenter's reminders arrive in a separate bell and email.
3. **Target user.** All users, and Home Assistant users in particular.
4. **Example.** "Change HVAC filter" appears on the family calendar on its due date, with a link back.
5. **Benefit.** Reminders go where people already look, which makes the app useful without being opened.
6. **Current findings.** No API tokens, ICS feed, webhooks or Home Assistant integration exist.
7. **New vs existing.** Entirely new; the data comes from `scheduleDue` and the checker queries.
8. **Proposed UX.** Settings → Notifications → "Calendar feed": a copy-URL button, a regenerate button, and a choice of what to include. Health is excluded by default.
9. **Technical approach.**
   - A route `GET /api/calendar/<token>.ics` that is excluded from `proxy.ts` and authenticates by a hashed per-user token.
   - Hand-write the ICS (~100 lines) or use a tiny library.
   - Event titles must avoid health details unless the user opts in.
10. **Complexity.** S.
11. **Maintenance burden.** Low.
12. **Risks.**
    - *Security:* the feed URL is a bearer secret and is often synced to a cloud calendar. Health and identity data in the title is a real disclosure risk, so default to asset items only.
    - The token must be revocable and rate-limited.
13. **Assumptions.** The household uses a calendar app.
14. **Validation.** Low cost, so ship behind a setting and watch issue feedback.

### F12. Spreadsheet and app import

1. **Description.** Import CSV for assets, service records and schedules, using a column-mapping step and preview. Add first-class import of LubeLogger CSV exports (LubeLogger itself supports CSV import and export; see the competitive analysis).
2. **User problem.** Switchers have years of history in spreadsheets or other apps. Re-typing it means they never switch.
3. **Target user.** New users migrating from spreadsheets, LubeLogger or HomeBox.
4. **Example.** The user uploads `car-log.csv`, maps Date, Odometer, Cost and Description, previews 212 rows, then imports them into the truck's history.
5. **Benefit.** Removes the largest adoption barrier for users with existing data.
6. **Current findings.** No import of any kind. `.csv`, `.xlsx` and `.xls` are parsed for *text* by the extractor (`lib/documents/extract/*`, uncommitted `mail.ts:71-83` for xls).
7. **New vs existing.** The parsers exist. Mapping and import are new.
8. **Proposed UX.** Settings → Import: upload a file, pick the target asset, map columns (auto-guessed from headers), preview with errors, import, and undo the batch.
9. **Technical approach.** Add an `importBatchId` on created rows to allow one-click undo. Write rows through the existing server-action validation (zod schemas).
10. **Complexity.** M for generic CSV. Each named-app adapter is S.
11. **Maintenance burden.** Medium: other apps change their export formats.
12. **Risks.** Duplicate imports. Use the batch undo plus a duplicate warning on date + title + cost.
13. **Assumptions.** *Hypothesis:* switchers are a meaningful part of the reachable audience.
14. **Validation.** Ask in Discussions or Issues what people currently use. Build only the generic CSV until a named source is requested repeatedly.

---

## Household collaboration

### F13. Task owners and targeted reminders

1. **Description.** An optional "Responsible" user on schedules and renewals. Notifications go to the owner, or to everyone if unset. The dashboard can filter to "Mine".
2. **User problem.** Every recipient gets every notification (`lib/notifications/checker.ts:53-57`). In a two-adult household, that means duplicate nagging and diffused responsibility.
3. **Target user.** Multi-adult households.
4. **Example.** Car items go to one partner and house items to the other. Each digest is half as long.
5. **Benefit.** Less notification fatigue, and clear ownership.
6. **Current findings.** Per-user receive flags exist (`schema.prisma:151`). There is no per-item targeting and no assignee field.
7. **New vs existing.** New field and new checker filter.
8. **Proposed UX.** A user picker on the schedule form, an avatar on reminder rows, and a "Mine / Everyone" toggle.
9. **Technical approach.** Add `ownerId String?` on `MaintenanceSchedule` (and later `Renewal`). In `checker.ts`, recipients become the owner if one is set.
10. **Complexity.** S.
11. **Maintenance burden.** Low.
12. **Risks.** The owner is away and nothing gets done. Add an "escalate to everyone when overdue by N days" option, or simply include overdue items for everyone.
13. **Assumptions.** *Hypothesis:* most installs have more than one user. Unknown.
14. **Validation.** A one-line poll.

---

## Mobile and everyday convenience

### F14. Installable mobile capture

1. **Description.**
   - A PWA manifest and icons so HomeCenter installs to the home screen.
   - `accept` and `capture` attributes on file inputs so the camera opens directly.
   - A mobile "Quick actions" sheet: Snap a receipt (to the F6 Inbox), Log a service, Update the odometer, Complete a reminder.
   - Responsive fixes to the service-record dialog.
2. **User problem.** Paper and service events happen away from the desk, at the mechanic or with a plumber in the hallway. The current UI is desktop-first. No input sets `capture`, and the service dialog overflows on phones (`components/service-records/service-record-form-dialog.tsx:205,240`).
3. **Target user.** All household members, and non-admin members especially.
4. **Example.** At the oil-change counter: open the HomeCenter icon, tap Snap receipt, take the photo, done. It is filed later from the Inbox.
5. **Benefit.** Turns capture from a chore into a moment. It is a precondition for F6 delivering its value.
6. **Current findings.** No manifest or service worker. The sidebar collapses into a sheet (`components/sidebar.tsx:89-110`), and the chat panel is full-screen on mobile.
7. **New vs existing.** Responsive basics exist. The manifest, capture and quick actions are new.
8. **Proposed UX.** A floating "+" on mobile opening the four quick actions.
9. **Technical approach.**
   - `app/manifest.ts` (check the Next 16 docs in `node_modules/next/dist/docs/` per AGENTS.md).
   - Icons, and an optional minimal service worker for the app shell only. No offline data sync: that is complex and conflicts with the server-authoritative model.
   - Note: PWA install on iOS requires HTTPS. Many LAN installs use plain HTTP, so document a reverse proxy, or Tailscale/VPN with HTTPS.
10. **Complexity.** S, without offline sync.
11. **Maintenance burden.** Low.
12. **Risks.** HTTPS requirements confuse users. Camera capture still works over HTTP for file inputs, so that should be the baseline.
13. **Assumptions.** Users reach their server from their phone, via VPN or the LAN. *Assumption:* common among NAS owners, but not universal.
14. **Validation.** Ask in Discussions: "Do you open HomeCenter on your phone? On LAN, over VPN, or not at all?"

---

## Privacy, security, backup and portability

### F15. Full export, scheduled backup and verified restore

1. **Description.**
   - **Export:** a single archive containing all records as JSON (one file per model, plus a schema version), human-readable CSVs, all uploads in a readable folder tree named by asset and record, and a static `index.html` that browses everything offline.
   - **Backup:** a scheduled, consistent SQLite snapshot (`VACUUM INTO`) plus uploads to a configurable path, with retention.
   - **Restore:** from such a backup, with a dry-run check.
2. **User problem.**
   - "Your household's authoritative memory" requires believing you can get everything out, readable, without HomeCenter. Today the README says to copy the data folder while the container is stopped (`README.md:392`).
   - Users cannot export data at all except as per-asset file zips.
3. **Target user.** Every user, and especially the privacy-motivated self-hosters who make up the core audience.
4. **Example.** Settings → Data → "Export everything" produces `homecenter-2026-10-09.zip`. Opening `index.html` on any computer shows each asset with its history and documents. A nightly backup lands in `/data/backups` with 14 days kept.
5. **Benefit.**
   - Trust and portability, which are the reason people self-host.
   - Ironically, the more freely data can leave, the more willing people are to put it in.
   - Also a survivorship feature: the export is readable even if the project dies.
6. **Current findings.**
   - Only the per-asset zip (`app/api/assets/[type]/[id]/download/route.ts`) and print reports exist.
   - The search index is derived and rebuildable (`README.md:347`), so backups can omit it.
   - Secrets depend on `AUTH_SECRET` (`lib/secret-box.ts`), so backups must document this.
7. **New vs existing.** fflate and `loadReport` exist. Everything else is new.
8. **Proposed UX.** Admin Settings → Data: Export now (with a progress indicator), Backup schedule and location, last backup status (shown on the dashboard if stale), and Restore (CLI, or UI with confirmation).
9. **Technical approach.**
   - Stream the zip.
   - Exported JSON should carry a `formatVersion`.
   - The static viewer is a pre-rendered HTML file per asset, reusing the report components where possible.
   - Restore is safest as an offline CLI script (`scripts/restore.ts`) in v1. An in-app restore of a live SQLite database is risky.
10. **Complexity.** M for export and backup. Restore is M, and riskier.
11. **Maintenance burden.** Medium: the export format becomes a contract.
12. **Risks.**
    - Exports contain health data in clear text. Warn, and offer "exclude Health".
    - Backups to the same disk are not backups. Say so in the UI.
    - Restore bugs can destroy data. Ship the CLI with a dry run first.
13. **Assumptions.** *Hypothesis:* data portability influences adoption by privacy-focused users. Consistent with the self-hosted ethos, but not measured here.
14. **Validation.** Low risk to build. Validate through issue requests and by asking reviewers or YouTube self-hosting channels what they check.

---

## Differentiating or unexpected

### F16. Home history packet (sale, rental or handover)

1. **Description.** A one-click bundle for a property: the property report plus all its equipment (with model and serial numbers, install dates, warranties and their transferability notes), service history, and the documents. The user can pick sections to exclude, such as costs.
2. **User problem.** When selling a home or handing it to a tenant or house-sitter, the owner reconstructs this from memory. Buyers value documented maintenance. *Assumption:* there is widespread anecdotal belief in this, but it is not validated here.
3. **Target user.** Sellers, landlords with one or two rentals, and people handing a home to family.
4. **Example.** Listing a house: export "Main House — history packet.pdf + files.zip" and give it to the agent.
5. **Benefit.** A concrete, shareable artifact that *shows* HomeCenter's value to people who don't run it. That gives it word-of-mouth potential.
6. **Current findings.** The per-asset report exists (`components/report/asset-report.tsx`). The property zip leaves out equipment files (D3 in the current-state assessment).
7. **New vs existing.** Extend the report and the zip; F15's static viewer can be reused.
8. **Proposed UX.** On the property page, Report ▾ → "History packet…" with section checkboxes.
9. **Technical approach.** Compose existing report sections and include child equipment.
10. **Complexity.** S–M after D3 and F15.
11. **Maintenance burden.** Low.
12. **Risks.** Sharing too much (costs, notes, health). Exclude anything person-owned, and default costs off.
13. **Assumptions.** Infrequent use, perhaps once per home sale. Valuable but rare.
14. **Validation.** Mention it in a release and see whether people ask for vehicles too, for selling a car.

### F17. Household emergency binder

1. **Description.** A printable or exportable "If something happens" binder covering:
   - utility shut-off locations, with photos
   - key contacts (providers, insurers, plumber, electrician)
   - policy numbers
   - where important documents are kept
   - each person's medical summary (existing)
   - vehicle details
   It is assembled from existing records plus a few new free-text "Household info" fields.
2. **User problem.** In an emergency, or for a house-sitter or babysitter, the information exists but is scattered or in one person's head.
3. **Target user.** Families, caregivers of elderly parents, and people preparing a "legacy file".
4. **Example.** Before a trip, print the binder for the house-sitter, with health sections excluded.
5. **Benefit.** An emotionally resonant use of data already in HomeCenter. *Hypothesis:* differentiating.
6. **Current findings.** The medical summary exists (`app/reports/[type]/[id]/page.tsx:26`). Providers and insurance exist. There is no household-level info entity.
7. **New vs existing.** Mostly composition. New: household info fields such as shut-offs, Wi-Fi and alarm instructions.
8. **Proposed UX.** Reports → "Household binder", with audience presets (Sitter, Family, Full).
9. **Technical approach.** A new `HouseholdNote` model (title, body, location, photo, sensitivity), plus a report page.
10. **Complexity.** M.
11. **Maintenance burden.** Low.
12. **Risks.**
    - Printing alarm codes or Wi-Fi passwords creates real security exposure. Mark fields as sensitive and exclude them by default.
    - Do not become a password manager.
13. **Assumptions.** Demand is plausible but unvalidated.
14. **Validation.** Make a paper mock-up from the demo data and show it to five households.

### F18. Vehicle and appliance recall alerts (opt-in)

1. **Description.** Periodically check public recall data for the make, model and year of each vehicle (and possibly appliances), and notify when a match appears.
2. **User problem.** Recall letters get missed, and they are safety-relevant.
3. **Target user.** Vehicle owners, initially US only.
4. **Example.** "NHTSA recall 26V-xxx affects your 2019 CR-V: …" appears in notifications with a source link.
5. **Benefit.** Proactive and safety-relevant. Competitors such as Centriq advertise recall monitoring (see the competitive analysis).
6. **Current findings.** No outbound integrations exist beyond SMTP, the LLM and model downloads.
7. **New vs existing.** Entirely new.
8. **Proposed UX.** Settings → Features → "Check public recall databases (sends make, model and year to NHTSA)".
9. **Technical approach.** A scheduled fetch in the existing scheduler. **Unverified:** the current NHTSA recalls API endpoints, terms and query-by-model support. Confirm before committing. Appliance recalls (CPSC) are likely much harder to match reliably.
10. **Complexity.** M for vehicles. L or more for appliances.
11. **Maintenance burden.** Medium to high: an external API dependency, and it is US-only.
12. **Risks.** It breaks the "no network unless you ask" promise unless opt-in. False matches across trims.
13. **Assumptions.** Users are US-based. Unknown share.
14. **Validation.** Defer. Reconsider when the audience's geography is known.

---

## Adoption enablers

### F19. Localization basics: kilometres and currency

1. **Description.** Add a `KILOMETERS` meter unit, a household currency setting (ISO code) used by `formatMoney`, and date and number formatting by locale. The UI stays in English.
2. **User problem.** Miles and `$` are hard-coded (`lib/costs.ts:117-131`, `lib/llm/tools/shortcuts.ts:227`, `MeterUnit` in `schema.prisma:44-47`). Users outside the US see wrong units everywhere.
3. **Target user.** Non-US self-hosters. *Assumption:* a large share of the self-hosted community.
4. **Example.** A German user sets EUR and km. Costs show "1.234,56 €" and reminders read "in 800 km".
5. **Benefit.** Removes an immediate "not for me" signal for a large group.
6. **Current findings.** As above. Dates are already stored and displayed in UTC consistently.
7. **New vs existing.** New.
8. **Proposed UX.** Settings → Household: currency and default distance unit.
9. **Technical approach.** Use `Intl.NumberFormat` with a currency. Add the unit to the enum. Update the LLM prompt's money format line (`lib/llm/prompt.ts`) to use the setting.
10. **Complexity.** S–M, mostly hunting down hard-coded spots.
11. **Maintenance burden.** Low.
12. **Risks.** A mixed-currency history is not supported; say so.
13. **Assumptions.** International demand. Check the stars and issue authors' locales.
14. **Validation.** Look at where GitHub stargazers and Docker pulls come from, if visible, or simply ask.

---

## Rejected or deferred ideas (and why)

| Idea | Decision | Reason |
|---|---|---|
| **Assistant that writes records** ("log an oil change for $45") | Defer | The tool layer is deliberately read-only (`lib/llm/*`). Writes through a small local model are error-prone and hard to undo. F6's review-then-confirm flow captures most of the value deterministically. Revisit as "assistant proposes a draft into the Inbox", never direct writes. Observations now work the propose-then-confirm way (cards in the chat for adds, edits and deletes; the user confirms each); see docs/superpowers/specs/2026-10-17-assistant-observation-changes-design.md. |
| **Server-side chat history** | Reject (for now) | It weakens a clear privacy promise (`README.md:141`) for low value. Answers are re-derivable from the data. |
| **Budgeting, bank sync, a general ledger** | Reject | Firefly III, Actual and others own this. It would dilute the identity and bring heavy support (bank APIs). F9 covers asset-linked fixed costs only. |
| **Chores, groceries, meal planning** | Reject | Grocy and Homechart cover these. HomeCenter's identity is *ownership and upkeep*, not daily household ops. |
| **IoT and sensor integration** (runtime hours from smart plugs, HVAC filter runtime) | Defer | Attractive but niche. F11 (ICS) gives Home Assistant users a bridge. A read-only REST API could come later if requested. |
| **Native iOS/Android apps** | Reject | F14 (PWA) gets most of the benefit. Native apps add store accounts, release overhead and auth complexity for a one-maintainer project. |
| **Hosted SaaS version** | Reject as a product direction | It contradicts the core positioning and creates a support and liability burden, especially for health data. See the business models in the competitive analysis. |
| **Contractor marketplace or quotes** | Reject | Requires a network business, conflicts with privacy, and is what VC-funded apps (Oply) do. |
| **Offline-first PWA with sync** | Defer | Conflict resolution is costly. A capture queue that retries uploads is enough. |
| **Per-asset permissions and roles** | Defer | Households share by design (`README.md:400`). The exception is health privacy between adults. Consider only "private person records" if requested. |
| **Auto-filing documents without review** | Reject | Silent mistakes destroy trust in a system of record. Always confirm. |
| **Multilingual OCR** | Defer | Pairs with F19. Tesseract language packs are easy to add but increase the image size. Make them downloadable on demand, like embedding models, when demand appears. |
| **Appliance manual auto-download from the web** | Reject | Unreliable sources, copyright, and it requires outbound calls. Upload plus F7 is enough. |
| **Natural-language dashboards or AI insights feed** | Reject | Deterministic rules (F10, F5) are more reliable and testable. An LLM summary adds cost without new information. |
