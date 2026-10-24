# Step 1: Maintenance cost, one-time items and calendar schedules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reminder can carry an estimated cost, repeat on set months of the year, or happen once.

**Architecture:** There are three new nullable columns on `MaintenanceSchedule`. Every rule about schedule kinds, calendar dates and labels lives in one new pure module, `lib/maintenance-schedule.ts`. Completion, skip, templates, actions and UI all call into it. A data step in the migration fixes one-time reminders that the old completion rule left stuck.

**Tech Stack:** Next.js 16 (app router, server actions), Prisma 7 + SQLite/libSQL, zod, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-cost-planning-and-insurance-design.md`, section "Step 1".

## Global Constraints

- Don't touch `app/(app)/page.tsx` or `components/dashboard/*`.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing page or client component code.
- Read `prisma/schema.prisma` before data changes. Migrations go through `prisma migrate dev` and live in `prisma/migrations/YYYYMMDDHHMMSS_snake_name/`.
- New logic goes in pure functions with Vitest tests beside them (`lib/**/*.test.ts`).
- Show money with `fmt.money` / `fmt.currencySymbol` from `useFormat()` (client) or `getFormat()` (server).
- Every new field is optional. An empty field renders nothing.
- `dueMonths` is stored as a sorted, unique, comma-separated string of 1–12, e.g. `"4,10"`. `dueDay` is 1–28, and defaults to 1 when `dueMonths` is set.
- A calendar schedule can't also have `intervalDays` or `intervalMiles`.
- Calendar dates are built at 12:00 UTC (`Date.UTC(y, m - 1, d, 12)`), matching `firstDue`'s noon convention. Compare by UTC calendar day, not by timestamp.
- **No commits.** The user's rules say don't commit unless asked. Each task ends with a checkpoint, not a commit.
- A task is done when `npx vitest run`, `npx eslint .` (no new warnings beyond the existing 8) and `npx tsc --noEmit` all pass.

## Review Focus

1. **Day boundary on calendar completion.** A task due April 1 completed on April 1, at any hour and with the due date stored at either midnight or noon, moves to the next listed month, never back to April 1. Task 2 tests this.
2. **Year wrap.** `"4,10"` completed November 3 gives April 1 of the next year. A single month `"10"` completed October 20 gives October 1 of the next year. Task 2 tests this.
3. **Editing kinds.** Switching an existing interval reminder to "On set months" clears `intervalDays` and `intervalMiles` on save, and switching back clears `dueMonths` and `dueDay`. Leftovers would make the action reject the save. Task 4 tests the normaliser.
4. **Mileage-only one-time items.** A one-time item with only `nextDueMileage` (tires at 60,000 mi) is completed, and its due mileage clears. Task 3 tests this.
5. **The stuck-row fix doesn't touch live reminders.** A no-interval reminder with `lastCompletedDate` before `nextDueDate` keeps its date. Task 1 tests the predicate.

---

### Task 1: Schema, migration and stuck-row fix

**Files:**
- Modify: `prisma/schema.prisma` (`model MaintenanceSchedule`, ~:538)
- Create: `prisma/migrations/<timestamp>_maintenance_cost_and_calendar/migration.sql`
- Create: `lib/maintenance-schedule.ts`
- Test: `lib/maintenance-schedule.test.ts`

**Interfaces:**
- Produces: the columns `estimatedCost Float?`, `dueMonths String?` and `dueDay Int?`.
- Produces: `isStuckOneTime(s: { intervalDays: number | null; intervalMiles: number | null; lastCompletedDate: Date | null; nextDueDate: Date | null; lastCompletedMileage: number | null; nextDueMileage: number | null }): { clearDate: boolean; clearMileage: boolean }`

- [ ] **Step 1: Write failing tests** in `lib/maintenance-schedule.test.ts`, inside `describe("isStuckOneTime")`:
  - No intervals, last done 2026-05-02, due 2026-05-01 → `{ clearDate: true, clearMileage: false }`.
  - No intervals, last done equals due → `clearDate: true`.
  - No intervals, last done 2026-04-01, due 2026-05-01 → `clearDate: false`.
  - No intervals, last mileage 60,100, due mileage 60,000 → `clearMileage: true`.
  - `intervalDays: 90`, last done after due → both false.
  - `lastCompletedDate: null` → `clearDate: false`.
- [ ] **Step 2: Run** `npx vitest run lib/maintenance-schedule.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `isStuckOneTime` in `lib/maintenance-schedule.ts`. It's true only when both intervals are null and the matching completed value is greater than or equal to the due value.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add the three fields** to `MaintenanceSchedule`, each with a `///` comment in the file's style:
  - `estimatedCost Float?`: "What one occurrence is expected to cost."
  - `dueMonths String?`: "Calendar schedule: months 1–12, comma-separated and sorted. Can't be combined with an interval."
  - `dueDay Int?`: "Day of month (1–28) for a calendar schedule."
- [ ] **Step 6: Create the migration** with `npx prisma migrate dev --create-only --name maintenance_cost_and_calendar`. Append the data step to the generated `migration.sql`. It mirrors `isStuckOneTime`:

```sql
-- Reminders without an interval used to keep their due value after being
-- completed, so they stayed overdue. Clear the ones already done.
UPDATE "MaintenanceSchedule" SET "nextDueDate" = NULL
WHERE "intervalDays" IS NULL AND "intervalMiles" IS NULL
  AND "lastCompletedDate" IS NOT NULL AND "nextDueDate" IS NOT NULL
  AND "lastCompletedDate" >= "nextDueDate";
UPDATE "MaintenanceSchedule" SET "nextDueMileage" = NULL
WHERE "intervalDays" IS NULL AND "intervalMiles" IS NULL
  AND "lastCompletedMileage" IS NOT NULL AND "nextDueMileage" IS NOT NULL
  AND "lastCompletedMileage" >= "nextDueMileage";
```

  Check that both DateTime columns use the same storage in `prisma/dev.db`, so `>=` compares correctly. Run `SELECT typeof("nextDueDate"), typeof("lastCompletedDate") FROM "MaintenanceSchedule" LIMIT 5`.
- [ ] **Step 7: Apply** with `npx prisma migrate dev`. Expected: the migration applies and the client regenerates under `app/generated/prisma`.
- [ ] **Step 8: Checkpoint.** `npx tsc --noEmit` is clean. Run `git status` and confirm only this task's files changed. Don't commit.

### Task 2: Calendar logic, schedule kind and labels

**Files:**
- Modify: `lib/maintenance-schedule.ts`
- Test: `lib/maintenance-schedule.test.ts`

**Interfaces:**
- Produces:
  - `type ScheduleKind = "interval" | "calendar" | "once"`
  - `type RepeatFields = { intervalDays: number | null; intervalMiles: number | null; dueMonths?: string | null; dueDay?: number | null }`
  - `scheduleKind(s: RepeatFields): ScheduleKind`. Calendar wins if `dueMonths` is non-empty. Otherwise interval if either interval is set. Otherwise once.
  - `parseDueMonths(raw: string | null | undefined): number[]`. Sorted, unique, only 1–12. Bad tokens are dropped.
  - `formatDueMonths(months: number[]): string | null`. `null` for an empty list.
  - `nextCalendarDue(months: number[], day: number, after: Date): Date`. The first `months`/`day` date at 12:00 UTC whose UTC calendar day is strictly after `after`'s UTC calendar day.
  - `firstCalendarDue(months: number[], day: number, today: Date): Date`. The same, but on or after today.
  - `repeatsLabel(s: RepeatFields, meterShort: string): string`. Returns "Every 90 days", "Every 5,000 mi", "Every 180 days or 6,000 mi", "Apr, Oct" (day 1), "Apr 15, Oct 15" (other days) or "Once". Month names are English short names from a fixed array, not locale-dependent.

- [ ] **Step 1: Write failing tests:**
  - `parseDueMonths(" 10,4,4,13,x ")` → `[4, 10]`. `parseDueMonths(null)` → `[]`.
  - `formatDueMonths([10, 4])` → `"4,10"`. `formatDueMonths([])` → `null`.
  - `scheduleKind({ intervalDays: 90, intervalMiles: null })` → `"interval"`. With `dueMonths: "4"` → `"calendar"`. All null → `"once"`.
  - `nextCalendarDue([4, 10], 1, new Date("2026-03-25T08:00Z"))` → `2026-04-01T12:00:00.000Z`.
  - `nextCalendarDue([4, 10], 1, new Date("2026-04-01T00:00Z"))` → `2026-10-01T12:00:00.000Z` (same day counts as done).
  - `nextCalendarDue([4, 10], 1, new Date("2026-04-01T23:30Z"))` → `2026-10-01T12:00:00.000Z`.
  - `nextCalendarDue([4, 10], 1, new Date("2026-11-03T12:00Z"))` → `2027-04-01T12:00:00.000Z`.
  - `nextCalendarDue([10], 1, new Date("2026-10-20T12:00Z"))` → `2027-10-01T12:00:00.000Z`.
  - `firstCalendarDue([4], 15, new Date("2026-04-15T09:00Z"))` → `2026-04-15T12:00:00.000Z`.
  - `repeatsLabel` gives each of the six label forms listed above, with `meterShort` `"mi"`.
- [ ] **Step 2: Run** `npx vitest run lib/maintenance-schedule.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the functions above. `nextCalendarDue` walks forward month by month from `after`'s UTC month, for at most 13 steps.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** No commit.

### Task 3: Completion and skip follow the kind

**Files:**
- Modify: `lib/maintenance-complete.ts` (`CompletableSchedule`, `completeSchedule`, `skipSchedule`, `canSkip`)
- Test: `lib/maintenance-complete.test.ts`

**Interfaces:**
- Consumes: `scheduleKind`, `parseDueMonths` and `nextCalendarDue` from Task 2.
- Produces: `CompletableSchedule` gains `dueMonths?: string | null; dueDay?: number | null`. The signatures don't change. `scheduleCompletionWrites` already passes the full row, so service-record and Intake completions inherit the new behaviour.

- [ ] **Step 1: Write failing tests** in `lib/maintenance-complete.test.ts`:
  - Once, date-based: `{ intervalDays: null, intervalMiles: null, nextDueDate: 2026-05-01 }` completed 2026-05-10 → `nextDueDate: null`, `nextDueMileage: null`, `lastCompletedDate` 2026-05-10.
  - Once, mileage-only: `nextDueMileage: 60000`, completed at 60,250 → `nextDueMileage: null`.
  - Calendar: `dueMonths: "4,10"`, `dueDay: 1`, `nextDueDate` 2026-04-01T12:00Z.
    - Completed 2026-03-25 → `nextDueDate` 2026-10-01T12:00Z.
    - Completed 2026-05-10 → 2026-10-01T12:00Z.
  - Skip, calendar: same schedule, `now` 2026-04-03 → `nextDueDate` 2026-10-01T12:00Z.
  - `canSkip` is true for a calendar schedule with a `nextDueDate`, and false for once.
  - The existing interval tests still pass unchanged.
- [ ] **Step 2: Run** `npx vitest run lib/maintenance-complete.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
  - Branch on `scheduleKind(schedule)`.
    - Calendar: next = `nextCalendarDue(months, dueDay ?? 1, later of completedDate and schedule.nextDueDate)`. Mileage is kept as today.
    - Once: both due values become null.
    - Interval: unchanged.
  - Keep the "older completion never replaces a later one" rule for every kind.
  - Skip, calendar: next = `nextCalendarDue(months, day, later of nextDueDate and now)`.
  - Update the `///` comments to describe the three kinds.
- [ ] **Step 4: Run** `npx vitest run`. Expected: everything passes, including `lib/maintenance-match.test.ts` and `lib/maintenance-due.test.ts`.
- [ ] **Step 5: Checkpoint.** No commit.

### Task 4: Actions, templates and first due date

**Files:**
- Modify: `lib/maintenance-schedule.ts` (add `normalizeRepeats`)
- Modify: `lib/actions/maintenance.ts` (`schema` :17, `clean` :41, create/update, `templatePicksSchema` and `addTemplateSchedules` :213–255)
- Modify: `lib/maintenance-templates.ts` (`MaintenanceTemplate`, the `HOUSE` list and any other property-type lists that get the seasonal entries, `firstDue`)
- Test: `lib/maintenance-schedule.test.ts`, `lib/maintenance-templates.test.ts`

**Interfaces:**
- Consumes: Task 2 functions.
- Produces:
  - `normalizeRepeats(v: { intervalDays: number | null; intervalMiles: number | null; dueMonths: number[]; dueDay: number | null }): { ok: true; value: { intervalDays: number | null; intervalMiles: number | null; dueMonths: string | null; dueDay: number | null } } | { ok: false; error: string }`
  - `MaintenanceTemplate` gains `dueMonths?: number[]; dueDay?: number`.
  - `firstDue(interval: { intervalDays?: number | null; intervalMiles?: number | null; dueMonths?: number[] | null; dueDay?: number | null }, today, currentReading)`. Same return type.
  - The action schema accepts `estimatedCost` (`""` or a number ≥ 0), `dueMonths` (string, e.g. `"4,10"`) and `dueDay` (`""` or an integer 1–28).

- [ ] **Step 1: Write failing tests:**
  - `normalizeRepeats` with months `[4, 10]`, day null, no intervals → ok, `dueMonths: "4,10"`, `dueDay: 1`.
  - Months `[4]` with `intervalDays: 90` → `{ ok: false, error: "A reminder on set months can't also repeat every so many days or miles." }`.
  - Empty months with `dueDay: 15` → ok, `dueDay: null` (the day is dropped when no months are set).
  - Interval only → passes through unchanged, `dueMonths: null`.
  - `firstDue({ dueMonths: [4], dueDay: 1 }, new Date("2026-10-10T12:00Z"), null).nextDueDate` → `2027-04-01T12:00:00.000Z`.
  - In `maintenance-templates.test.ts`, change the "each has an interval" assertion so a template passes with an interval or a non-empty `dueMonths`. Add a test that the HOUSE list contains `service-ac` (`[4]`), `sprinklers-start` (`[4]`), `sprinklers-winterize` (`[10]`) and `furnace-service` (`[10]`), and that none of them have intervals.
- [ ] **Step 2: Run** `npx vitest run lib/maintenance-schedule.test.ts lib/maintenance-templates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `normalizeRepeats`. Add the four seasonal templates to `HOUSE`, titled "Service A/C", "Start up sprinklers", "Winterize sprinklers" and "Service furnace". Extend `firstDue` so calendar input uses `firstCalendarDue`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Wire the action.**
  - `clean()` runs `normalizeRepeats` and adds `estimatedCost`.
  - Create and update return `{ error: { dueMonths: [message] } }` when it fails.
  - On create, a calendar schedule with no typed `nextDueDate` gets `firstCalendarDue(months, day, new Date())`.
  - In `addTemplateSchedules`, a template with `dueMonths` ignores interval picks and passes the `:245` check. Its row gets `dueMonths: formatDueMonths(t.dueMonths)`, `dueDay: t.dueDay ?? 1`, and `firstDue` with the months.
- [ ] **Step 6: Checkpoint.** `npx vitest run`, `npx tsc --noEmit` and `npx eslint .` all pass. No commit.

### Task 5: Reminder form

**Files:**
- Modify: `components/maintenance/maintenance-form-dialog.tsx` (schema :24, fields :258–278, defaults, `onSubmit` :147)

**Interfaces:**
- Consumes: the action fields from Task 4, and `parseDueMonths` from Task 2.
- Produces: the form sends `estimatedCost`, `dueMonths` (comma string) and `dueDay`. Under "On set months" it sends `intervalDays: ""` and `intervalMiles: ""`. Under "Once" it sends blank intervals and blank `dueMonths`. Under "Every" it sends blank `dueMonths`.

- [ ] **Step 1: Read** the client-component and forms guides in `node_modules/next/dist/docs/`.
- [ ] **Step 2: Add a "Repeats" segmented control** above the interval fields with three options: "Every" (the existing days/miles inputs), "On set months" and "Once".
  - The initial value comes from `scheduleKind(schedule)`. A new reminder defaults to "Every".
  - "On set months" shows a row of 12 toggle buttons (Jan…Dec, `aria-pressed`) and a "Day" number input (1–28, placeholder 1).
  - "Once" hides all repeat inputs. Due date and due mileage stay visible.
- [ ] **Step 3: Add day presets** under the days input. These are small text buttons: Monthly 30, Quarterly 91, Twice a year 182, Yearly 365. Each one only sets `intervalDays`.
- [ ] **Step 4: Add an "Estimated cost" input**, labelled `Estimated cost (${fmt.currencySymbol})`, with `type="number" step="0.01" min="0"`.
- [ ] **Step 5: Verify** with `npm run dev` in a browser:
  - Create one reminder of each kind on a demo property, then reopen each and check the fields come back.
  - Switch one interval reminder to "On set months" and save. It saves without the "can't also repeat" error.
- [ ] **Step 6: Checkpoint.** Lint and tsc pass. No commit.

### Task 6: Display, complete dialog and template picker

**Files:**
- Modify: `components/maintenance/maintenance-list.tsx` (:228–232 interval cell, plus the cost)
- Modify: `app/(app)/maintenance/page.tsx` (add an "Est. cost" column)
- Modify: `components/maintenance/complete-dialog.tsx` (:94 cost placeholder, new prop)
- Modify: `components/maintenance/template-picker.tsx` (:100–125 row inputs)
- Modify: whichever components render `CompleteDialog`, to pass the new prop

**Interfaces:**
- Consumes: `repeatsLabel` and `scheduleKind` (Task 2), `estimatedCost` (Task 1).
- Produces: `CompleteDialog` gains an optional prop `estimatedCost?: number | null`.

- [ ] **Step 1: Interval cell.** In `maintenance-list.tsx`, replace the interval cell body with `repeatsLabel(s, fmt.meterShort(meterUnit))`. A completed one-time item (`kind === "once"`, no due values, `lastCompletedDate` set) shows "Done" in the Next Due cell, in place of "—".
- [ ] **Step 2: Estimate on rows.** In the same list, show `fmt.money(s.estimatedCost)` as a muted second line under the title when it is set.
- [ ] **Step 3: Maintenance page.** In `app/(app)/maintenance/page.tsx`, add an "Est. cost" column after Next Due. It shows `fmt.money` or "—".
- [ ] **Step 4: Complete dialog.** In `complete-dialog.tsx`, the cost placeholder is `Est. ${fmt.money(estimatedCost)}` when set, else `"89.99"`. The field is never prefilled. Pass `estimatedCost` from every place that renders `CompleteDialog`.
- [ ] **Step 5: Template picker.** In `template-picker.tsx`, templates with `dueMonths` show `repeatsLabel` as read-only text in place of the days input, and send only `key`.
- [ ] **Step 6: Verify in the browser:**
  - The asset Maintenance tab shows "Apr, Oct", "Once" and "Every 90 days".
  - Complete the one-time item. It shows "Done" and leaves the Maintenance page's overdue and due-soon counts.
  - On a new house, "Add default reminders" lists the four seasonal templates with month labels, and adding them works.
- [ ] **Step 7: Checkpoint.** No commit.

### Task 7: Assistant, backup export and demo data

**Files:**
- Modify: `lib/llm/ontology.ts` (:193–205)
- Modify: `lib/llm/tools/shortcuts.ts` (:388–395)
- Modify: `lib/backup/readable.ts` (:185–188)
- Modify: `prisma/seed-demo.ts` (near :627 and :738)
- Test: `lib/llm/ontology.test.ts`, `lib/backup/readable.test.ts` (update expected fields)

**Interfaces:**
- Consumes: `repeatsLabel` (Task 2).

- [ ] **Step 1: Write failing tests.**
  - In `readable.test.ts`, the reminder export rows include `repeats` (e.g. `"Apr, Oct"`) and `estimatedCost`.
  - In `ontology.test.ts`, `maintenanceSchedule` fields include `estimatedCost`, `dueMonths` and `dueDay`.
- [ ] **Step 2: Run** `npx vitest run lib/backup/readable.test.ts lib/llm/ontology.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Ontology: add `estimatedCost` (float, "Expected cost of one occurrence"), `dueMonths` (string, "Calendar schedule months 1–12, comma-separated") and `dueDay` (int). Change the entity description to "Recurring, seasonal or one-time maintenance…".
  - `maintenance_status`: add `repeats: repeatsLabel(s, unitShort)` and `estimatedCost`. Keep the existing fields.
  - `readable.ts`: add `repeats` and `estimatedCost` beside `everyDays`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Demo seed.** Give 3 existing demo reminders an `estimatedCost`. Add one calendar reminder to the demo house ("Winterize sprinklers", `dueMonths: "10"`, `dueDay: 15`, `estimatedCost: 85`) and one one-time item ("Replace roof", due in 3 years, `estimatedCost: 14000`). Run `npm run db:seed:demo` against a scratch DB, or confirm it type-checks if you can't reset the dev DB.
- [ ] **Step 6: Final checkpoint.** Run `npx vitest run`, `npx eslint .` and `npx tsc --noEmit`, and quote the summary lines. Run `git status` and check the dashboard files are untouched (`git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing). Don't commit.
