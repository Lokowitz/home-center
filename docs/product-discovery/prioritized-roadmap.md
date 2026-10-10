# HomeCenter: prioritized roadmap

*Product discovery, 2026-10-09. Executive summary of `current-state-assessment.md`, `feature-opportunities.md` and `competitive-and-strategic-analysis.md`. Feature IDs (F1…) and defect IDs (D1…) refer to those documents.*

---

## The answer in one page

1. **Single strongest opportunity.** **Document-first capture (F6):** snap or drop a receipt or invoice, and HomeCenter proposes the record, asset, date, amount and vendor for one-tap confirmation.
   - HomeCenter already OCRs and indexes every file locally. Today that work only feeds search.
   - Turning it into *data entry* attacks the main cost of using the product, and it is something no reviewed self-hosted competitor does with an asset model behind it.
2. **Next three features, in order.**
   1. **Close the maintenance loop** (F1, with F2 snooze/pause and F3 dashboard actions).
   2. **Capture inbox** (F6, with its foundations F7 asset documents and F14 mobile capture).
   3. **Full export, scheduled backup and restore** (F15).
3. **Greatest leverage.** The **local document pipeline**: extraction, OCR, FTS5 and embeddings (`lib/documents/*`, `lib/search/entities/*`). It is built, tested (about 22 test files) and private, and it is under-used.
4. **What could make HomeCenter different.** *Structured household records plus local document intelligence, in one container, with everything exportable.*
   - Paperless has documents but no assets. HomeBox and LubeLogger have assets but no document intelligence. Centriq and Oply combine them, in the cloud.
   - Positioning line: **"The private service history for everything you own: snap the paperwork, it files itself, reminds you what's next, and never leaves your server."**
5. **Stop or avoid:**
   - More assistant knobs or tools before capture exists.
   - Assistant write access.
   - Server-side chat history.
   - Budgeting or bank sync, chores and groceries, native apps, SaaS, IoT.
   - Expanding the health module further until the core loop is fixed.
   - Details in §6.
6. **What would change this.** See §8. The biggest swing factor is whether offline parsing gets date and total right on real receipts (the F6 spike).

---

## 1. Scoring method

Six criteria, each scored 1–5:
- **UV:** user value
- **Fr:** frequency or urgency
- **Df:** differentiation
- **Ad:** adoption or retention potential
- **Fs:** technical feasibility
- **Cf:** confidence in the evidence

**Weighted score** = 2·UV + 1.5·Df + 1.5·Fs + Fr + Ad + Cf, for a maximum of 40. The weights follow the brief's emphasis on value, differentiation and feasibility.

**Effort:** S (days), M (1–2 weeks), L (3–6 weeks). **Maintenance:** Lo, Med or Hi.

These numbers are structured judgement, not measurement. Nobody has done user research yet, so **Cf is low wherever demand is assumed**. The scores rank options. They do not decide alone. Where the ranking below departs from pure score, the reason is stated.

## 2. Top opportunities, ranked

| Rank | Opportunity | UV | Fr | Df | Ad | Fs | Cf | Score | Effort | Maint. | Key trade-off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **F1 Close the maintenance loop** (+F2 snooze/pause, +F3 actionable dashboard) | 5 | 4 | 2 | 5 | 5 | 5 | **34.5** | S–M | Lo | Not differentiating, but the core job is broken without it. Every later feature creates records that should satisfy reminders. |
| 2 | **F6 Capture inbox** (document-first records) | 5 | 4 | 5 | 4 | 3 | 2 | **32.0** | L | Med | Highest upside and highest uncertainty. Parsing accuracy is unproven, so a spike comes first. |
| 3 | **F15 Full export, backup and restore** | 4 | 2 | 3 | 4 | 4 | 4 | 28.5 | M | Med | Ranked above its score: it is the trust prerequisite for "authoritative household memory" and for any growth push. |
| 4 | **F4 Maintenance starter plans** | 4 | 3 | 3 | 4 | 5 | 3 | 30.0 | S–M | Lo–Med | Cheap onboarding win. The content must be labelled generic. Shipped with rank 1. |
| 5 | **F7 Asset-level documents** | 4 | 3 | 3 | 4 | 4 | 4 | 29.5 | M | Lo | A foundation for F6. Worth having on its own for manuals and titles. |
| 6 | **F14 Installable mobile capture** (PWA, camera, quick actions) | 4 | 4 | 2 | 4 | 5 | 3 | 29.5 | S | Lo | Unlocks capture where the paper is. iOS install needs HTTPS. |
| 7 | **F11 Calendar (ICS) feed** | 3 | 4 | 3 | 4 | 5 | 3 | 29.0 | S | Lo | Puts reminders where households already look. The feed URL is a secret, so it defaults to no health data. |
| 8 | **F9 Renewals and fixed costs** | 4 | 3 | 3 | 4 | 4 | 2 | 27.5 | M | Lo–Med | High-consequence deadlines. Must not grow into a ledger. |
| 9 | **F5 Odometer log and mileage projection** | 3 | 3 | 3 | 3 | 4 | 3 | 25.5 | M | Lo | Makes mileage reminders work unattended. |
| 10 | **F10 Repair-or-replace signals** | 3 | 2 | 4 | 3 | 4 | 2 | 25.0 | S–M | Med | The first honest "proactive" feature. It needs cost data density that most installs probably lack today. |

**Just outside the top 10:**
- F8 related documents: 25.0
- F19 km and currency: about 24. Move it up if the audience proves non-US.
- F13 task owners: 23.0
- F16 history packet: 23.0
- F17 emergency binder: 22.0
- F12 import: 20.5. Its adoption value is real but rests on unknown switcher demand.
- F18 recalls: 17.5

## 3. The three strongest candidates for the next major feature

| Candidate | Why it could be next | Why not |
|---|---|---|
| **F1 Close the loop** | Every user, every week. It fixes the core promise ("Reminder to done", README demo). Small. No new risk. | Not exciting, and it will not attract new users by itself. |
| **F6 Capture inbox** | Changes the product's perceived value. Uses the strongest existing asset. Differentiating. | Large and uncertain: depends on parsing accuracy, mobile access, and a schema change for unfiled files. |
| **F15 Export and backup** | Builds trust. Answers "what if this project dies?" Low controversy. | Rarely used. Value is insurance-like, not daily. |

## 4. Recommended first build: **F1 Close the maintenance loop** (with F2 and F3)

**Why this one first, ahead of the higher-upside F6:**
1. **It fixes something users already believe works.**
   - Completing a reminder writes no history and no cost (`lib/actions/maintenance.ts:76-116`).
   - Logging a service leaves the reminder overdue (`lib/actions/service-records.ts`).
   - Every week of use widens the gap between what households did and what HomeCenter knows.
2. **It is a dependency of F6.** A captured invoice for an oil change should complete the oil-change reminder. Without F1's link between record and schedule, F6 would recreate the same double entry.
3. **It is small and well-understood.**
   - Schema changes: a nullable `ServiceRecord.maintenanceScheduleId` and `MaintenanceSchedule.snoozedUntil`.
   - `isActive` already exists.
   - It is deterministic and easy to test, and it touches code the maintainer knows well.
4. **It makes the dashboard the place to act**, which improves every later feature's reach.

**Definition of done for F1:**
- Complete can log cost, vendor, notes and files as a service record, in one transaction.
- Saving a service record offers to complete a matching schedule. Both directions raise the odometer when the value is higher.
- Reminders can be snoozed, skipped, paused and resumed.
- The dashboard and the bell allow Complete and Snooze inline.
- Unit tests cover `scheduleDue` with snooze, the title matcher, and the complete-with-record transaction logic. These tests are currently missing (D5).

---

## 5. Implementation milestones

These assume one maintainer working part-time. Durations are rough calendar estimates.

### M0: Integrity and hygiene (about 1 week). **Do this first, whatever else is decided.**
- **D1:** asset deletes must handle their service records, warranties, schedules and attachments. Either cascade them, matching the confirm text, or change the text and offer to reassign. Add a one-off cleanup for existing orphans.
- **D2:** make `/api/health` public in `proxy.ts` so the healthcheck actually probes the database. Add a `HEALTHCHECK` to the Dockerfile.
- **D3:** "Download all files" includes maintenance attachments and a property's equipment.
- **D4 and D5:** CI runs `npm run lint` and `npm test` before publishing the image. Add tests for `scheduleDue` and `lib/notifications/checker.ts` decisions.
- Mark `PLANNING.md` as historical, and fix the README's notification-interval line (see the discrepancy table in the current-state assessment).

### M1: Close the loop (2–3 weeks)
- F1, F2 and F3, as defined in §4.
- **F4 starter plans:** a curated `lib/maintenance-templates.ts`, offered on asset creation and on an empty Maintenance tab.

### M2: Capture foundations and bridges (2 weeks), plus the F6 spike in parallel
- **F14:** manifest, icons, `accept`/`capture` on file inputs, a mobile "+" quick-action sheet, and the service-dialog overflow fix.
- **F7:** asset-level documents, the Documents tab, and health gating for person-owned files.
- **F11:** ICS feed with a per-user revocable token. Asset items only by default.
- **F6 spike (about 1 week, offline, no UI):** run the existing extractor plus a prototype deterministic parser on 30–50 real receipts. Record accuracy for date, total, vendor and asset match, with and without an optional LLM pass on a local 7–8B model.
  - **Go/no-go gate:** date and total correct in at least 70% of cases deterministically, *or* in at least 85% with the LLM pass on a model most users can run.

### M3: Capture inbox (4–6 weeks; only if the spike passes)
- An unfiled-document state, with an indexer `reconcile()` exemption.
- The deterministic parser module with fixture tests.
- Asset suggestion: identifier match, then `entity_vec`.
- The Inbox UI with confirm, edit, attach-to-existing, or "keep as asset document".
- Optional LLM extraction behind its own admin toggle, with person-owned files excluded by default.
- `.eml`/`.msg` drop support (extraction is already in progress in `lib/documents/extract/mail.ts`).
- **If the spike fails:** ship the Inbox *without* auto-fill (file-first, manual fields, asset suggestion only), then move M4 earlier.

### M4: Portability (2–3 weeks)
- F15 export: JSON with `formatVersion`, CSVs, a readable file tree, and a static `index.html` viewer.
- Scheduled `VACUUM INTO` backups with retention and a stale-backup warning.
- A `scripts/restore.ts` CLI with a dry run.

### M5: Proactive, data-dependent (later; choose by feedback)
- F9 renewals (implemented as a `Renewal` entity whose "Mark renewed" writes a costed record; **no ledger**).
- F5 odometer log and projection.
- F10 repair-or-replace signals.
- F19 when there is evidence of a non-US audience.
- F13 when there is evidence of multi-user installs.

### Dependency graph

```
M0 integrity ──► M1 F1/F2/F3 (+F4) ──► M3 F6 Inbox
                       │                   ▲
                       │      M2 F7 ───────┤
                       │      M2 F14 ──────┤
                       │      M2 F6 spike ─┘ (gate)
                       ▼
                 M5 F5 (uses readings from F1), F9 (reuses F1 record creation), F10 (needs cost density from F1/F6)
M4 F15 export ── independent; F16 history packet builds on it
F11 ICS ── independent; benefits from F2 (snooze) and F9 (renewals)
```

**Foundational investments** (no direct "wow", but they enable others):
- M0
- The `maintenanceScheduleId` link (F1)
- Unfiled and asset-owned attachments (F7)
- Export format versioning (F15)

**User-facing improvements:** F2, F3, F4, F6, F11, F14, F9, F10.

---

## 6. Defer or avoid explicitly

| Item | Decision | Reason |
|---|---|---|
| Assistant write tools | **Avoid** (for now) | Error-prone on local models and hard to audit. F6 provides reviewed creation. Revisit only as "assistant drafts into the Inbox". |
| More assistant settings and tools | **Pause** | The assistant is already capable (13 tools, link verification). Its value is now limited by the *data volume*, not by its features. |
| Server-side chat history | **Avoid** | Breaks a clear privacy promise for little value. |
| Budgeting, bank sync, general ledger | **Avoid** | Other tools own this. It dilutes the identity. F9 covers asset-linked costs. |
| Chores, groceries, meal planning | **Avoid** | Grocy and Homechart territory. |
| Native mobile apps | **Avoid** | A PWA covers the need. Native would multiply the maintenance load. |
| Hosted SaaS, open-core | **Avoid** | Contradicts the positioning, brings health-data liability, and fragments the community. |
| IoT and sensor integrations | **Defer** | Niche. ICS is the bridge for Home Assistant users. |
| Recall feeds (F18) | **Defer** | US-only, an external dependency, and it breaks "no network unless you ask" unless opt-in. |
| Further health-module breadth | **Defer** | Health is a secondary audience. Fix the shared spine first. Pets (uncommitted `PET` relationship) is fine as a small add. |
| Storage-only upload types (`.7z`, `.rar`, `.gz` in the uncommitted `lib/upload-types.ts` diff) | **Low priority** | Stored but never extracted or searched, so they add little "memory" value. Harmless, but should not grow further. |
| Multi-tenant, per-asset permissions | **Defer** | Households share by design (`README.md:400`). |

---

## 7. Lightweight validation plan

| Opportunity | Cheapest test | Signal to proceed | Signal to stop or reshape |
|---|---|---|---|
| F1 | GitHub Discussion: "When you complete a reminder, do you also add a service record?" Plus dogfooding | Most say "no" or "I forget" | Users say they never want cost on routine tasks. Then default the "Log as record" checkbox off |
| F4 | Post the draft template list and ask "which do you actually track?" | Clear agreement on most items | Wide disagreement. Then ship a smaller core list |
| F6 | **Offline accuracy spike** on 30–50 real documents (M2), plus the poll "would you photograph receipts into HomeCenter?" | Meets the gate in §5 M2 | Below the gate. Ship a file-first Inbox without auto-fill |
| F14 | Poll: "Do you open HomeCenter on your phone? LAN, VPN, or never?" | A meaningful share reach it from phones | "Never". Then F6's mobile value drops and desktop drag-and-drop becomes the priority |
| F15 | Ask in Discussions what a trustworthy export must contain | Requests for readable, offline formats | — (build anyway; it is low risk) |
| F11 | Ship behind a setting | Issues and feedback asking for more item types | No use after release. Leave it as is |
| F9 | "What deadline did your household last miss?" | Renewals are as common as maintenance | Mostly maintenance. Keep F9 small, or drop it |
| Audience breadth | Ask 5–10 users which asset types they track | Most track two or more types | Most track one type. Reconsider the breadth thesis |

**No telemetry is proposed.** Signals come from conversations, polls and issues, plus optional local counts shown only to the admin (next section).

---

## 8. Success measures

**Measurable locally, never sent anywhere.** These could be displayed on an optional admin "Household stats" card.

| Measure | Baseline (expected, unmeasured) | Target after the feature |
|---|---|---|
| Share of reminder completions that produce a service record (F1) | 0% (impossible today) | ≥ 60% |
| Overdue items older than 30 days (F1, F2, F3) | Unknown | Falling month over month |
| Maintenance schedules per asset in the first week after creation (F4) | Low (no templates) | ≥ 3 for vehicles and properties |
| Service records with at least one attachment (F6, F14) | Unknown | Rising. Target ≥ 50% of new records |
| Median time from upload to a filed record (F6) | n/a | < 1 minute of user time; < 2 minutes of processing on a NAS |
| Inbox items unfiled for more than 14 days (F6) | n/a | < 10% |
| Field accuracy on the fixture set (F6) | Spike result | Does not regress between releases (CI) |
| Successful scheduled backups in the last 7 days (F15) | n/a | 7/7 with no warnings |

**Community signals**, as directional proxies only:
- GitHub stars, forks and Discussions activity (12 stars and 0 forks on 2026-10-09)
- Container pulls, if visible on GHCR
- Issues opened by people other than the maintainer
- Presence in the Unraid CA and other app catalogues

**What would change these recommendations:**
- **The F6 spike fails badly** (deterministic accuracy below about 50%, and local LLMs no better). Capture becomes file-first only, and F15 export plus F9 renewals move up.
- **Users rarely reach HomeCenter from phones.** F14 drops. F6 is still worth it through desktop drag-and-drop and `.eml` forwarding, but the value is smaller.
- **Most installs track one asset type**, such as vehicles only. The breadth thesis weakens. Consider deeper vehicle features (fuel, import from LubeLogger and Fuelly) or a narrower positioning.
- **Users report that trust or data safety is the blocker.** Swap the order and put F15 before F6.
- **Strong non-US demand.** F19 (km and currency) moves into M1, because it is cheap and a visible "this is for me" signal.
- **Multi-user households turn out to be the norm.** F13 (owners and targeted reminders) moves into M2.
- **Evidence of willingness to pay for off-site encrypted backup.** Only then evaluate the hosted relay in the business-models section.
