# Cost planning, manual references and property insurance

Date: 2026-10-24
Branch: `feat/userSuggestionsCostPlanning`

## Why

A user who found HomeCenter through a video sent seven suggestions. All of them push the app from "what happened" toward "what's coming and what it will cost", which fits the existing Home and Money pillars. The user praised how simple the app is, so every addition here is optional, and an empty field shows nothing.

Suggestions, mapped to steps:

| # | Suggestion | Step |
|---|---|---|
| 1 | Seasonal, quarterly or fixed-month reminder intervals | 1 |
| 2 | Estimated cost on maintenance | 1 |
| 7 | Planned one-time work with a cost (roof, paint, tires) | 1 |
| 5 | Equipment cost per property, split into part-of-the-home and belongings | 2 |
| 6 | Planned replacement with lifespan and cost | 2 |
| — | Forecast of planned spend (uses 2, 6, 7) | 3 |
| 3 | Tie a manual page to a reminder | 4 |
| 4 | Home, auto, umbrella and life insurance with coverages, premiums and documents | 5 |

## Goals

- A reminder can carry an estimated cost, repeat on fixed months, or happen once.
- Equipment knows whether it is part of the home, how long it should last and what replacing it costs.
- The Costs page and asset pages show planned spend for the next 12 months.
- A reminder can point at a page of a manual already filed on the asset.
- Property, vehicle, umbrella and life policies live in HomeCenter whether or not Health is on, with premium history to spot price creep.

## Non-goals

- Depreciation math. Age against expected life covers the need without accounting.
- Comparing insurance quotes or shopping for carriers.
- Counting insurance premiums as spend on the Costs page.
- Projecting mileage-only reminders into the forecast (there's no mileage-per-month rate to project from).
- Any change to the home dashboard.

## Anti-goals

- New required fields, or forms that look busier when the new fields are empty.
- Data from the Health side becoming visible when Health is off.

## Constraints

- **Don't touch the dashboard.** That means `app/(app)/page.tsx` and `components/dashboard/*`. A large dashboard rework is uncommitted on another branch. Every schema change here is additive, so the dashboard's existing queries keep working.
- This Next.js version differs from what models have seen in training. Read the relevant guide in `node_modules/next/dist/docs/` before writing route or page code.
- Read `prisma/schema.prisma` before data changes. Migrations use `prisma migrate dev` (`npm run db:migrate`), stored as `prisma/migrations/YYYYMMDDHHMMSS_snake_name/`. The database is SQLite (libSQL), which has no array columns.
- Tests use Vitest and cover pure logic in `lib/**/*.test.ts` only. New logic goes in pure functions with tests beside them.
- Changes to one of the people, property or vehicle detail pages are checked against the other two (repo CLAUDE.md).
- Money is shown with the existing regional currency formatting (`lib/regional.ts`, see `2026-10-14-regional-units-currency-design.md`).
- The server enforces Health off, not just the UI (commit 1db3963, finding L5). New insurance code keeps that rule.
- Done for each step means `npm run lint`, `npm test` and `npx tsc --noEmit` pass. No new lint warnings (8 already exist).

## Step 1: Maintenance cost, one-time items and calendar schedules

### Schema (`MaintenanceSchedule`)

- `estimatedCost Float?`
- `dueMonths String?`: a comma-separated list of months, 1–12, stored sorted and unique, e.g. `"4,10"`. Null means not a calendar schedule.
- `dueDay Int?`: day of month, 1–28, default 1 when `dueMonths` is set. Capped at 28 so every month has it.

### Kinds of schedule (derived, not stored)

- **Interval**: `intervalDays` and/or `intervalMiles` set. This is what exists today.
- **Calendar**: `dueMonths` set. It can't be combined with `intervalDays` or `intervalMiles`, and the server action rejects that combination.
- **One-time**: none of the three set. It has a `nextDueDate` and/or `nextDueMileage`.

Add a pure helper (e.g. `scheduleKind()` in `lib/maintenance-complete.ts` or a new `lib/maintenance-schedule.ts`) and use it everywhere instead of re-checking fields.

### Next due date

- **Calendar, on create:** the first `dueMonths`/`dueDay` date on or after today, unless the user typed a date.
- **Calendar, on complete and skip:** the first occurrence strictly after the later of the completion date and the current `nextDueDate`. Completing an April 1 task on March 25 or on May 10 both give October 1 for `"4,10"`. `canSkip` returns true for calendar schedules.
- **One-time, on complete:** `nextDueDate` and `nextDueMileage` become null and `lastCompletedDate` is set. The item drops out of due counts and notifications, because those filter on `nextDueDate` (`lib/maintenance-due.ts` `dueCandidateFilter`). It stays listed on the asset as "Done {date}". This changes today's behaviour, where a schedule without an interval keeps its old date and stays overdue after completion. That old behaviour is a bug.
- Interval schedules don't change.
- **Existing stuck rows (user decision):** the step 1 migration includes a data step that fixes reminders already stuck by the old behaviour. It touches only rows with no `intervalDays` and no `intervalMiles`:
  - Where `lastCompletedDate >= nextDueDate`, it sets `nextDueDate` to null.
  - Where `lastCompletedMileage >= nextDueMileage`, it sets `nextDueMileage` to null.

  It leaves every other row alone. Write the rule as SQL in the migration, and mirror it in a pure predicate with a test.

### Form (`components/maintenance/maintenance-form-dialog.tsx`)

- A "Repeats" control with three choices: every N days/miles (today's fields), on set months (a 12-month toggle row plus the day), or once. Picking "once" hides the interval fields and keeps the due date and mileage.
- Day presets beside `intervalDays`: Monthly 30, Quarterly 91, Twice a year 182, Yearly 365. They fill the field and nothing more.
- An "Estimated cost" field.

### Display

- The interval column in `components/maintenance/maintenance-list.tsx` (:229) and `app/(app)/maintenance/page.tsx` shows "Every 90 days", "Apr, Oct" or "Once". Put the label in a pure function so both places use it.
- An "Est. cost" value on rows that have one.
- In `complete-dialog.tsx`, the cost input uses the estimate as its placeholder ("Est. $X"), never as a prefilled value. That keeps an estimate from being logged as an actual cost.
- Room views (`components/rooms/room-list.tsx`, `room-panels.tsx`) use the same label function.

### Templates (`lib/maintenance-templates.ts`)

- Templates accept `dueMonths`/`dueDay`. Add seasonal property templates: "Service A/C" (April), "Start up sprinklers" (April), "Winterize sprinklers" (October), "Service furnace" (October).
- `lib/actions/maintenance.ts:245` accepts a calendar template as having a schedule.
- `firstDue()` handles calendar templates.

### Ripple

- LLM: `lib/llm/ontology.ts` (:193) adds `estimatedCost`, `dueMonths` and `dueDay`. The `maintenance_status` tool (`lib/llm/tools/shortcuts.ts` :388) outputs the schedule label and the estimate.
- Backup: `lib/backup/readable.ts` (:185) adds `repeats` (the label) and `estimatedCost` columns. The snapshot copies tables generically, so it needs no change.
- Intake's matching reminder (`lib/maintenance-match.ts`) and service-record completion (`lib/service-record-server.ts`) go through `scheduleCompletionWrites`, so they pick up the new rules automatically. Confirm with a test.
- `prisma/seed-demo.ts`: give a few demo reminders an estimate, one calendar schedule and one one-time item.

## Step 2: Equipment value and lifespan

### Schema (`Equipment`)

- `valueClass EquipmentValueClass?` with a new enum: `FIXTURE` (part of the home) and `CONTENTS` (belongings). Null means use the category default.
- `expectedLifeYears Int?`
- `replacementCost Float?`

Category defaults go in a pure function next to `components/equipment/categories.ts` (or in `lib/`): HVAC, WATER and SECURITY count as FIXTURE. APPLIANCE, ELECTRONICS, TOOL, OUTDOOR and OTHER count as CONTENTS. The user overrides per item, so an oven can be set to FIXTURE.

### Form (`components/equipment/equipment-form-dialog.tsx`, `lib/asset-input.ts`)

- "Counts as": Default (shows what the category gives), Part of the home, Belongings.
- "Expected life (years)" and "Replacement cost".

### Equipment detail page (`app/(app)/assets/equipment/[id]/page.tsx`)

- An age stat when `expectedLifeYears` is set and there's a start date (`installDate`, else `purchaseDate`): "12 of 15 years". Past expected life gets the existing warning colour.
- A "Plan replacement" button. It opens the maintenance form dialog prefilled as a one-time item: title "Replace {name}", due on start date + life (or a year from today if that date has passed), estimated cost = `replacementCost`. The user saves or cancels. Nothing is created automatically. The dialog gains an optional `defaults` prop for this.

### Property detail page (`app/(app)/assets/properties/[id]/page.tsx`)

- In the Equipment tab (`components/equipment/property-equipment.tsx`), a value summary above the rows. For each class it shows a paid total (sum of `purchasePrice`) and a replacement total (sum of `replacementCost`) when any item has one. It also counts items with no price: "3 items have no price".
- The totals come from a pure function with a test.
- People and vehicle detail pages have no equipment, so they don't change.

### Ripple

- LLM ontology equipment entity, `readable.ts` equipment columns, demo seed.

## Step 3: Planned spend forecast

### Logic

A pure function `forecastSchedules(schedules, from, months = 12)` in a new `lib/forecast.ts`, with tests. It expands each active schedule that has an `estimatedCost` into dated occurrences inside the window:

- Interval schedules (day-based): `nextDueDate`, then every `intervalDays`.
- Calendar schedules: every listed month.
- One-time items: once, if due inside the window.
- Mileage-only schedules are left out and counted, so the UI can say "2 mileage-based reminders aren't included".
- Overdue items count once, in the current month.

Snoozed items still count, because a snooze hides the reminder without moving the due date. Paused items (`isActive` false) don't count.

### Costs page (`app/(app)/costs/page.tsx`)

- A new "Planned, next 12 months" section after the existing panels. It shows a total, a bar per month (reuse `components/charts/trend-chart.tsx` or `ranked-bars.tsx` if they fit), and a list of the largest planned items linking to their asset.
- It respects the `type` filter and ignores `year`, `bucket` and `category`.
- Data comes from a new loader beside `loadCostRecords()` in `lib/costs-server.ts`. Person schedules are included only when Health is on.

### Asset pages

- `components/costs/asset-cost-panel.tsx` adds "Planned, next 12 months: $X" when it isn't zero.
- That panel appears on all four detail pages, so check people, properties and vehicles together, plus equipment. A property includes its equipment's schedules, matching how the property page already gathers them (:50–72).

## Step 4: Manual reference on a reminder

### Schema (`MaintenanceSchedule`)

- `referenceAttachmentId String?` with a relation to `Attachment`, `onDelete: SetNull`. The back relation on `Attachment` is `referencedBySchedules MaintenanceSchedule[]`.
- `referencePage Int?`, starting at 1.

### Form

- "Manual" select listing the DOCUMENT attachments on the schedule's asset (`assetType`/`assetId` match) and files already attached to this schedule.
- A page number input appears once a file is picked.
- A "Find page" button runs a pure function over `AttachmentText.text`. The text is split on `"\f"` into pages, and the function returns the first page that contains the most title words. It's shown only when the file has extracted text. This is the last piece of the step and can be cut if it grows.
- The server action checks that the attachment belongs to the same asset or to this schedule.

### Display

- On reminder rows (`maintenance-list.tsx`) and in `complete-dialog.tsx`: a "Manual, p. 42" link to the existing file route (`/api/files/document/{assetId}/{filename}#page=42`, or the maintenance path for files on the schedule). PDFs already open inline (`app/api/files/[...path]/route.ts` :53). Non-PDFs link without `#page`.
- The file route's existing Health and Rooms checks apply unchanged.

### Ripple

- LLM ontology: expose the reference as a field the assistant can mention.
- `readable.ts`: a `manual` column (file name and page).
- Confirm that backup restore copies `MaintenanceSchedule` after `Attachment`, or that foreign keys are deferred during restore (`lib/backup/restore.ts`).

## Step 5: Property, auto, umbrella and life insurance

### Decision (user)

Home, auto and umbrella policies get their own Insurance section that always shows. Medical, dental and vision stay behind the Health switch.

### Schema

`InsuranceKind` gains `HOME`, `RENTERS`, `AUTO`, `UMBRELLA`, `LIFE` and `PROPERTY_OTHER` (shown as "Other"). A pure `isHealthInsuranceKind(kind)` returns true for `MEDICAL`, `DENTAL`, `VISION` and the existing `OTHER`. The existing `OTHER` stays health-gated because every current policy was created under Health. Its label becomes "Other (health)".

On `InsurancePolicy`:

- `properties Property[]` and `vehicles Vehicle[]` (implicit many-to-many, real foreign keys). An auto policy can cover two cars, and a home policy can cover a house and a cabin.
- `premiums InsurancePremium[]` and `coverages InsuranceCoverage[]`.

New models:

```prisma
model InsurancePremium {
  id            String          @id @default(cuid())
  policyId      String
  policy        InsurancePolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  effectiveDate DateTime
  amount        Float
  period        PremiumPeriod   @default(ANNUAL)
  notes         String?
  createdAt     DateTime        @default(now())

  @@index([policyId])
}

enum PremiumPeriod {
  MONTHLY
  SEMIANNUAL
  ANNUAL
}

model InsuranceCoverage {
  id         String          @id @default(cuid())
  policyId   String
  policy     InsurancePolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  label      String
  limit      Float?
  deductible Float?
  sortOrder  Int             @default(0)

  @@index([policyId])
}
```

### Visibility and enforcement

- Remove `/insurance` from `HEALTH_PATHS` (`lib/features.ts:26`). Move the sidebar item from the Health section to the Home section, after Equipment (`components/sidebar.tsx` :19–34).
- `app/(app)/insurance/page.tsx` drops `requireHealth()`. With Health off it loads only non-health kinds and doesn't load people.
- `lib/actions/insurance.ts` refuses to create, update or delete a health-kind policy while Health is off. It also refuses a non-health policy whose `members` are set while Health is off.
- Renewal notifications for non-health kinds use a new `NotificationType` value, `POLICY_RENEWAL`.
  - `INSURANCE_EXPIRING` is in `HEALTH_NOTIFICATION_TYPES` (`lib/features.ts:19`). With Health off, `visibleNotificationsWhere` (`lib/features-server.ts:31`) and `lib/llm/query.ts:287` hide it, so it can't be reused.
  - `lib/notifications/checker.ts` (:98) raises `POLICY_RENEWAL` whether or not Health is on, 30 days before `endDate`. Health kinds keep `INSURANCE_EXPIRING`, its gate and its window.
  - Add icon and label entries in `components/notification-bell.tsx` and `app/(app)/notifications/page.tsx`, and a link in `lib/notification-links.ts`.
- Every other reader of `InsurancePolicy` filters by kind when Health is off: LLM ontology (:272) and `shortcuts.ts` (:40, :407), global search, backup readable (export is admin-only and already includes everything, so confirm that rule before changing it), and the file route for `insurance/` attachment paths.
- Extend `lib/llm/health-off.test.ts` and `lib/features.test.ts`.

### Page (`components/insurance/insurance-list.tsx`)

- Policies grouped as Property and auto, Life, then Health (when on).
- Each card shows: carrier and plan, what it covers (linked properties and vehicles, or members), current premium annualised with the change from the previous premium ("+12% vs last term"), the renewal date (`endDate`) with the existing expiry window styling, the coverage lines, and the newest documents first.
- The form shows `groupNumber`, `memberId` and `outOfPocketMax` only for health kinds, and the property/vehicle pickers only for non-health kinds.
- The form also edits coverage lines (add, remove, reorder) with label suggestions per kind:
  - HOME: Dwelling, Other structures, Personal property, Loss of use, Liability, Medical payments.
  - AUTO: Bodily injury, Property damage, Collision, Comprehensive, Uninsured motorist.
  - UMBRELLA: Liability.
  - LIFE: Death benefit.
- A premium history list on the policy with "Add premium" (date, amount, period).
- Premium maths (annualising, change from previous) goes in pure functions with tests.

### Asset detail pages

- Property and vehicle detail pages get an Insurance block listing linked policies. It follows the existing block on the people page (`app/(app)/assets/people/[id]/page.tsx` :101–109), and each policy links to `/insurance?open={id}`. Change the people page links to `?open={id}` too, so the three pages match.
- For a property, the block compares belongings with personal property coverage, so under-insurance is easy to spot. It shows "Belongings to replace: $X, Personal property coverage: $Y".
  - X is the CONTENTS total from step 2. Each item counts its `replacementCost`, or its `purchasePrice` when it has no replacement cost.
  - Y is the sum of the `limit` on coverage lines labelled "Personal property" (matched case-insensitively, trimmed) across all non-health policies linked to the property.
  - The line shows only when both numbers exist. No judgement text.
  - Fixtures aren't compared with Dwelling coverage, because dwelling coverage pays to rebuild the whole house.
  - The step 2 totals function returns both paid and to-replace values per class so this can reuse it.

### Ripple

- Backup `readable.ts`: add kind, premium and covered-assets columns to `insurance.csv`, plus `insurance-premiums.csv` and `insurance-coverages.csv`. Confirm the snapshot table list (`snapshot.ts` :132) picks up the new tables and the implicit join tables.
- Asset delete: implicit many-to-many rows go away when a property or vehicle is deleted. Confirm in `lib/asset-delete-server.ts`.
- Demo seed: a home policy, an auto policy covering the demo truck, with two premiums each.

## Also on this branch (done)

AI privacy warning, from a second user comment. Settings → Assistant shows an amber notice under Base URL when the URL points outside the home network. The notice says questions, records and receipts go to that provider, and mentions health records when Health is on. The check is `isOffNetworkUrl()` in `lib/llm/settings-schema.ts`. It treats as local: localhost, private and CGNAT (Tailscale) IPv4, local IPv6, single-label Docker hostnames, and `.local`, `.lan`, `.internal` and `.home.arpa` names. Tests are in `lib/llm/settings-schema.test.ts`.

## Left to the builder

- Exact component layout and copy within the patterns above.
- Whether the forecast chart reuses `trend-chart.tsx` or `ranked-bars.tsx`.
- Migration names, and splitting a step into more than one migration.
- Commit boundaries inside a step.

## Calls made without the user (check these)

- Depreciation is left out. Age against expected life replaces it.
- Calendar schedules can't be combined with day or mileage intervals.
- Completing a one-time item clears its due date instead of pausing it.
- The estimated cost is a placeholder in the complete dialog, not a prefilled value.
- Equipment value class defaults by category: APPLIANCE counts as belongings.
- Mileage-only reminders stay out of the forecast.
- The existing `OTHER` insurance kind stays health-gated. A new "Other" kind covers non-health policies.
- Life insurance is always visible. Linking it to a person needs Health on.
- Premiums don't count as spend on the Costs page.
- The under-insurance line compares belongings (replacement cost, falling back to price paid) with "Personal property" coverage. Fixtures aren't compared with Dwelling coverage.
- Non-health renewals use a new `POLICY_RENEWAL` notification type with a fixed 30-day lead time.
