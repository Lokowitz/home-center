# Step 3: Planned spend forecast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Costs page and asset pages show planned spend for the next 12 months, built from reminders that carry an estimated cost.

**Architecture:** A new pure module `lib/forecast.ts` holds every rule: expanding schedules into dated occurrences, the mileage-only count, month buckets, the largest-items ranking and the mileage note wording. A thin loader `loadPlannedSchedules()` beside `loadCostRecords()` in `lib/costs-server.ts` fetches schedules with an estimated cost, applying Health and the asset filter in the `where`. The Costs page renders a "Planned, next 12 months" panel with `RankedBars`. `AssetCostPanel` adds one row, and the property page passes its equipment ids so a property's figure includes its equipment. No schema change, no migration, no backup or Dockerfile change.

**Tech Stack:** Next.js 16 (app router, server components), Prisma 7 + SQLite/libSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-cost-planning-and-insurance-design.md`, section "Step 3: Planned spend forecast" (plus Goals, Non-goals, Anti-goals, Constraints).

## Global Constraints

- Don't touch `app/(app)/page.tsx` or `components/dashboard/*`. The Costs page and `components/costs/asset-cost-panel.tsx` are fine to change.
- **No commits, no push, no `git add`/`stash`/`checkout`.** Each task ends with a checkpoint. Leave everything uncommitted.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `06-fetching-data.md` before editing page or component code.
- No schema change. `prisma/schema.prisma` already has everything (`estimatedCost`, `dueMonths`, `dueDay`, `isActive`, `snoozedUntil`). No migration, so no `prisma generate`.
- New logic goes in pure functions with Vitest tests beside them. Vitest only picks up `lib/**/*.test.ts`. There are no component or DB-backed tests, so the loader and pages stay thin: no date math, totals, grouping or filtering by rule in them.
- Reuse, don't re-derive: `scheduleKind`, `parseDueMonths`, `nextCalendarDue`, `firstCalendarDue` (`lib/maintenance-schedule.ts`), `localDay` (`lib/equipment-life.ts`), `cents` (`lib/costs.ts`), `ownedWhere` (`lib/features.ts`), `assetHref`/`assetIcon` (`lib/assets.ts`), `RankedBars` (`components/charts/ranked-bars.tsx`), and `fmt.money` from `getFormat()`.
- Dates: occurrences are 12:00 UTC calendar days (`Date.UTC(y, m, d, 12)`), compared and bucketed by UTC day and UTC month. "Today" is `localDay(new Date())`, computed in the server component that renders the figure (the Costs page and `AssetCostPanel`). That's the server's clock and time zone, the same choice step 2 made on the equipment page. `forecastSchedules` takes `from` as a parameter and never calls `new Date()`.
- The window is 12 calendar months: the current month (from `from`'s day onward) through the 11 months after it. It ends, exclusive, on the 1st of the 13th month.
- Rules, verbatim from the spec: interval schedules (day-based) are `nextDueDate`, then every `intervalDays`. Calendar schedules are every listed month. One-time items count once, if due inside the window. Mileage-only schedules are left out and counted. Overdue items count once, in the current month. Snoozed items still count. Paused items (`isActive` false) don't count.
- Non-goal: no projecting mileage-only reminders. Non-goal: premiums don't count (step 5, not here).
- Person schedules count only with Health on, enforced in the loader's query, not just the UI.
- Changing `AssetCostPanel` changes the people, property, vehicle and equipment pages together (repo CLAUDE.md). Task 4 checks all four.
- The repo has exactly 8 pre-existing eslint warnings. No new ones. (No react-hook-form in this step; if one appears, use `useWatch`, never `form.watch`.)
- Don't run `prisma/seed-demo.ts` (`npm run db:seed:demo`). It wipes the dev DB. Type-check it only.
- Don't touch `lib/backup/*`.
- Shell heredocs with quotes or apostrophes break in this environment. Use the Edit tool, or write a multi-line script to a file in the scratchpad and run that.
- No browser tool is available. UI tasks end with a manual-verification list for the user. The executor reports that it did **not** verify in a browser.
- A task is done when `npx vitest run`, `npx eslint .` (8 warnings, no more) and `npx tsc --noEmit` all pass.

## Review Focus

1. **Overdue repeating reminders.** An oil change due Aug 1 every 180 days, seen on Oct 24: it counts once on Oct 24, then again 180 days after Oct 24 (Apr 22), not 180 days after Aug 1. That matches what completing it today would do (`completeSchedule`). An overdue calendar reminder counts once now, then at the next listed month after today. Task 1 tests both.
2. **Window edges and time of day.** A one-time item due Sep 30 next year is in; Oct 1 is out. A due date stored at 03:00 UTC on today's date is today, not overdue, and lands at noon. A due date stored as 23:00 UTC on Oct 31 belongs to October. Tasks 1 and 2 test these.
3. **What doesn't count.** Paused, no estimated cost, an estimated cost of 0, a completed one-time item (no due date, no due mileage), and a one-time item due after the window add nothing and aren't counted as mileage. A snoozed reminder still counts. A miles-only reminder without a cost isn't counted in the mileage note. Task 1 tests each.
4. **Health off.** With Health off, person reminders never reach the Costs page total, and `?type=PERSON` (typed by hand) shows no planned panel. The loader enforces it (Task 3); it's in that task's manual list because no DB test exists.
5. **Planned spend without spending history.** A new house with only "Replace roof" planned, or an install with no recorded costs at all, still shows the planned figure: the asset panel appears with just that row, and the Costs page shows the planned panel under its empty state. Tasks 3 and 4 implement this; both have it in their manual lists.

---

### Task 1: `forecastSchedules`

**Files:**
- Create: `lib/forecast.ts`
- Test: `lib/forecast.test.ts`

**Interfaces:**
- Consumes: `scheduleKind`, `parseDueMonths`, `nextCalendarDue`, `firstCalendarDue` from `lib/maintenance-schedule.ts`; `cents` from `lib/costs.ts`; `import type { AssetType } from "@/app/generated/prisma/client"`.
- Produces:

```ts
export type ForecastSchedule = {
  id: string
  title: string
  assetType: AssetType
  assetId: string
  isActive: boolean
  estimatedCost: number | null
  intervalDays: number | null
  intervalMiles: number | null
  dueMonths: string | null
  dueDay: number | null
  nextDueDate: Date | null
  nextDueMileage: number | null
  /// Ignored on purpose: a snooze hides a reminder without moving its due date.
  snoozedUntil?: Date | null
}
export type Occurrence = { scheduleId: string; title: string; assetType: AssetType; assetId: string; date: Date; cost: number }
export type Forecast = { occurrences: Occurrence[]; total: number; mileageOnly: number }
export function forecastSchedules(schedules: ForecastSchedule[], from: Date, months = 12): Forecast
```

`occurrences` are sorted by date (then title). `total` is `cents` of their sum. `mileageOnly` is how many schedules were left out because they're mileage-only.

- [ ] **Step 1: Write failing tests.** Use `const noon = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12))`, `const from = noon(2026, 10, 24)` and a `sched(overrides: Partial<ForecastSchedule>): ForecastSchedule` helper defaulting to an active schedule with `estimatedCost: 100` and every repeat/due field null. Assert dates with `toISOString().slice(0, 10)`.
  - `it("repeats an interval reminder every intervalDays from its due date")`: `nextDueDate noon(2026,11,1)`, `intervalDays 90`, cost 38 → dates `2026-11-01`, `2027-01-30`, `2027-04-30`, `2027-07-29` (Oct 27 2027 is outside); `total` 152.
  - `it("counts an overdue interval reminder once today, then repeats from today")`: `nextDueDate noon(2026,8,1)`, `intervalDays 180` → `2026-10-24`, `2027-04-22`.
  - `it("uses days when a reminder has both days and miles")`: `intervalDays 180`, `intervalMiles 7500`, `nextDueDate noon(2026,12,1)`, `nextDueMileage 50000` → 2 occurrences (`2026-12-01`, `2027-05-30`); `mileageOnly` 0.
  - `it("puts a calendar reminder in every listed month")`: `dueMonths "1,4,7,10"`, `dueDay 1`, `nextDueDate noon(2027,1,1)` → `2027-01-01`, `2027-04-01`, `2027-07-01`.
  - `it("counts an overdue calendar reminder once today, then at the next listed month")`: `dueMonths "10"`, `dueDay 15`, `nextDueDate noon(2026,10,15)` → only `2026-10-24` (Oct 15 2027 is outside).
  - `it("starts a calendar reminder with no due date at the first listed month from today")`: `dueMonths "11"`, `dueDay 1`, `nextDueDate null` → `2026-11-01`.
  - `it("counts a one-time item once inside the window")`: `nextDueDate noon(2027,3,10)`, cost 14000 → one occurrence, total 14000. Same item due `noon(2029,1,1)` → none. Due `noon(2026,9,1)` → one, on `2026-10-24`.
  - `it("ends the window on the first of the thirteenth month")`: one-time due `noon(2027,9,30)` → 1; due `noon(2027,10,1)` → 0. With `months = 1`, due `noon(2026,10,31)` → 1 and `noon(2026,11,1)` → 0.
  - `it("treats a due date earlier today as today, not overdue")`: one-time `nextDueDate new Date(Date.UTC(2026,9,24,3))` → one occurrence whose date equals `from`.
  - `it("leaves mileage-only reminders out and counts them")`: `intervalMiles 105000`, `nextDueMileage 120000`, cost 900 → no occurrences, `mileageOnly` 1. A one-time item with only `nextDueMileage 60000` → `mileageOnly` 1. Either without a cost → `mileageOnly` 0. Either paused → `mileageOnly` 0.
  - `it("skips paused reminders but counts snoozed ones")`: `isActive false` → nothing. `snoozedUntil noon(2026,12,1)` with a one-time due `noon(2026,11,15)` → one occurrence.
  - `it("skips reminders with no cost, a zero cost, or nothing left due")`: `estimatedCost null` → none; `0` → none; a one-time item with `nextDueDate null`, `nextDueMileage null` → none, `mileageOnly` 0.
  - `it("sorts occurrences across schedules by date and rounds the total to cents")`: two schedules with costs 0.1 and 0.2 due Dec 1 and Nov 1 → the Nov one first; `total` 0.3.
- [ ] **Step 2: Run** `npx vitest run lib/forecast.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `forecastSchedules` in `lib/forecast.ts`.** Per schedule, in this order:

```text
skip unless isActive and estimatedCost > 0
kind = scheduleKind(s)
mileage-only → mileageOnly++ and skip, where mileage-only is
    (kind "interval" and no intervalDays) or (kind "once" and no nextDueDate and nextDueMileage != null)
first = kind "calendar" ? (nextDueDate ?? firstCalendarDue(months, dueDay ?? 1, from)) : nextDueDate
skip when first is null
if UTC day of first < UTC day of from: emit at from; anchor = from      (overdue: once, in the current month)
else: emit at noon of first's UTC day if before the window end; anchor = that date
repeat while before the window end:
    interval → anchor + intervalDays UTC days (Date.UTC(y, m, d + intervalDays, 12))
    calendar → nextCalendarDue(months, dueDay ?? 1, anchor)
    once     → stop
```

  The window end is `Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, 12)`, exclusive by UTC day.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass. `git status` shows only the two new files from this task. Don't commit.

### Task 2: Month buckets, largest items and the mileage note

**Files:**
- Modify: `lib/forecast.ts`
- Test: `lib/forecast.test.ts`

**Interfaces:**
- Consumes: `Occurrence` (Task 1), `cents`.
- Produces:

```ts
export type ForecastMonth = { key: string; start: Date; total: number; count: number; share: number }
/// Exactly `months` entries from from's UTC month, zero-filled. key is "YYYY-MM"; start is the 1st at 12:00 UTC.
export function forecastByMonth(occurrences: Occurrence[], from: Date, months = 12): ForecastMonth[]

export type PlannedItem = { scheduleId: string; title: string; assetType: AssetType; assetId: string; total: number; count: number; next: Date; share: number }
/// One entry per schedule, largest total first (ties: earlier `next`, then scheduleId). `share` is total over the largest total.
export function largestPlanned(occurrences: Occurrence[], limit: number): PlannedItem[]

/// null for 0; otherwise "1 mileage-based reminder isn't included." / "2 mileage-based reminders aren't included."
export function mileageNote(count: number): string | null
```

`ForecastMonth` and `PlannedItem` carry `total`, `count` and `share` so the page can turn them into `RankedBars` rows by adding `key`/`label`/`href`.

- [ ] **Step 1: Write failing tests** (reuse `noon`, `from`, `sched`; build occurrences with `forecastSchedules`):
  - `it("buckets occurrences into twelve UTC months, zero-filled")`: occurrences on Nov 1 2026 (38), Jan 30 2027 (38) and Mar 10 2027 (14000) → 12 entries; keys run `"2026-10"` … `"2027-09"`; `start` of the first is `noon(2026,10,1)`; Nov total 38, count 1; Oct and Dec total 0; Mar `share` 1, Nov `share` 38/14000.
  - `it("buckets by UTC day")`: a one-time item due `new Date(Date.UTC(2026,9,31,23))` lands in `"2026-10"`.
  - `it("rounds month totals to cents")`: 0.1 and 0.2 in the same month → 0.3.
  - `it("ranks planned items per reminder")`: a 90-day filter at 38 (4 occurrences, 152) and a one-time 14000 roof → roof first (`count` 1, `share` 1), filter second (`total` 152, `count` 4, `next` `2026-11-01`). `limit 1` → just the roof.
  - `it("words the mileage note")`: `mileageNote(0)` → `null`; `1` → `"1 mileage-based reminder isn't included."`; `2` → `"2 mileage-based reminders aren't included."`.
- [ ] **Step 2: Run** `npx vitest run lib/forecast.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the three functions in `lib/forecast.ts`. Bucket by `getUTCFullYear()`/`getUTCMonth()`; round each total with `cents`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass. Don't commit.

### Task 3: Loader and the Costs page panel

**Files:**
- Modify: `lib/costs-server.ts` (add `loadPlannedSchedules` after `loadCostRecords`)
- Modify: `app/(app)/costs/page.tsx`

**Interfaces:**
- Consumes: `forecastSchedules`, `forecastByMonth`, `largestPlanned`, `mileageNote`, `type ForecastSchedule` (Tasks 1–2); `localDay`; `RankedBars`/`RankedRow`.
- Produces:

```ts
/// Every schedule with an estimated cost (paused ones too: forecastSchedules drops them).
/// With Health off, no person's. `assets` narrows to those exact assets (asset panel).
export async function loadPlannedSchedules(filter?: {
  assetType?: AssetType
  assets?: { assetType: AssetType; assetId: string }[]
}): Promise<ForecastSchedule[]>
```

- [ ] **Step 1: Loader.** Mirror `loadCostRecords`:
  - `const features = await loadFeatures()`. Return `[]` when `!features.health && filter?.assetType === "PERSON"`.
  - `where`: `estimatedCost: { not: null }`, then `...(filter?.assetType ? { assetType: filter.assetType } : ownedWhere(features))`, then `...(filter?.assets ? { OR: filter.assets.map(({ assetType, assetId }) => ({ assetType, assetId })) } : {})`.
  - `select` exactly the `ForecastSchedule` fields except `snoozedUntil`. Don't filter on `isActive` or snooze here, and don't use `awakeFilter`.
- [ ] **Step 2: Page data.** In `CostsPage`:
  - Move the `typeParam`/`assetType` parsing (currently after the first empty-state return) up, right after `typeFilters`, so every return path can use it.
  - Add `loadPlannedSchedules(assetType ? { assetType } : undefined)` to the existing `Promise.all`. It respects `type` and ignores `year`, `bucket` and `category`.
  - `const today = localDay(new Date())`, then `const forecast = forecastSchedules(planned, today)`.
- [ ] **Step 3: Panel.** Add a local `PlannedPanel({ forecast, today, assets, fmt })` in the page file. It returns `null` (no card at all) when `forecast.total === 0 && forecast.mileageOnly === 0`. Otherwise it returns `<Panel title="Planned, next 12 months">` containing:
  - The total as the headline, `fmt.money(forecast.total)`, styled like `AssetCostPanel`'s headline (`text-xl font-semibold leading-none`).
  - The `mileageNote(forecast.mileageOnly)` line in `text-xs text-muted-foreground`, when non-null.
  - A month chart: `RankedBars` with `size="compact"`, `valueLabel="Planned"`, `caption="Planned spend by month"`, entries from `forecastByMonth(forecast.occurrences, today)` mapped to `{ ...m, label: m.start.toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) }`. Months stay in calendar order (don't pass them through `ranked`). Use `RankedBars`, not `TrendChart`: `TrendChart` stacks by service category and reminders have none, so it would show a lone "Uncategorized" legend and a "No spending" tooltip.
  - Largest items: a second `RankedBars` (`size="compact"`, `valueLabel="Planned"`, `caption="Largest planned items"`) from `largestPlanned(forecast.occurrences, TOP_PLANNED)` with `TOP_PLANNED = 8`. Each row: `key` = `scheduleId`, `label` = `` `${title} · ${assets.assetName(assetType, assetId) ?? "Unknown"}` ``, `href` = `` `${assetHref(assetType, assetId)}?tab=${assetType === "PERSON" ? "reminders" : "maintenance"}` ``.
  - Lay the two charts out in `grid grid-cols-1 gap-4 lg:grid-cols-2` under the headline.
- [ ] **Step 4: Place it.** Render the panel last, after the "Biggest single expenses" grid. Also render it under the two empty states ("No costs recorded yet" and "No costs match those filters"), so planned spend shows before any cost is recorded.
- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass. Don't commit.
- [ ] **Step 6: Manual verification list for the user:**
  - On `/costs`, below "Biggest single expenses", a "Planned, next 12 months" panel shows a total, twelve month bars starting with this month, and up to eight largest items. Clicking an item opens that asset's Maintenance tab (Reminders for a person).
  - Pick Vehicles under Assets: the panel shows only vehicle reminders. Pick a Year, Quarterly or a category: the planned panel doesn't change.
  - A reminder that's snoozed still appears. Pause it and it disappears.
  - Give a miles-only reminder (e.g. timing belt) an estimated cost: the note "1 mileage-based reminder isn't included." appears.
  - Turn Health off: person reminders drop out of the total, and `/costs?type=PERSON` shows no person reminders.
  - With no recorded costs at all but a reminder with an estimate, the page shows the empty state and the planned panel under it.
  - With no estimated reminders at all, there's no planned panel.

### Task 4: Planned figure on the asset cost panel

**Files:**
- Modify: `components/costs/asset-cost-panel.tsx`
- Modify: `app/(app)/assets/properties/[id]/page.tsx` (the `<AssetCostPanel>` at ~:90)
- Check, no change expected: `app/(app)/assets/people/[id]/page.tsx` (:119), `app/(app)/assets/vehicles/[id]/page.tsx` (:53), `app/(app)/assets/equipment/[id]/page.tsx` (:87)

**Interfaces:**
- Consumes: `loadPlannedSchedules` (Task 3), `forecastSchedules` (Task 1), `localDay`.
- Produces: `AssetCostPanel` gains an optional prop `equipmentIds?: string[]`: equipment whose reminders count toward this asset's planned figure. Only the property page passes it.

- [ ] **Step 1: Load.** Fetch `loadCostRecords({ assetId, assetType })` and `loadPlannedSchedules({ assets: [{ assetType, assetId }, ...(equipmentIds ?? []).map((id) => ({ assetType: "EQUIPMENT" as const, assetId: id }))] })` together with `Promise.all`. `const planned = forecastSchedules(schedules, localDay(new Date())).total`.
- [ ] **Step 2: Render.**
  - Change the early return to `if (rows.length === 0 && planned === 0) return null`.
  - When `rows.length > 0`, the panel is exactly as today, plus a `<Row label="Planned, next 12 months" value={fmt.money(planned)} />` as the last row of the `dl` when `planned > 0`.
  - When `rows.length === 0`, render the same container with the "Cost" label and only that row: no headline, chart, other rows or status meters (they all describe past spending or need it). Skip the `schedules`/`warranties` queries and range math in that case.
- [ ] **Step 3: Property page.** Pass `equipmentIds={equipmentIds}` (already computed at ~:50) to `AssetCostPanel`. The history figures keep counting only the property's own records, as today.
- [ ] **Step 4: Check the other three pages.** People, vehicles and equipment pass no `equipmentIds`, and their own reminders feed the figure. A person page with Health off is already blocked, and the loader drops person schedules too. Leave those files unchanged and say so.
- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass. Don't commit.
- [ ] **Step 6: Manual verification list for the user:**
  - A vehicle with recorded costs and an oil change estimate shows "Planned, next 12 months: $X" at the bottom of the Cost rows.
  - A property shows a figure that includes its equipment's reminders (furnace filter, humidifier panel) as well as its own (winterize sprinklers).
  - An equipment page shows only that item's reminders.
  - An asset with no recorded costs but an estimated reminder shows a small Cost panel with only the planned row. With neither, there's no panel.
  - A person with an estimated reminder shows the row (Health on).
  - Pause the reminder: the row disappears (and the panel too, if there's no history).

### Task 5: Demo data, testing checklist and final check

**Files:**
- Modify: `prisma/seed-demo.ts` (the "Timing belt — 105k interval" entry, ~:574)
- Modify: `TESTING-CHECKLIST.md` (untracked, temporary; read it first)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new in code.

- [ ] **Step 1: Demo seed.** Add `estimatedCost: 900` to the Timing belt entry, so the demo shows the mileage note. The existing estimates (filter 38, humidifier panel 24, sprinklers 85, oil change 89) already feed the forecast. "Replace roof" is due in 1095 days, outside the window, and stays that way. Don't run the seed.
- [ ] **Step 2: Testing checklist.** Edit the intro sentence to say it also covers step 3. Add a section `## 12. Planned spend (step 3)` before `## Known gaps`, in the same style (short user-facing checkboxes, bold sub-headings only if useful). Cover: the Costs page panel (total, month bars starting this month, largest items linking to the asset's Maintenance tab); the Assets filter changes it but Year, By and category don't; snoozed counts, paused doesn't; an overdue reminder counts in this month; a one-time item due in the next 12 months counts, one due later doesn't; the mileage note; Health off hides person reminders; the asset panel row on a vehicle, a property (includes its equipment) and an equipment item; an asset with only planned spend; the "Plan replacement" flow from step 2 feeding the figure when its due date is within 12 months. With the demo seed: Maple Street House's figure includes its furnace filter and humidifier panel, and the timing belt note reads "1 mileage-based reminder isn't included." Under "Known gaps", add that step 3 wasn't verified in a browser either.
- [ ] **Step 3: Final checkpoint.** Run `npx vitest run`, `npx eslint .` and `npx tsc --noEmit`, and quote the summary lines (eslint: 0 errors, 8 warnings). Confirm `git diff --stat -- "app/(app)/page.tsx" components/dashboard prisma/schema.prisma lib/backup` prints nothing. Run `git status` and list the files this step changed. Don't commit. Say that Tasks 3 and 4's manual-verification lists are still open for the user and that nothing was checked in a browser.
