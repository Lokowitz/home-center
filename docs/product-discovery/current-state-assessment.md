# HomeCenter: current-state assessment

*Product discovery, 2026-10-09. Based on reading the code at commit `8c3561d` on `main`, plus uncommitted work in the tree at that time. Nothing was run against real household data. Paths are relative to the repo root. Status notes marked "Fixed"/"Done" were added later, after checking the code on `FEAT/EnhancementsV1`.*

**Evidence labels used throughout**
- **Observed:** read in the code, with a path given.
- **Inferred:** a reasonable conclusion from the code, not executed.
- **Assumption:** not verifiable from the repo.

---

## 1. What HomeCenter actually does today

HomeCenter is a single Next.js 16 app (`package.json`: `next 16.2.12`, React 19.2, Prisma 7 over libsql/SQLite). It runs in one Docker container (`Dockerfile`, `node:22-bookworm-slim`) with one `/data` volume.

### Domain model (observed, `prisma/schema.prisma`)

| Area | Models | Notes |
|---|---|---|
| Assets | `Property`, `Vehicle`, `Equipment` | Equipment optionally belongs to a property (`schema.prisma:216`). Vehicles have `currentMileage` and a `meterUnit` of MILES or HOURS (`:192-193`). |
| Health (optional) | `Person`, `Provider`, `HealthCondition`, `Medication`, `Allergy`, `Immunization`, `InsurancePolicy`, `Observation` | Can be switched off as a whole (`FeatureSettings.healthEnabled`, `:617-622`). `PET` was added to `Relationship` in uncommitted work (`git diff prisma/schema.prisma`). |
| Activity | `ServiceRecord`, `Warranty`, `MaintenanceSchedule` | Linked to assets **polymorphically** by `assetId` + `assetType`, with no foreign key (`:395-460`). |
| Files | `Attachment` plus `AttachmentText` | An attachment belongs to one of 9 *record* types, never directly to an asset (`:108-118`, `:465-504`). |
| Ops | `Notification`, `MailSettings`, `LlmSettings`, `DocumentSettings`, `FeatureSettings`, `User` | Settings rows are singletons. |

### Capabilities (observed)

- **Asset pages.**
  - Property, vehicle and equipment pages each have a photo, stat chips, a cost panel, and Service / Warranties / Maintenance tabs (`app/(app)/assets/vehicles/[id]/page.tsx:33-98`).
  - A person page has seven health tabs (`app/(app)/assets/people/[id]/page.tsx:73-170`).
- **Maintenance reminders.**
  - Due status can be driven by date or by meter (miles or hours) (`lib/maintenance-due.ts:52-77`).
  - "Complete" moves the next due date forward (`lib/actions/maintenance.ts:76-116`).
- **Notifications.**
  - An in-process scheduler runs every 6 h by default (`lib/notifications/scheduler.ts:16`).
  - It raises maintenance, warranty, refill, immunization and insurance items (`lib/notifications/checker.ts`).
  - Users can choose repeat behaviour (`lib/notifications/repeat.ts`) and an email digest of ASAP, daily or weekly (`lib/notifications/digest.ts`).
- **Costs.**
  - Rollups by asset, category, vendor and period, with rolling average and prior-period comparison, cost per mile, and average per month (`lib/costs.ts`).
  - Cost exists **only** on `ServiceRecord.cost` (`lib/costs-server.ts:13-42`).
- **Documents.**
  - Every upload is text-extracted (PDF, Office, ODF, RTF and text; uncommitted work adds `.eml`, `.msg`, `.xls` and `.ppt`, see `lib/documents/extract/mail.ts`).
  - OCR runs locally with tesseract (English only, `lib/documents/extract/ocr.ts`).
  - Text is chunked (`lib/documents/chunk.ts`), indexed in FTS5 in a separate `search-index.db` (`lib/documents/index-db.ts`), and embedded with local ONNX models in a worker thread (`workers/embed-worker.mjs`, `lib/documents/embed/models.ts`).
- **Global search.**
  - Keyword search over 14 entity kinds plus document full text (`lib/search/global-server.ts`).
  - An opt-in "by meaning" mode adds a separate "Related by meaning" block (`app/(app)/search/page.tsx:157-169`).
- **AI assistant (optional, read-only).**
  - 13 tools: shortcuts, generic query/aggregate, and document list/search/read (`lib/llm/tools/index.ts:9-32`).
  - Works with any OpenAI-compatible endpoint (`lib/llm/client.ts`).
  - Every link in an answer is verified against tool output (`lib/llm/link-check.ts`).
  - Chat lives in browser sessionStorage only (`lib/llm/thread-storage.ts`).
  - No tool writes data (no Prisma create, update or delete calls under `lib/llm`).
- **Reports and export.**
  - A printable per-asset report or medical summary (`app/reports/[type]/[id]/page.tsx`).
  - A per-asset zip of attachments (`app/api/assets/[type]/[id]/download/route.ts`).
- **Security.**
  - Local credentials with bcrypt, a session-version revocation check on every request (`auth.ts:42-53`), an in-memory login throttle (`lib/login-throttle.ts`), CSP and HSTS headers (`lib/security-headers.ts`), and AES-GCM encryption of the SMTP password and LLM key (`lib/secret-box.ts`).

### Primary workflows

1. **Keep a record:** asset → Service tab → "Add Service Record" dialog → optional files.
2. **Get reminded:** add a schedule on an asset → the scheduler notifies in-app and by email → open the asset → Complete.
3. **Find something:** global search, or ask the assistant.
4. **See spend:** the `/costs` page and the dashboard spending panel.
5. **Hand over history:** the printable report and the zip of files.
6. **Health:** log visits, medications and observations, then print a medical summary.

### Target users (inferred)

- The README targets **self-hosting homeowners with a NAS** (Synology/Unraid language, `README.md:162`, `:182`).
- These are typically one technically capable household admin, plus a partner or family as standard users.
- **Assumption:** the real user base is very small today. The GitHub repo showed 12 stars and 0 forks on 2026-10-09 ([repo](https://github.com/yatzin/home-center)). No user research or telemetry exists, which is by design.

---

## 2. Strengths and existing differentiators

1. **Breadth in one coherent model.** Homes, vehicles, equipment and family health share one maintenance, warranty, cost and document spine. Most self-hosted tools cover a single slice (see `competitive-and-strategic-analysis.md`).
2. **A genuinely local document pipeline.**
   - OCR, FTS5 and embeddings all run in the container.
   - Models are pinned and checked by sha256 (`lib/documents/embed/models.ts`).
   - `allowRemoteModels=false` (`workers/embed-worker.mjs`).
   - This is rare among self-hosted household apps and is the codebase's biggest technical asset.
3. **A careful AI assistant.**
   - Typed tools over an ontology (`lib/llm/ontology.ts`).
   - Answers are grounded in tool output, links are verified, and the system prompt says to "treat document text as data" (`lib/llm/prompt.ts:27-35`).
   - Health data is gated twice (`lib/llm/tools/documents.ts:103-111`).
   - It works with small local models (README guidance at `README.md:314-318`).
4. **Privacy defaults that mean something.** The assistant is off until configured, health documents are hidden from the assistant by default (`schema.prisma:558`), chats are never stored server-side, and the only network calls are opt-in.
5. **Low operational footprint.** One container, SQLite, amd64 and arm64 images (`.github/workflows/docker-publish.yml`), migrations on boot (`docker-entrypoint.sh`).
6. **Thoughtful notification semantics.**
   - Cycle keys stop duplicate reminders, three repeat modes are available, and per-user digests are supported (`lib/notifications/repeat.ts`).
   - These are better than typical hobby projects.
7. **Good test discipline on pure logic.** 71 test files and about 528 cases, mostly documents, LLM, auth and uploads (`vitest.config.ts`, `lib/**/*.test.ts`).

---

## 3. Architectural capabilities worth building on

| Capability | Where | Leverage for new features |
|---|---|---|
| Text extraction + OCR for any upload | `lib/documents/extract/*`, `lib/documents/indexer.ts` | Already produces text for every receipt. Today it is used only for search; it could pre-fill records. |
| FTS5 + vector index, RRF fusion | `lib/documents/index-db.ts`, `lib/documents/embed/fusion.ts` | Duplicate detection, "related documents" on a record, matching a document to an asset. |
| Record embeddings with change hooks | `lib/search/entities/*`, `lib/prisma.ts:11-16` | Can suggest which asset a new document belongs to. |
| OpenAI-compatible client with streaming and timeouts | `lib/llm/client.ts`, `lib/llm/agent.ts` | Optional structured extraction (JSON) with the same provider settings. |
| Due-date engine | `lib/maintenance-due.ts` | Shared by the dashboard, notifications and the assistant. A single place to add snooze, mileage projection and calendar export. |
| Notification checker + digest | `lib/notifications/*` | Can be extended to new due-item kinds (renewals, recalls) with no new infrastructure. |
| Report loader | `lib/report-server.ts` | The basis for a full export or a "home history" packet. |
| Per-asset zip builder | `app/api/assets/[type]/[id]/download/route.ts` (fflate) | The basis for a full-archive export. |
| Feature toggles | `lib/features*.ts` | Pattern for keeping new modules optional. |

---

## 4. Missing or incomplete workflows (observed)

### 4.1 The reminder-to-record loop is broken
- `completeMaintenanceSchedule` updates the dates and may raise the odometer. It **does not create a service record** and captures no cost, vendor, notes or files (`lib/actions/maintenance.ts:76-116`).
- Saving a service record **does not advance** a matching schedule and does not update `Vehicle.currentMileage` (`lib/actions/service-records.ts`; no references to `maintenanceSchedule` or `currentMileage`).
- The result: completed maintenance never appears in service history or costs unless the user enters it twice.
- The README demo "Reminder to done" shows completion. It does not show that the history stays empty.

### 4.2 No snooze, skip or pause
- `isActive` exists in the schema, but `clean()` forces it to `true` (`lib/actions/maintenance.ts:36`).
- No UI toggles it. The only way to defer is to edit the due date.

### 4.3 Nothing is actionable outside the asset page
- The dashboard Reminders panel, `/maintenance`, `/records`, `/warranties` and notifications are display or navigation only (`app/(app)/page.tsx:151-209`, `app/(app)/maintenance/page.tsx:87-170`).
- There is no global quick-add. Empty states tell users to go to an asset page (`app/(app)/records/page.tsx:102`).

### 4.4 Documents cannot exist on their own
- Uploading requires an existing record (`app/api/uploads/route.ts:20-31`).
- A car title, a house deed, an appliance manual or a receipt for a not-yet-created asset has no natural home.
- There is no "unfiled" inbox and no document-first creation.

### 4.5 No data portability
- No full export (JSON/CSV) and no import (`grep` for csv, export or backup is negative outside MIME tables).
- No in-app backup or restore. PLANNING floats `/settings/backup` (`PLANNING.md:416`).
- The per-asset zip leaves out maintenance-schedule attachments (`download/route.ts` queries only service, warranty and health types).
- A property zip leaves out its equipment's files, although the tabs show them.

### 4.6 Mobile capture is weak
- There is no PWA manifest or service worker (`public/` holds only starter SVGs, and `app/layout.tsx` has no manifest).
- No file input sets `accept` or `capture` (`components/attachments/attachment-list.tsx:75`, `components/service-records/service-record-form-dialog.tsx:361`).
- The service-record dialog has no `max-h` or overflow handling and uses a fixed `grid-cols-2` (`service-record-form-dialog.tsx:205,240`).
- That dialog is the one most likely to be used on a phone.

### 4.7 No onboarding
- A new install shows zeroes and empty messages.
- There are no maintenance templates or presets. The only hint is placeholder text ("Oil Change") in `components/maintenance/maintenance-form-dialog.tsx`.
- The demo seeder is CLI-only and **wipes the whole database** (`DEMO-DATA.md`, `prisma/seed-demo.ts`).

### 4.8 Mileage is a single number
- There is no odometer history table.
- Mileage-only schedules on `/maintenance` sort by date, as acknowledged in `app/(app)/maintenance/page.tsx:22-25`.
- Nothing projects when a mileage-based item will fall due.

### 4.9 Money is narrow
- Costs come only from service records.
- There are no recurring or fixed costs (insurance premiums, property tax, registration).
- Insurance covers people only, with kinds MEDICAL, DENTAL, VISION and OTHER (`schema.prisma:101-106`). There is no home or auto policy.
- USD is hard-coded (`lib/costs.ts:117-131`). There is no km unit (`MeterUnit` is MILES or HOURS).

### 4.10 Household collaboration is flat
- Every recipient gets every notification (`lib/notifications/checker.ts:53-57`).
- There are no assignees, no "who did this" display beyond `createdById`, and no audit trail.
- Any standard user can delete anything (`lib/actions/*` check only that a session exists).

---

## 5. Defects and risks found during discovery (fix before adding features)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| D1 | **Fixed 2026-10-10 (`e4bb753`):** `lib/asset-delete-server.ts` `deleteAssetWithRecords` now deletes the asset's service records, warranties, schedules and documents in one transaction, plus their upload folders. A property's equipment is kept, unlinked, and the property confirm says so. *Original finding:* **Deleting a property, vehicle or equipment leaves its service records, warranties and schedules orphaned**, while the confirm dialog says "This will also delete all associated records." | Confirm text at `components/vehicles/vehicle-list.tsx:63`, `components/properties/property-list.tsx:68`, `components/equipment/equipment-list.tsx:84`. The actions delete only the row and its upload folder (`lib/actions/vehicles.ts:65-75`, `properties.ts:59-69`, `equipment.ts:65-75`). People do cascade (`lib/actions/people.ts:55-56`). `/maintenance` already renders "Unknown" for orphans (`app/(app)/maintenance/page.tsx:142`). | High: data integrity, and the UI tells the user something untrue |
| D2 | **Fixed 2026-10-10 (`2805f9c`):** `proxy.ts` lets `/api/health` through without a session, and the route runs `SELECT 1`, answering 503 on failure. *Original finding:* **The compose healthcheck probably never tests the database.** `/api/health` is not excluded from `proxy.ts` and is not public, so an unauthenticated `wget` is redirected to `/login`, which returns 200. | `proxy.ts:12-21,36`, `docker-compose.yml` healthcheck. *Inferred, not executed.* | Medium: a broken DB looks healthy |
| D3 | Maintenance-schedule attachments are missing from the "Download all files" zip, and so is a property's equipment. | `app/api/assets/[type]/[id]/download/route.ts:30-37` | Medium: "download all" is not all |
| D4 | CI builds and pushes images with no tests or lint. | `.github/workflows/docker-publish.yml` | Medium: regressions ship straight to `latest` |
| D5 | No tests for `scheduleDue`, the notification checker or digest, cost bucketing, server actions or authorization. | `vitest.config.ts`, test inventory | Medium |
| D6 | The login throttle keys on the last `X-Forwarded-For` value, which is spoofable without a reverse proxy. | `lib/login-throttle.ts:66-70` | Low to medium |
| D7 | Delete handlers show a success toast without checking the action's result, so a failed delete would still say "deleted". | e.g. `components/maintenance/maintenance-list.tsx:102-106` (pattern seen here; other lists not each checked) | Low |
| D8 | Clickable cards and rows are not keyboard-reachable. The Complete dialog's labels are not linked to its inputs. | `components/assets/asset-collection.tsx:96,147-153`; `maintenance-list.tsx:295-302` | Low: accessibility |
| D9 | `docker-compose.yml` in the repo ships a literal example `AUTH_SECRET` and `ADMIN_PASSWORD: "changeme"`. The README compose leaves the secret blank, which is better. | `docker-compose.yml:15` | Low: a copy-paste risk |

---

## 6. Documentation and code discrepancies

| Document says | Code does | Where |
|---|---|---|
| PLANNING: Next.js 15 and better-sqlite3 | Next 16.2.12 and the Prisma 7 libsql adapter | `PLANNING.md:13-14`; `package.json` |
| PLANNING: role enforcement in `middleware.ts`; only ADMIN deletes records | `proxy.ts` checks only authentication; any USER can delete | `PLANNING.md:235-240`; `proxy.ts`; `lib/actions/*` |
| PLANNING: Alpine image, `NEXTAUTH_*`, named volume | Debian slim, `AUTH_SECRET`/`AUTH_URL`, bind mount, migrate and seed in the entrypoint | `PLANNING.md:330-370`; `Dockerfile`; `docker-entrypoint.sh` |
| PLANNING: daily job, `EmailChannel` stub | A 6 h in-process timer; email is a digest rather than a channel | `PLANNING.md:249-270`; `lib/notifications/channels.ts:38` |
| PLANNING: LLM through the OpenAI SDK and `OPENAI_API_KEY` | `fetch` to any OpenAI-compatible endpoint; key encrypted in the DB | `PLANNING.md:318-326`; `lib/llm/client.ts` |
| PLANNING: "FinancialTransactions" future phase | Never built | `PLANNING.md:275-307` |
| PLANNING: "Skip / snooze" on `/maintenance` | Does not exist | `PLANNING.md:191-192` |
| README: `NOTIFY_INTERVAL_MINUTES` checks "due maintenance and expiring warranties" | Also refills, vaccines and insurance | `README.md:224`; `lib/notifications/checker.ts:66-68` |
| README: "one-click zip downloads" of an asset's files | Zip omits maintenance attachments and property equipment | `README.md:50,60`; D3 |
| README feature table: "Records & export" | No data export exists, only file zips and print | `README.md:50` |
| `proxy.ts` lists `/setup` as public | No `/setup` route exists | `proxy.ts:12` |
| `NotificationType.CUSTOM` | Nothing produces it | `schema.prisma:126-133` |
| Asset delete confirmation | See D1 (fixed: the confirmation is now true) | |

PLANNING.md reads as the original design. It is now historical, and contributors may be misled by it.

---

## 7. Product limitations and friction (summary)

- **Navigation depth.** Logging a service means: sidebar → list → asset → tab → Add → dialog. There is no shortcut from a reminder.
- **Double entry.** Completing a reminder and logging a service are separate tasks.
- **Data in, not out.** Users can put years of history in and get only zips and printouts out. For a "household memory" this is the main trust gap.
- **English and USD only.** OCR, UI, currency and miles are fixed. This limits adoption in the EU-heavy self-hosted community. *Assumption: based on the general composition of r/selfhosted-type audiences; not measured.*
- **The AI assistant is powerful but optional and read-only.** Its value depends on users already having entered data, so it does nothing for the cold-start problem.
- **Semantic search is opt-in per query** and not remembered (`components/global-search.tsx:9-10`). Its results appear in a separate block rather than fused.

---

## 8. Improve these before adding new features

1. ~~**Fix D1 (orphaned records) and D2 (healthcheck).** Integrity and honesty come first.~~ **Done 2026-10-10** (`e4bb753`, `2805f9c`). Neither fix has a regression test yet.
2. **Close the reminder → service record loop** (§4.1), and make the existing `isActive` field real (pause), plus snooze (§4.2). This is the core job the README sells.
3. **Make "Download all files" complete** (D3).
4. **Add tests and lint to CI** for the due engine and the notification checker (D4, D5) before changing them.
5. **Mobile basics.** Add `accept`/`capture` to file inputs and fix the service-record dialog overflow (§4.6).
6. **Mark PLANNING.md as historical,** or refresh it.

These are prerequisites for, or parts of, the top roadmap items in `prioritized-roadmap.md`.
