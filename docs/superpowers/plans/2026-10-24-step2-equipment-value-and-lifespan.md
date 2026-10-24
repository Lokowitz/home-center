# Step 2: Equipment value and lifespan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Equipment knows whether it is part of the home, how long it should last and what replacing it costs.

**Architecture:** Three new nullable columns on `Equipment` and one new enum. Two new pure modules hold every rule. `lib/equipment-value.ts` covers value class defaults, labels and the per-class totals that step 5 reuses. `lib/equipment-life.ts` covers age against expected life and the "Plan replacement" prefill. The form, the equipment page, the property Equipment tab, the assistant, the backup export and the demo seed all call into these. The maintenance form dialog gains an optional `defaults` prop so the equipment page can open it prefilled. Nothing gets saved until the user saves.

**Tech Stack:** Next.js 16 (app router, server actions), Prisma 7 + SQLite/libSQL, zod, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-cost-planning-and-insurance-design.md`, section "Step 2" (plus Goals, Non-goals, Anti-goals, Constraints). Step 5's "Asset detail pages" section fixes what the totals function must return.

## Global Constraints

- Don't touch `app/(app)/page.tsx` or `components/dashboard/*`.
- **No commits, no push, no `git add`/`stash`/`checkout`.** Each task ends with a checkpoint. Leave everything uncommitted.
- Read the relevant guide in `node_modules/next/dist/docs/` (`01-app/...`) before writing page or client component code.
- Read `prisma/schema.prisma` before data changes. Migrations go through `npx prisma migrate dev` and live in `prisma/migrations/YYYYMMDDHHMMSS_snake_name/`. After migrating, **also run `npx prisma generate`**. The client isn't regenerated automatically, and `tsc` fails without it.
- New logic goes in pure functions with Vitest tests beside them. Vitest only picks up `lib/**/*.test.ts`. There are no component or DB-backed UI tests.
- Show money with `fmt.money` / `fmt.moneyWhole` / `fmt.currencySymbol` from `useFormat()` (client) or `getFormat()` (server).
- Every new field is optional. An empty field renders nothing (Anti-goal: "forms that look busier when the new fields are empty" applies to display, not to the presence of inputs).
- No depreciation math (Non-goal).
- Value class defaults, verbatim from the spec: HVAC, WATER and SECURITY count as FIXTURE. APPLIANCE, ELECTRONICS, TOOL, OUTDOOR and OTHER count as CONTENTS. A null `valueClass` means "use the category default". It is never written as the default's value.
- Labels: FIXTURE is "Part of the home", CONTENTS is "Belongings".
- Dates built by the new code use 12:00 UTC (`Date.UTC(y, m, d, 12)`), matching step 1. Compare by UTC calendar day, not timestamp.
- `lib/equipment-value.ts` is imported by `lib/backup/readable.ts`, an engine file. It must have **no runtime imports at all** (define its own string-literal types, like `lib/maintenance-schedule.ts`). It must be added to `helpers` in `lib/backup/import-rules.test.ts` and get a `COPY --from=builder /app/lib/equipment-value.ts ./lib/equipment-value.ts` line in the `Dockerfile` next to the `lib/maintenance-schedule.ts` one. Without that, `npm run backup` breaks in Docker. `import-rules.test.ts` enforces it.
- In react-hook-form components use `useWatch`, never `form.watch`. `form.watch` adds a `react-hooks/incompatible-library` warning.
- The repo has exactly 8 pre-existing eslint warnings. No new ones.
- Don't run `prisma/seed-demo.ts` (`npm run db:seed:demo`). It wipes the dev DB. Type-check it only.
- Shell heredocs with quotes or apostrophes break in this environment. Use the Edit tool, or write a multi-line script to a file in the scratchpad and run that.
- No browser tool is available. UI tasks end with a manual-verification list for the user. The executor reports that it did **not** verify in a browser.
- A task is done when `npx vitest run`, `npx eslint .` (8 warnings, no more) and `npx tsc --noEmit` all pass.
- Three asset detail pages (repo CLAUDE.md): people and vehicle detail pages have no equipment, so neither changes. The property page file itself doesn't change either: its Equipment tab already passes full `Equipment` rows to `components/equipment/property-equipment.tsx`, so the new columns arrive without a query change. Task 6 confirms this.

## Review Focus

1. **The category default follows the category.** An item saved with "Counts as: Default" stores `valueClass: null`. When its category later changes from APPLIANCE to HVAC, it moves from Belongings to Part of the home in the totals. Task 2 tests `effectiveValueClass` with a null class on both categories.
2. **Switching an override back to Default clears it.** Editing a FIXTURE oven back to "Default" saves `valueClass: null`, not FIXTURE. Task 1 tests `equipmentData` with `valueClass: ""`.
3. **Leap day and anniversary.** Installed 2016-02-29 with a 10-year life: the replacement date is 2026-02-28. On 2026-02-28 the age is "10 of 10 years" and counts as past. A replacement date before today becomes a year from today. A replacement date of today stays today. Task 3 tests all of these.
4. **Partial prices.** An item with a replacement cost but no purchase price counts in "no price" and in "to replace". It adds nothing to "paid". Step 5's fallback total uses `replacementCost`, then `purchasePrice`, then 0. An honest price of 0 counts as priced. Task 2 tests these.
5. **Plan replacement with missing data.** No expected life, or no install or purchase date: the due date is a year from today. No replacement cost: the estimated cost is blank, not 0. A start date in the future (a typo) gives age 0, never negative. Task 3 tests these.

---

### Task 1: Schema, migration and input parsing

**Files:**
- Modify: `prisma/schema.prisma` (new enum near `enum EquipmentCategory` ~:69, `model Equipment` ~:284)
- Create: `prisma/migrations/<timestamp>_equipment_value_and_lifespan/migration.sql` (generated)
- Modify: `lib/asset-input.ts` (`equipmentSchema` :12, `equipmentData` :30)
- Test: `lib/asset-input.test.ts` (`describe("equipment input")`)

**Interfaces:**
- Produces: `enum EquipmentValueClass { FIXTURE CONTENTS }` and the `Equipment` columns `valueClass EquipmentValueClass?`, `expectedLifeYears Int?` and `replacementCost Float?`.
- Produces: `equipmentSchema` accepts `valueClass` (`""`, `"FIXTURE"` or `"CONTENTS"`, optional), `expectedLifeYears` (blank, or an integer 1–100) and `replacementCost` (blank, or a number ≥ 0). `equipmentData` returns `valueClass: "FIXTURE" | "CONTENTS" | null`, `expectedLifeYears: number | null` and `replacementCost: number | null`.

- [ ] **Step 1: Write failing tests** in `describe("equipment input")`, using the existing `parse` helper and `blanks` list:
  - `parse({ valueClass: "FIXTURE" }).valueClass` → `"FIXTURE"`. `parse({ valueClass: "" }).valueClass` → `null`. `parse({}).valueClass` → `null`.
  - `equipmentSchema.safeParse({ ...base, valueClass: "HOUSE" }).success` → `false`.
  - Each of `blanks` for `replacementCost` and for `expectedLifeYears` → `null`.
  - `parse({ replacementCost: "1800.50" }).replacementCost` → `1800.5`. `"0"` → `0`.
  - `parse({ expectedLifeYears: "15" }).expectedLifeYears` → `15`.
  - `safeParse` fails for `expectedLifeYears` `"0"`, `"12.5"`, `"101"` and `"abc"`, and for `replacementCost` `"-1"`.
- [ ] **Step 2: Run** `npx vitest run lib/asset-input.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
  - `valueClass: z.enum(["", "FIXTURE", "CONTENTS"]).optional()`, saved as `v.valueClass || null`.
  - `expectedLifeYears: optionalNumber(z.coerce.number().int().min(1).max(100))`.
  - `replacementCost: optionalNumber(z.coerce.number().min(0))`.
  - Both numbers are saved as `?? null`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add the schema.** Add the enum after `EquipmentCategory`, with `///` comments: FIXTURE "Part of the home: insured with the dwelling", CONTENTS "Belongings: insured as personal property". Add the three fields after `installDate`:
  - `valueClass EquipmentValueClass?`: "Part of the home or belongings. Null means the category's default (lib/equipment-value.ts)."
  - `expectedLifeYears Int?`: "How many years it should last, counted from installDate, else purchaseDate."
  - `replacementCost Float?`: "What replacing it would cost today."
- [ ] **Step 6: Migrate.** Run `npx prisma migrate dev --create-only --name equipment_value_and_lifespan`. Check that the SQL only adds three columns (no table rebuild that drops data). Then run `npx prisma migrate dev`, then `npx prisma generate`.
- [ ] **Step 7: Checkpoint.** `npx tsc --noEmit` and `npx vitest run` pass. `git status` shows only this task's files. Don't commit.

### Task 2: Value class defaults and per-class totals

**Files:**
- Create: `lib/equipment-value.ts`
- Test: `lib/equipment-value.test.ts`

**Interfaces:**
- Produces (no runtime imports in this file):
  - `type ValueClass = "FIXTURE" | "CONTENTS"`
  - `type EquipmentCategoryName = "APPLIANCE" | "HVAC" | "WATER" | "ELECTRONICS" | "TOOL" | "OUTDOOR" | "SECURITY" | "OTHER"`. Prisma's `EquipmentCategory` is assignable to it.
  - `VALUE_CLASSES: { value: ValueClass; label: string }[]`, in the order FIXTURE then CONTENTS.
  - `valueClassLabel(c: ValueClass): string`. Returns "Part of the home" or "Belongings".
  - `defaultValueClass(category: string): ValueClass`. Takes `string` so the backup's raw rows can call it. Unknown values give CONTENTS.
  - `effectiveValueClass(e: { category: string; valueClass: ValueClass | null }): ValueClass`
  - `type ValueItem = { category: string; valueClass: ValueClass | null; purchasePrice: number | null; replacementCost: number | null }`
  - `type ClassTotals = { count: number; priced: number; paid: number; withReplacementCost: number; toReplace: number; toReplaceOrPaid: number }`
    - `priced` counts items with a `purchasePrice`, 0 included.
    - `paid` is the sum of `purchasePrice`.
    - `toReplace` is the sum of `replacementCost` (step 2 display).
    - `toReplaceOrPaid` is the sum of `replacementCost ?? purchasePrice ?? 0`. **Step 5's "Belongings to replace" reads `CONTENTS.toReplaceOrPaid`.** The fallback lives here, in one place, so step 5 doesn't recompute it.
  - `equipmentValueTotals(items: ValueItem[]): Record<ValueClass, ClassTotals>`. Both keys are always present, zeroed when empty.

- [ ] **Step 1: Write failing tests:**
  - `defaultValueClass` gives FIXTURE for HVAC, WATER and SECURITY, CONTENTS for the other five, and CONTENTS for `"NOPE"`.
  - `effectiveValueClass({ category: "APPLIANCE", valueClass: null })` → CONTENTS. With `"HVAC"` → FIXTURE. With `{ category: "APPLIANCE", valueClass: "FIXTURE" }` → FIXTURE (the oven override).
  - `valueClassLabel("FIXTURE")` → `"Part of the home"`, `"CONTENTS"` → `"Belongings"`.
  - `equipmentValueTotals([])` → both classes all zeros.
  - With items: furnace `{ HVAC, null, 4200, 5200 }`, fridge `{ APPLIANCE, null, 2499, null }`, TV `{ ELECTRONICS, null, null, 900 }`, oven `{ APPLIANCE, "FIXTURE", 0, null }`, saw `{ TOOL, null, null, null }`:
    - FIXTURE → `{ count: 2, priced: 2, paid: 4200, withReplacementCost: 1, toReplace: 5200, toReplaceOrPaid: 5200 }`.
    - CONTENTS → `{ count: 3, priced: 1, paid: 2499, withReplacementCost: 1, toReplace: 900, toReplaceOrPaid: 3399 }`.
- [ ] **Step 2: Run** `npx vitest run lib/equipment-value.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the functions above in `lib/equipment-value.ts`. Add a file comment noting that the backup engine imports it, so it must stay import-free.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** No commit.

### Task 3: Age against expected life and the replacement prefill

**Files:**
- Create: `lib/equipment-life.ts`
- Test: `lib/equipment-life.test.ts`

**Interfaces:**
- Produces:
  - `type LifeFields = { installDate: Date | null; purchaseDate: Date | null; expectedLifeYears: number | null }`
  - `lifeStart(e: LifeFields): Date | null`. Returns `installDate ?? purchaseDate`.
  - `addYearsUTC(d: Date, years: number): Date`. Same UTC month and day `years` later, at 12:00 UTC. Feb 29 becomes Feb 28 in a non-leap year.
  - `equipmentAge(e: LifeFields, today: Date): { years: number; lifeYears: number; pastLife: boolean } | null`. Null without `expectedLifeYears` or a start date.
    - `years` counts whole years by UTC calendar day: the clamped anniversary on or before today counts. It's floored at 0.
    - `pastLife` is `years >= lifeYears`.
  - `ageLabel(a: { years: number; lifeYears: number }): string`. Returns "12 of 15 years", or "0 of 1 year" when `lifeYears === 1`.
  - `replacementPlan(e: LifeFields & { name: string; replacementCost: number | null }, today: Date): { title: string; dueDate: Date; estimatedCost: number | null }`
    - `title` is `Replace ${name}`.
    - `dueDate` is `addYearsUTC(start, life)` when both exist and its UTC day isn't before today's. Otherwise it's `addYearsUTC(today, 1)`.
    - `estimatedCost` is `replacementCost`.

- [ ] **Step 1: Write failing tests:**
  - `addYearsUTC(new Date("2016-02-29T00:00Z"), 10)` → `2026-02-28T12:00:00.000Z`. `addYearsUTC(new Date("2020-06-15T00:00Z"), 4)` → `2024-06-15T12:00:00.000Z`.
  - `lifeStart` prefers `installDate` over `purchaseDate`, falls back to `purchaseDate`, and is null with neither.
  - `equipmentAge({ installDate: 2014-03-01, purchaseDate: null, expectedLifeYears: 15 }, 2026-10-24)` → `{ years: 12, lifeYears: 15, pastLife: false }`.
  - Install 2016-03-01, today 2026-02-28T23:00Z, life 10 → `years: 9`, `pastLife: false`. Today 2026-03-01T00:30Z → `years: 10`, `pastLife: true`.
  - Install 2016-02-29, today 2026-02-28, life 10 → `years: 10`, `pastLife: true`.
  - Start 2027-01-01, today 2026-10-24 → `years: 0`.
  - `expectedLifeYears: null` → `null`. No dates → `null`.
  - `ageLabel({ years: 12, lifeYears: 15 })` → `"12 of 15 years"`. `{ years: 0, lifeYears: 1 }` → `"0 of 1 year"`.
  - `replacementPlan` for "Water Heater", install 2020-05-10, life 12, cost 1800, today 2026-10-24 → `{ title: "Replace Water Heater", dueDate: 2032-05-10T12:00Z, estimatedCost: 1800 }`.
  - Install 2010-05-10, life 12, today 2026-10-24 → `dueDate` 2027-10-24T12:00Z.
  - Install 2014-10-24, life 12, today 2026-10-24T20:00Z → `dueDate` 2026-10-24T12:00Z (today counts as not passed).
  - `expectedLifeYears: null` → a year from today. No dates → a year from today. `replacementCost: null` → `estimatedCost: null`.
- [ ] **Step 2: Run** `npx vitest run lib/equipment-life.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions above. `equipmentAge` takes `y = today.year - start.year`, then subtracts 1 if `addYearsUTC(start, y)`'s UTC day is after today's UTC day.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Checkpoint.** No commit.

### Task 4: Equipment form fields

**Files:**
- Modify: `components/equipment/equipment-form-dialog.tsx` (`schema` :25, `EMPTY` :57, the `form.reset` in the effect :69, the fields grid)

**Interfaces:**
- Consumes: `VALUE_CLASSES`, `valueClassLabel` and `defaultValueClass` (Task 2), and the action fields (Task 1).
- Produces: the form sends `valueClass` (`""` for Default), `expectedLifeYears` and `replacementCost` as strings. The action is unchanged, because `equipmentSchema` already accepts them.

- [ ] **Step 1: Read** the client-component guide in `node_modules/next/dist/docs/01-app/`.
- [ ] **Step 2: Add the three fields** to the zod `schema` (all `z.string().optional()`) and to `EMPTY` (all `""`). Fill them in the edit branch of `form.reset`: `equipment.valueClass ?? ""`, `equipment.expectedLifeYears?.toString() ?? ""` and `equipment.replacementCost?.toString() ?? ""`.
- [ ] **Step 3: Add the inputs** after "Purchase Price", before "Notes":
  - "Replacement cost": `type="number" step="0.01" min="0"`, placeholder `2800`.
  - "Expected life (years)": `type="number" step="1" min="1" max="100"`, placeholder `15`.
  - "Counts as": a Select. Base UI Select has no empty option, so use a `DEFAULT_CLASS = "__default__"` sentinel like `NO_PROPERTY`, and map it to and from `""`. Options:
    - `Default (${valueClassLabel(defaultValueClass(category))})`, where `category` comes from `useWatch({ control: form.control, name: "category" })` so the label follows the category select.
    - "Part of the home".
    - "Belongings".
- [ ] **Step 4: Checkpoint.** `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass. No commit.
- [ ] **Step 5: Manual verification list for the user** (the executor doesn't run a browser and must say so):
  - Add an HVAC item. "Counts as" reads "Default (Part of the home)". Switch the category to Appliance and it reads "Default (Belongings)".
  - Save an item with all three fields filled, reopen it, and check the values come back.
  - Set an override back to Default, save and reopen. It shows Default.
  - Clear Replacement cost, save and reopen. It stays empty, not 0.

### Task 5: Equipment page: age stat and "Plan replacement"

**Files:**
- Modify: `components/maintenance/maintenance-form-dialog.tsx` (`Props` :57, the reset effect :124–142)
- Create: `components/equipment/plan-replacement-button.tsx`
- Modify: `app/(app)/assets/equipment/[id]/page.tsx` (stats :55–75, header buttons :91–108)

**Interfaces:**
- Consumes: `equipmentAge`, `ageLabel` and `replacementPlan` (Task 3).
- Produces:
  - `export type MaintenanceFormDefaults = Partial<Pick<FormValues, "title" | "repeat" | "nextDueDate" | "estimatedCost">>`, exported from `maintenance-form-dialog.tsx`.
  - The dialog prop `defaults?: MaintenanceFormDefaults`. It applies only when `schedule` is null: the new-schedule branch of `form.reset` spreads `...defaults` over its blank values. Add `defaults` to the effect's deps. The JSDoc says: "A new schedule's starting values. Pass a stable object (state or memo); a new object resets the form."
  - `PlanReplacementButton({ equipment, roomOptions }: { equipment: Equipment; roomOptions: RoomOption[] })`

- [ ] **Step 1: Read** the server and client component guides in `node_modules/next/dist/docs/01-app/`.
- [ ] **Step 2: Add the `defaults` prop** to `MaintenanceFormDialog`. Existing callers (`maintenance-list.tsx`) don't pass it, so they behave as before.
- [ ] **Step 3: Create `PlanReplacementButton`.** It's a client component that holds `defaults` in `useState<MaintenanceFormDefaults | null>`.
  - On click, set `defaults` from `replacementPlan(equipment, new Date())`:
    - `title`
    - `repeat: "once"`
    - `nextDueDate: dueDate.toISOString().split("T")[0]`
    - `estimatedCost: estimatedCost?.toString() ?? ""`
  - Then open `MaintenanceFormDialog` with `assetId={equipment.id}`, `assetType="EQUIPMENT"`, `roomOptions`, `defaultRoomId={equipment.roomId}` and `defaults`.
  - The button matches `EquipmentEditButton`'s classes, uses the `CalendarClock` icon and reads "Plan replacement". The create action already revalidates the equipment page, so the new reminder shows on the Maintenance tab after saving. Cancel creates nothing.
- [ ] **Step 4: Page.** Put `<PlanReplacementButton equipment={equipment} roomOptions={roomOptions} />` after `EquipmentEditButton`. It always shows, even without a life or cost: the prefill falls back to a year from today.
  - After the Purchased stat, compute `const age = equipmentAge(equipment, new Date())`. When it's non-null, render `<Stat icon={Hourglass} label="Age" value={ageLabel(age)} />`.
  - When `age.pastLife` is true, wrap the value in `<span className="text-amber-700 dark:text-amber-400">`. That's the app's existing warning tone, used in `components/inbox/inbox-item-card.tsx` (`AMBER_TEXT`) and the chat notices.
- [ ] **Step 5: Checkpoint.** Lint (8 warnings) and tsc pass. No commit.
- [ ] **Step 6: Manual verification list for the user:**
  - Equipment installed 12 years ago with a 15-year life shows "Age 12 of 15 years" in the normal colour. With a 10-year life it's amber.
  - With no expected life, there's no Age stat.
  - "Plan replacement" opens the reminder form with "Once" selected, the title "Replace {name}", the due date and the estimated cost filled in. Cancel, and the Maintenance tab count doesn't change. Open it again, save, and the count goes up by one.
  - On an item whose life ran out, the due date is a year from today.
  - The Maintenance tab's own "Add" still opens a blank form.

### Task 6: Property Equipment tab: value summary

**Files:**
- Create: `components/equipment/equipment-value-summary.tsx`
- Modify: `components/equipment/property-equipment.tsx` (render the summary between the header row :24–29 and the rows)

**Interfaces:**
- Consumes: `equipmentValueTotals`, `VALUE_CLASSES` and `type ClassTotals` (Task 2).
- Produces: `EquipmentValueSummary({ equipment }: { equipment: Equipment[] })`, a client component that uses `useFormat()`.

- [ ] **Step 1: Confirm the data path.** `app/(app)/assets/properties/[id]/page.tsx` :40 loads `prisma.equipment.findMany({ where: { propertyId: id }, include: { room: ... } })` with no `select`, so the new columns reach `PropertyEquipment`. Leave the page file unchanged. People and vehicle pages have no equipment, so leave them unchanged too.
- [ ] **Step 2: Build `EquipmentValueSummary`.**
  - Render nothing when no item has a `purchasePrice` or a `replacementCost`.
  - Otherwise, for each class in `VALUE_CLASSES` order with `count > 0`, render a small bordered block titled with the label.
    - "Paid {fmt.moneyWhole(paid)}" when `priced > 0`.
    - "To replace {fmt.moneyWhole(toReplace)}" when `withReplacementCost > 0`. Add " ({withReplacementCost} of {count} items)" when `withReplacementCost < count`.
  - Under the blocks, when the summed `count - priced` across classes is above 0, show a muted line: "1 item has no price" or "3 items have no price".
- [ ] **Step 3: Render** `<EquipmentValueSummary equipment={equipment} />` in `PropertyEquipment` when `equipment.length > 0`.
- [ ] **Step 4: Checkpoint.** Lint (8 warnings) and tsc pass. No commit.
- [ ] **Step 5: Manual verification list for the user:**
  - Open a demo property's Equipment tab. It shows "Part of the home" and "Belongings" blocks with paid totals, and "To replace" on the blocks where demo items have a replacement cost.
  - Change an appliance to "Part of the home". Its price moves between blocks after saving.
  - Clear one item's purchase price. The "1 item has no price" line appears.
  - A property with no equipment shows no summary.

### Task 7: Assistant, backup export, docs and demo data

**Files:**
- Modify: `lib/llm/ontology.ts` (enum import :1–4, `equipment.fields` :122–125)
- Modify: `lib/backup/readable.ts` (imports :4, equipment `details` :137)
- Modify: `lib/backup/import-rules.test.ts` (`helpers` :12)
- Modify: `Dockerfile` (after :70)
- Modify: `docs/export-format.md` (the `assets.json` bullet)
- Modify: `prisma/seed-demo.ts` (`EQUIPMENT` type :417–420, a few entries, `prisma.equipment.create` :676–684)
- Test: `lib/llm/ontology.test.ts`, `lib/backup/readable.test.ts`

**Interfaces:**
- Consumes: `effectiveValueClass` and `valueClassLabel` (Task 2).
- Produces: equipment `details` gain the labels `"Counts as"` (the effective label, always set), `"Expected life (years)"` and `"Replacement cost"`.

- [ ] **Step 1: Write failing tests.**
  - `ontology.test.ts`, new `it("lets the assistant see equipment value and lifespan")`:
    - `ENTITIES.equipment.fields` includes `valueClass`, `expectedLifeYears` and `replacementCost`.
    - `fields.valueClass.values` equals `["FIXTURE", "CONTENTS"]`.
    - `fields.valueClass.description` matches `/category/i`.
  - `readable.test.ts`, new `it("equipment details: counts as, expected life, replacement cost")`. It follows the rooms test's setup (`snap()`, `createClient`, `executeMultiple`, `releaseDbHandles`). Insert two rows into `"Equipment"`:
    - `('e7', 'Furnace', 'HVAC', NULL valueClass, 18, 5200)`. Its details are `"Counts as": "Part of the home"`, `"Expected life (years)": 18`, `"Replacement cost": 5200`.
    - `('e8', 'Oven', 'APPLIANCE', 'FIXTURE', NULL, NULL)`. Its details are `"Counts as": "Part of the home"`, `"Expected life (years)": null`, `"Replacement cost": null`.
  - Run `npx vitest run lib/llm/ontology.test.ts lib/backup/readable.test.ts`. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - Ontology: import `EquipmentValueClass` from `@/app/generated/prisma/enums`. Add:
    - `valueClass: enumOf(EquipmentValueClass, "Part of the home (FIXTURE) or belongings (CONTENTS). Null means the category default: HVAC, WATER, SECURITY are FIXTURE; the rest are CONTENTS.")`
    - `expectedLifeYears: { type: "int", description: "Years it should last, from installDate else purchaseDate" }`
    - `replacementCost: money`
    - Change the entity description to "Appliances, HVAC, tools, electronics, usually tied to a property, with optional expected life and replacement cost."
  - `readable.ts`: `import { effectiveValueClass, valueClassLabel, type ValueClass } from "../equipment-value"` (relative import only). In the equipment `details`, after "Purchase price", add:
    - `"Counts as": valueClassLabel(effectiveValueClass({ category: String(r.category), valueClass: (str(r.valueClass) as ValueClass | null) }))`
    - `"Expected life (years)": num(r.expectedLifeYears)`
    - `"Replacement cost": num(r.replacementCost)`
  - Add `"lib/equipment-value.ts"` to `helpers` in `import-rules.test.ts`. Add `COPY --from=builder /app/lib/equipment-value.ts ./lib/equipment-value.ts` to the `Dockerfile` after the `lib/maintenance-schedule.ts` line.
  - `docs/export-format.md`: in the `assets.json` bullet, add that equipment details include "Counts as" (Part of the home or Belongings, the category default when not set), "Expected life (years)" and "Replacement cost".
- [ ] **Step 3: Run** `npx vitest run lib/llm/ontology.test.ts lib/backup/readable.test.ts lib/backup/import-rules.test.ts`. Expected: PASS.
- [ ] **Step 4: Demo seed.**
  - Extend the `EQUIPMENT` element type with `life?: number; replace?: number; valueClass?: "FIXTURE" | "CONTENTS"`. Pass `expectedLifeYears: e.life ?? null`, `replacementCost: e.replace ?? null` and `valueClass: e.valueClass ?? null` in `prisma.equipment.create`.
  - Set values on these entries:
    - Gas Furnace: life 18, replace 5200.
    - Central Air Conditioner: life 15, replace 6500.
    - Water Heater: life 12, replace 1800.
    - Whole-House Humidifier: life 5, replace 450. At 1830 days old it shows the amber past-life age.
    - Kitchen Refrigerator: life 13, replace 2700.
    - Dishwasher: `valueClass: "FIXTURE"` (built-in), life 10.
    - Boiler: life 25, replace 7800.
    - Rental Water Heater: life 10, replace 1500.
  - Don't run the seed. `npx tsc --noEmit` covers it.
- [ ] **Step 5: Final checkpoint.** Run `npx vitest run`, `npx eslint .` and `npx tsc --noEmit`, and quote the summary lines (eslint: 0 errors, 8 warnings). Confirm `git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing. Run `git status` and list the changed files. Don't commit. Say which manual-verification lists (Tasks 4–6) are still open for the user.
