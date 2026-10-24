# Step 5: Property, auto, umbrella and life insurance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home, renters, auto, umbrella, life and other non-health policies live in an Insurance section that shows whether or not Health is on, with linked properties and vehicles, coverage lines, premium history, renewal reminders and an under-insurance line on the property page. Medical, dental and vision stay behind the Health switch.

**Architecture:** One import-free pure module, `lib/insurance.ts`, holds every rule: which kinds are health kinds, labels and groups, which links a kind may carry, status and renewal text, premium maths, coverage rows and the under-insurance comparison. The schema gains six `InsuranceKind` values, a `POLICY_RENEWAL` notification type, two models (`InsurancePremium`, `InsuranceCoverage`) and two implicit join tables (policy to property, policy to vehicle); the migration only creates tables. A small server module loads policies with the Health filter applied, the actions enforce Health off on the server, and the page, asset pages, notification checker, assistant, search, file routes and readable export call into the pure module.

**Tech Stack:** Next.js 16 (app router, server actions), Prisma 7 + SQLite/libSQL, zod, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-cost-planning-and-insurance-design.md`, section "Step 5: Property, auto, umbrella and life insurance" (plus Goals, Non-goals, Anti-goals, Constraints, and "Calls made without the user").

## Decisions (check these)

Calls the spec left open, made here so the executor doesn't have to. Change any before execution starts.

1. **Policy form.** A new react-hook-form dialog, `components/insurance/insurance-form-dialog.tsx`, modelled on `components/rooms/room-form-dialog.tsx` (field array plus datalist suggestions). `EntityFormDialog` can't hide fields by kind or edit coverage rows, and changing it would touch every health form. "Add premium" does use `EntityFormDialog`, since it's four plain fields.
2. **Validation stays in `lib/health-schemas.ts`.** `insuranceSchema` gains `propertyIds`, `vehicleIds` and `coverages`; a new `premiumSchema` sits beside it. Its existing tests stay as they are.
3. **Which links a kind may carry.** Health kinds: people only. LIFE: people only, and only with Health on. HOME, RENTERS, AUTO, UMBRELLA and Other: properties and vehicles only. The server drops links the kind doesn't allow, so switching MEDICAL to HOME clears its people and switching HOME to MEDICAL clears its properties and vehicles.
4. **Health off never clears people.** With Health off the form has no people picker, and an update leaves the policy's people untouched instead of setting them to none. Sending people anyway is refused with "Turn on Health in Settings to link people." Without this, editing a life policy with Health off would wipe who it covers.
5. **Health-only fields.** `memberId`, `groupNumber` and `outOfPocketMax` show only for health kinds and are saved as null for other kinds.
6. **Premiums and coverage lines on every kind**, health kinds included (no label suggestions for them). Premiums can be added and deleted, not edited. RENTERS gets suggestions too: Personal property, Loss of use, Liability, Medical payments.
7. **Current premium** is the newest one effective on or before today; when every premium is in the future, the earliest one. The change compares it with the premium just before it, both annualised, rounded to a whole percent: "+12% vs last term", "-5% vs last term", "Same as last term". Ties on the same date go to the later `createdAt`.
8. **Status badge.** Health kinds keep "Ends in Nd" with the 60-day window. Other kinds read "Renews in Nd" / "Renews today" inside 30 days. Past `endDate` reads "Ended" for both.
9. **Renewal notification text.** Title `Renewal coming up: {carrier plan}`, message `"{name}" renews in N days.` or `"{name}" renews today.`, stage DUE on the day. Health kinds keep `INSURANCE_EXPIRING` unchanged.
10. **New policy defaults to HOME.** The kind list puts non-health kinds first; with Health off it lists only them.
11. **Icons.** The sidebar item and `POLICY_RENEWAL` use lucide `Umbrella`. `INSURANCE_EXPIRING` keeps `ShieldPlus`.
12. **Assistant links stay `/insurance`.** `/insurance?open=id` would be flagged by `impossibleLinks` in `lib/llm/link-check.ts`, so the ontology `href` doesn't change. `insurancePolicy` leaves `HEALTH_ENTITIES` and gets a `healthOff` where-clause; two new entities, `insurancePremium` and `insuranceCoverage`, carry the same rule through their policy. `health_alerts` only reads health kinds.
13. **Readable export.** Non-health policies go to a new top-level `insurance` array (`insurance.json`), exported with or without health. `health.insurance` keeps health kinds only, with the same new fields. `insurance.csv` is now always written and holds both; `insurance-premiums.csv` and `insurance-coverages.csv` are new. The offline viewer page isn't changed.
14. **Extra Health-off closures** beyond the spec's list: `visibleNotificationsWhere` also hides notifications whose policy is now a health kind (a POLICY_RENEWAL raised before a kind change), and the upload route refuses new files on a health-kind policy while Health is off, matching the file route.
15. **No change** to `COUNTED_MODELS` (restore panel counts), `lib/asset-delete-server.ts` (join rows cascade in SQLite; Task 3 tests it), `lib/backup/restore.ts`, the Costs page, or the equipment detail page (equipment can't be linked to a policy).

## Open question

With Health off, the assistant's document tools (`search_documents`, `read_document`) can already read insurance card files today. That's deliberate in `lib/documents/tool-helpers.ts` ("Insurance policies aren't one person's record and stay visible"). **Default: leave it.** If the user wants health-kind policy files hidden with Health off, Task 9 gains a clause in `healthWhere()` and `isHealthDocument()`; that also hides them with Health on whenever "Include health record documents" is off.

## Global Constraints

- Don't touch `app/(app)/page.tsx` or `components/dashboard/*`. Neither references `NotificationType`, notification icons or insurance (checked with grep), so the new enum value needs no dashboard edit. Every icon map keyed by type is a `Record<string, …>` with a `Bell` fallback, so nothing fails to compile either.
- Premiums don't count as spend: no change to `lib/costs-server.ts`, `app/(app)/costs/*` or `components/costs/*`.
- **The executor doesn't commit, push, `git add`, `stash` or `checkout` unless the user asks.** Each task ends with a commit step for when the user does ask; until then treat it as a checkpoint and leave everything uncommitted.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `07-mutating-data.md` before writing page, client component or server action code.
- Read `prisma/schema.prisma` before data changes. Migrations go through `npx prisma migrate dev` and live in `prisma/migrations/YYYYMMDDHHMMSS_snake_name/`. After migrating, **also run `npx prisma generate`**; `tsc` fails without it.
- New logic goes in pure functions with Vitest tests beside them. Vitest only picks up `lib/**/*.test.ts`. No component tests, so components and server modules stay thin.
- `lib/insurance.ts` is imported by `lib/backup/readable.ts`, an engine file. It may only have `import type` lines (erased at runtime), must be added to `helpers` in `lib/backup/import-rules.test.ts`, and needs `COPY --from=builder /app/lib/insurance.ts ./lib/insurance.ts` in the `Dockerfile` after the `lib/manual-reference.ts` line (:72).
- In react-hook-form components use `useWatch`, never `form.watch`.
- Money is shown with `useFormat()` / `getFormat()` (`fmt.money`, `fmt.moneyWhole`, `fmt.currencySymbol`).
- The repo has exactly 8 pre-existing eslint warnings. No new ones.
- Never run `npm run db:seed:demo`. It wipes the dev DB. Type-check the seed only.
- Shell heredocs with quotes or apostrophes break in this environment. Use the Edit tool, or write a script to the scratchpad and run it.
- No browser tool is available. UI tasks end with a manual-verification list for the user, and the executor says it did **not** check in a browser.
- A task is done when `npx vitest run`, `npx eslint .` (0 errors, 8 warnings) and `npx tsc --noEmit` all pass.
- People, property and vehicle detail pages are checked together (repo CLAUDE.md). Task 7 changes all three.
- Commit messages are one line and end with `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

## Review Focus

1. **Health is switched off with policies on file.** A household has Blue Cross (MEDICAL), State Farm (HOME) and Lifeco (LIFE, covering two people). With Health off, `/insurance` shows State Farm and Lifeco, no people's names anywhere in the page payload, and no Blue Cross. Editing Lifeco keeps its two people for when Health comes back. Calling the actions directly for Blue Cross returns "Not found". Task 1 tests `linkWrites` for these; Task 4 wires the guard and the loader.
2. **Kind changes.** Blue Cross with members and a member ID is switched to HOME with Health on: its people, member ID, group number and out-of-pocket max are cleared, and properties can be picked. HOME switched back to MEDICAL drops its properties and vehicles. Task 1 tests `linkWrites`; Task 4 applies the field clearing.
3. **Renewal boundaries.** A HOME policy ending in 30 days raises one POLICY_RENEWAL, at 31 days none, on the day a DUE-stage one, the day after none. A MEDICAL policy never raises POLICY_RENEWAL, so it isn't notified twice. Task 1 tests `renewalNotice`.
4. **Coverage label matching.** " personal PROPERTY " counts toward personal property coverage; "Personal property (scheduled items)" doesn't; a health policy's line is ignored; lines with no limit leave the comparison hidden. Task 2 tests `personalPropertyCoverage` and `belongingsComparison`.
5. **Upgrading a live database.** Existing health policies keep their kind, their people links and their card files through the migration, and an older backup still restores. Task 3 tests the migration on a pre-step-5 database; `restore.test.ts` "accepts an older-schema backup" covers restore.

---

### Task 1: Pure rules, part 1: kinds, links, status, renewal

**Files:**
- Create: `lib/insurance.ts`
- Test: `lib/insurance.test.ts`

**Interfaces:**
- Produces (only `import type { FieldOption } from "@/lib/form-types"` allowed):

```ts
export type InsuranceKindValue = "MEDICAL" | "DENTAL" | "VISION" | "OTHER" | "HOME" | "RENTERS" | "AUTO" | "UMBRELLA" | "LIFE" | "PROPERTY_OTHER"
export const HEALTH_INSURANCE_KINDS = ["MEDICAL", "DENTAL", "VISION", "OTHER"] as const
export const POLICY_RENEWAL_DAYS = 30
export const HEALTH_POLICY_DAYS = 60
export const INSURANCE_KINDS: FieldOption[]   // display order, see Step 3
export function isHealthInsuranceKind(kind: string): boolean
export function insuranceKindLabel(kind: string): string
export function kindOptions(health: boolean): FieldOption[]
export type PolicyGroup = "PROPERTY" | "LIFE" | "HEALTH"
export function groupPolicies<T extends { kind: string }>(policies: T[], health: boolean): { group: PolicyGroup; title: string; policies: T[] }[]
export function allowedLinks(kind: string, health: boolean): { members: boolean; assets: boolean }
export type LinkIds = { memberIds: string[]; propertyIds: string[]; vehicleIds: string[] }
export function linkWrites(kind: string, health: boolean, ids: LinkIds):
  | { ok: true; members?: string[]; properties: string[]; vehicles: string[] }
  | { ok: false; field: "kind" | "memberIds"; error: string }
export function renewalWindowDays(kind: string): number
export function policyStatus(p: { kind: string; endDate: Date | null }, now: Date): { label: string; variant: "outline" | "secondary" | "destructive" }
export function renewalNotice(p: { carrier: string; planName: string | null; kind: string; endDate: Date | null }, now: Date):
  { title: string; message: string; stage: "REACHED" | "DUE" } | null
```

- [ ] **Step 1: Write failing tests** in `describe("insurance kinds and links")`. Use `const now = new Date("2026-10-24T00:00:00Z")` and `const d = (s: string) => new Date(s)`.
  - `it("tells health kinds from the rest")`: true for `MEDICAL`, `DENTAL`, `VISION`, `OTHER`; false for `HOME`, `RENTERS`, `AUTO`, `UMBRELLA`, `LIFE`, `PROPERTY_OTHER`. `HEALTH_POLICY_DAYS` equals `HEALTH_WINDOWS.insuranceDays` from `./health` (import it in the test only).
  - `it("labels kinds")`: `insuranceKindLabel("OTHER")` → `"Other (health)"`, `"PROPERTY_OTHER"` → `"Other"`, `"UMBRELLA"` → `"Umbrella"`, `"XYZ"` → `"XYZ"`.
  - `it("offers health kinds only while Health is on")`: `kindOptions(false).map((o) => o.value)` → `["HOME", "RENTERS", "AUTO", "UMBRELLA", "LIFE", "PROPERTY_OTHER"]`; `kindOptions(true)` has those six then `["MEDICAL", "DENTAL", "VISION", "OTHER"]`.
  - `it("groups policies: property and auto, life, then health")`: input kinds `[MEDICAL, LIFE, AUTO, HOME]` (objects `{ id, kind }`), health true → titles `["Property and auto", "Life", "Health"]`, first group's ids in input order (`AUTO`, `HOME`). Health false → titles `["Property and auto", "Life"]`. Only a MEDICAL policy with health true → `["Health"]`; `[]` → `[]`.
  - `it("decides which links a kind may carry")`: `allowedLinks("HOME", true)` → `{ members: false, assets: true }`; `("LIFE", true)` → `{ members: true, assets: false }`; `("LIFE", false)` → `{ members: false, assets: false }`; `("MEDICAL", true)` → `{ members: true, assets: false }`; `("UMBRELLA", false)` → `{ members: false, assets: true }`.
  - `it("drops links the kind can't carry")`, with `ids = { memberIds: ["h1"], propertyIds: ["p1"], vehicleIds: ["v1"] }`:
    - `linkWrites("HOME", true, ids)` → `{ ok: true, members: [], properties: ["p1"], vehicles: ["v1"] }`.
    - `("LIFE", true, ids)` → `{ ok: true, members: ["h1"], properties: [], vehicles: [] }`.
    - `("MEDICAL", true, ids)` → `{ ok: true, members: ["h1"], properties: [], vehicles: [] }`.
  - `it("refuses health data while Health is off and leaves people alone")`:
    - `linkWrites("MEDICAL", false, ids)` → `{ ok: false, field: "kind", error: "Health is turned off in Settings." }`.
    - `("LIFE", false, ids)` → `{ ok: false, field: "memberIds", error: "Turn on Health in Settings to link people." }`.
    - `("LIFE", false, { memberIds: [], propertyIds: ["p1"], vehicleIds: [] })` → `ok: true`, `properties: []`, `vehicles: []`, and `expect(r).not.toHaveProperty("members")`.
    - `("AUTO", false, { memberIds: [], propertyIds: [], vehicleIds: ["v1", "v2"] })` → `ok: true`, `vehicles: ["v1", "v2"]`, no `members` key.
  - `it("shows status with the window for the kind")`:
    - `policyStatus({ kind: "HOME", endDate: null }, now)` → `{ label: "Active", variant: "outline" }`.
    - HOME ending `2026-11-10` → `{ label: "Renews in 17d", variant: "destructive" }`; ending `2026-10-24` → `"Renews today"`; ending `2026-12-20` → `"Active"`; ending `2026-10-01` → `{ label: "Ended", variant: "secondary" }`.
    - MEDICAL ending `2026-12-20` → `{ label: "Ends in 57d", variant: "destructive" }`; ending `2026-10-24` → `"Ends today"`.
  - `it("raises a renewal notice 30 days out for non-health kinds only")`, `p = { carrier: "State Farm", planName: "Homeowners", kind: "HOME" }`:
    - endDate `2026-11-23` (30 days) → `{ title: "Renewal coming up: State Farm Homeowners", message: "\"State Farm Homeowners\" renews in 30 days.", stage: "REACHED" }`.
    - `2026-11-24` (31 days) → `null`. `2026-10-25` → message `"\"State Farm Homeowners\" renews in 1 day."`.
    - `2026-10-24` → message `"\"State Farm Homeowners\" renews today."`, stage `"DUE"`. `2026-10-23` → `null`. `endDate: null` → `null`.
    - `kind: "MEDICAL"` ending `2026-11-10` → `null`. `planName: null` → name is `"State Farm"`.
- [ ] **Step 2: Run** `npx vitest run lib/insurance.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions. Notes:
  - `INSURANCE_KINDS` order and labels: HOME "Home", RENTERS "Renters", AUTO "Auto", UMBRELLA "Umbrella", LIFE "Life", PROPERTY_OTHER "Other", MEDICAL "Medical", DENTAL "Dental", VISION "Vision", OTHER "Other (health)".
  - Day count: `Math.ceil((endDate - now) / 86_400_000) || 0`, the same formula as `daysUntil` in `lib/health.ts`, written out so the file stays free of runtime imports. Say so in a comment.
  - `groupPolicies` groups by `policyGroup`: LIFE → LIFE, health kinds → HEALTH, the rest → PROPERTY. Order PROPERTY, LIFE, HEALTH; empty groups and (when `!health`) HEALTH are dropped.
  - File comment: "Imported by the backup engine (lib/backup/readable.ts): runtime imports aren't allowed here, only `import type`."
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** (only if the user asked): `git add lib/insurance.ts lib/insurance.test.ts && git commit -m "Add the rules for insurance kinds, links and renewals" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 2: Pure rules, part 2: premiums, coverage lines, under-insurance

**Files:**
- Modify: `lib/insurance.ts`
- Test: `lib/insurance.test.ts`

**Interfaces:**
- Consumes: `isHealthInsuranceKind` (Task 1); `import type { ClassTotals } from "./equipment-value"`.
- Produces:

```ts
export type PremiumPeriodValue = "MONTHLY" | "SEMIANNUAL" | "ANNUAL"
export const PREMIUM_PERIODS: FieldOption[]   // ANNUAL "Yearly", SEMIANNUAL "Every 6 months", MONTHLY "Monthly"
export function annualPremium(p: { amount: number; period: string }): number
export type PremiumLike = { effectiveDate: Date; amount: number; period: string; createdAt?: Date }
export function currentAndPrevious<T extends PremiumLike>(premiums: T[], now: Date): { current: T | null; previous: T | null }
export function premiumChange(current: PremiumLike | null, previous: PremiumLike | null): number | null
export function premiumChangeLabel(change: number | null): string | null
export function coverageSuggestions(kind: string): string[]
export type CoverageRow = { label: string; limit: number | null; deductible: number | null; sortOrder: number }
export function coverageRows(rows: { label: string | null; limit: number | null; deductible: number | null }[]): CoverageRow[]
export function personalPropertyCoverage(policies: { kind: string; coverages: { label: string; limit: number | null }[] }[]): number | null
export function belongingsComparison(
  contents: Pick<ClassTotals, "priced" | "withReplacementCost" | "toReplaceOrPaid">,
  policies: { kind: string; coverages: { label: string; limit: number | null }[] }[],
): { belongings: number; coverage: number } | null
```

- [ ] **Step 1: Write failing tests** in `describe("premiums and coverage")`:
  - `it("annualises premiums")`: `{ amount: 100, period: "MONTHLY" }` → 1200; `{ 612.5, "SEMIANNUAL" }` → 1225; `{ 1840, "ANNUAL" }` → 1840; `{ 33.33, "MONTHLY" }` → 399.96 (rounded to cents).
  - `it("picks the current and previous premium")`, with `a` 2024-11-01 1500 ANNUAL, `b` 2025-11-01 1680 ANNUAL, `c` 2026-11-01 1900 ANNUAL (pass them shuffled):
    - now 2026-10-24 → current `b`, previous `a`. now 2026-11-01 → current `c`, previous `b`.
    - `[c]` at 2026-10-24 → current `c`, previous `null`. `[]` → both `null`.
    - Two premiums dated 2025-11-01 with `createdAt` 09:00 and 10:00 → current is the 10:00 one, previous the 09:00 one.
  - `it("compares premiums by their yearly cost")`: `premiumChange(b, a)` → 0.12 (`toBeCloseTo`). A 150 MONTHLY vs 1500 ANNUAL → 0.2. Previous `null` → `null`. Previous amount 0 → `null`.
  - `it("words the change")`: 0.12 → `"+12% vs last term"`; -0.054 → `"-5% vs last term"`; 0.004 → `"Same as last term"`; `null` → `null`.
  - `it("suggests coverage names by kind")`: HOME → `["Dwelling", "Other structures", "Personal property", "Loss of use", "Liability", "Medical payments"]`; AUTO → `["Bodily injury", "Property damage", "Collision", "Comprehensive", "Uninsured motorist"]`; UMBRELLA → `["Liability"]`; LIFE → `["Death benefit"]`; RENTERS → `["Personal property", "Loss of use", "Liability", "Medical payments"]`; MEDICAL and PROPERTY_OTHER → `[]`.
  - `it("keeps named coverage lines in order")`: `[{ label: " Dwelling ", limit: 450000, deductible: 2500 }, { label: null, limit: null, deductible: null }, { label: "Personal property", limit: 225000, deductible: null }]` → `[{ label: "Dwelling", limit: 450000, deductible: 2500, sortOrder: 0 }, { label: "Personal property", limit: 225000, deductible: null, sortOrder: 1 }]`. A row with `label: "  "` and a limit is dropped too (the schema refuses it first; see Task 4).
  - `it("adds up personal property coverage across non-health policies")`: HOME with Dwelling 450000 and `" personal PROPERTY "` 225000, UMBRELLA with "Personal property" `null`, RENTERS with "Personal property" 20000, MEDICAL with "Personal property" 5000, HOME with "Personal property (scheduled items)" 9000 → 245000. Only a Dwelling line → `null`. Only `null` limits → `null`.
  - `it("compares belongings with personal property coverage only when both exist")`: `({ priced: 3, withReplacementCost: 2, toReplaceOrPaid: 18450 }, [HOME with Personal property 225000])` → `{ belongings: 18450, coverage: 225000 }`. Contents `{ priced: 0, withReplacementCost: 0, toReplaceOrPaid: 0 }` → `null`. Contents set but no matching coverage → `null`. `{ priced: 1, withReplacementCost: 0, toReplaceOrPaid: 0 }` (an item bought for 0) with coverage → `{ belongings: 0, coverage: 225000 }`.
- [ ] **Step 2: Run** `npx vitest run lib/insurance.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.** `annualPremium`: `Math.round(amount * perYear * 100) / 100` with MONTHLY 12, SEMIANNUAL 2, ANNUAL 1. `currentAndPrevious`: sort ascending by `effectiveDate`, then `createdAt`; current = last with `effectiveDate <= now`, else the first; previous = the one before current. Label matching: `label.trim().toLowerCase() === "personal property"`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** (only if asked): `git add lib/insurance.ts lib/insurance.test.ts && git commit -m "Add premium, coverage and under-insurance rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 3: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`enum InsuranceKind` :108, `enum NotificationType` :154, `model Property` :209, `model Vehicle` :273, `model InsurancePolicy` :475, `model FeatureSettings` comment :803)
- Create: `prisma/migrations/<timestamp>_insurance_property_auto_life/migration.sql` (generated)
- Test: `lib/backup/snapshot.test.ts`

**Interfaces:**
- Produces: `InsuranceKind` values `HOME`, `RENTERS`, `AUTO`, `UMBRELLA`, `LIFE`, `PROPERTY_OTHER`; enum `PremiumPeriod`; `NotificationType.POLICY_RENEWAL`; `InsurancePolicy.properties`, `.vehicles`, `.premiums`, `.coverages`; `Property.insurancePolicies`, `Vehicle.insurancePolicies`; models `InsurancePremium`, `InsuranceCoverage` exactly as the spec's Schema block. Join tables `_InsurancePolicyToProperty` and `_InsurancePolicyToVehicle` (A = policy id, B = asset id).

- [ ] **Step 1: Schema.** Add the six kinds after `OTHER` with a `///` line: "OTHER is health-gated (every policy before step 5 was made under Health). PROPERTY_OTHER shows as Other." Add `POLICY_RENEWAL` with `/// Non-health policy renewals; raised whether or not Health is on.` Add `properties Property[]`, `vehicles Vehicle[]`, `premiums InsurancePremium[]`, `coverages InsuranceCoverage[]` to `InsurancePolicy`, and `insurancePolicies InsurancePolicy[]` to `Property` and `Vehicle`. Paste `InsurancePremium`, `PremiumPeriod` and `InsuranceCoverage` from the spec after `InsurancePolicy`. Keep `kind @default(MEDICAL)`. Change the FeatureSettings comment to "People, providers, health insurance and everything owned by a person."
- [ ] **Step 2: Migrate.** Run `npx prisma migrate dev --create-only --name insurance_property_auto_life`. Read the SQL. It must contain only `CREATE TABLE` for `InsurancePremium`, `InsuranceCoverage`, `_InsurancePolicyToProperty`, `_InsurancePolicyToVehicle` plus their indexes. If it rebuilds `InsurancePolicy` (`new_InsurancePolicy`) or drops anything, stop and report. Then `npx prisma migrate dev`, then `npx prisma generate`.
- [ ] **Step 3: Write the test** in `snapshot.test.ts`: `it("keeps health policies through the insurance migration and links policies to properties and vehicles")`, in the style of the manual-reference test above it.
  - `createMigratedDb(db, { upTo: "20261024175732_maintenance_manual_reference" })`. Insert user `u1`, person `h1`, property `p1`, vehicle `v1` (`name, make, model, year, updatedAt`), `InsurancePolicy` `i1` (`carrier 'Delta Dental', kind 'DENTAL'`), `_InsurancePolicyToPerson (A, B) ('i1', 'h1')`, and attachment `ai1` (`recordType 'INSURANCE'`, `insurancePolicyId 'i1'`).
  - Find the folder ending `_insurance_property_auto_life` and `executeMultiple` its SQL.
  - `i1.kind` is `"DENTAL"`; the person link and `ai1` still exist.
  - Insert policy `i2` (`kind 'HOME'`), `_InsurancePolicyToProperty ('i2', 'p1')`, `_InsurancePolicyToVehicle ('i2', 'v1')`, premium `pr1` (`policyId 'i2', effectiveDate, amount 1680`, no period) and coverage `c1` (`policyId 'i2', label 'Personal property', "limit" 225000`; quote `limit`, it's an SQL keyword). `pr1.period` is `"ANNUAL"`.
  - `PRAGMA foreign_keys = ON`. Delete `p1`: `_InsurancePolicyToProperty` has 0 rows, `i2` and its vehicle link remain. Delete `i2`: premiums, coverages and vehicle links for it are 0.
- [ ] **Step 4: Run** `npx vitest run lib/backup/snapshot.test.ts lib/backup/restore.test.ts`. Expected: PASS ("accepts an older-schema backup" now restores a step-4-era backup).
- [ ] **Step 5: Checkpoint.** `npx tsc --noEmit` passes.
- [ ] **Step 6: Commit** (only if asked): `git add prisma/schema.prisma prisma/migrations lib/backup/snapshot.test.ts && git commit -m "Store non-health policies with premiums, coverage lines and covered assets" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 4: Validation, loaders, actions and Health-off enforcement

**Files:**
- Modify: `lib/health-schemas.ts` (`insuranceSchema` :143, new `premiumSchema`), `lib/health-schemas.test.ts`
- Modify: `lib/health.ts` (`INSURANCE_KINDS` :32 becomes `export { INSURANCE_KINDS } from "@/lib/insurance"`)
- Modify: `lib/features.ts` (`HEALTH_PATHS` :26), `lib/features.test.ts` (:24, :28)
- Modify: `lib/features-server.ts` (`visibleNotificationsWhere` :24)
- Create: `lib/insurance-server.ts`
- Modify: `lib/actions/insurance.ts`

**Interfaces:**
- Consumes: `isHealthInsuranceKind`, `HEALTH_INSURANCE_KINDS`, `linkWrites`, `coverageRows`, `type CoverageRow` (Tasks 1–2).
- Produces:

```ts
// lib/health-schemas.ts
export type PolicyInput = z.input<typeof insuranceSchema>   // propertyIds/vehicleIds/memberIds: comma strings; coverages: { label?: string; limit?: string; deductible?: string }[]
export const premiumSchema   // { effectiveDate: Date; amount: number; period: PremiumPeriod; notes: string | null }

// lib/insurance-server.ts
export function healthKindWhere(health: boolean): Prisma.InsurancePolicyWhereInput   // {} or { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } }
export async function loadInsurancePage(health: boolean): Promise<{
  policies: PolicyRow[]; people: { id: string; name: string }[]; properties: { id: string; name: string }[]; vehicles: { id: string; name: string }[]
}>
export async function loadAssetPolicies(assetType: "PROPERTY" | "VEHICLE", id: string):
  Promise<{ id: string; carrier: string; planName: string | null; kind: string; coverages: { label: string; limit: number | null }[] }[]>

// lib/actions/insurance.ts
export async function createInsurancePolicy(values: PolicyInput): Promise<ActionResult>
export async function updateInsurancePolicy(id: string, values: PolicyInput): Promise<ActionResult>
export async function deleteInsurancePolicy(id: string): Promise<ActionResult>
export async function addInsurancePremium(policyId: string, values: FormValues): Promise<ActionResult>
export async function deleteInsurancePremium(id: string): Promise<ActionResult>
```

`PolicyRow` is defined in `components/insurance/insurance-list.tsx` (Task 6) as `InsurancePolicy & { members, properties, vehicles: { id; name }[]; premiums: InsurancePremium[]; coverages: InsuranceCoverage[]; attachments: Attachment[] }`. `loadInsurancePage` returns that shape; import the type with `import type`.

- [ ] **Step 1: Write failing tests.**
  - `health-schemas.test.ts`:
    - `it("splits property and vehicle ids")`: `insuranceSchema.parse({ carrier: "A", kind: "AUTO", vehicleIds: "v1,v2" })` → `vehicleIds` `["v1", "v2"]`, `propertyIds` `[]`.
    - `it("reads coverage lines and drops blank ones")`: `coverages: [{ label: "Dwelling", limit: "450000", deductible: "2500" }, { label: "", limit: "", deductible: "" }]` → parsed `coverages` `[{ label: "Dwelling", limit: 450000, deductible: 2500, sortOrder: 0 }]`. Omitted → `[]`.
    - `it("refuses a coverage line with an amount and no name")`: `[{ label: " ", limit: "1000" }]` → not success; `fieldErrors.coverages` contains `"Each coverage line needs a name."`.
    - `it("refuses a negative coverage limit")`: `[{ label: "Liability", limit: "-1" }]` → not success.
    - `it("reads a premium")`: `premiumSchema.parse({ effectiveDate: "2026-11-01", amount: "1680", period: "ANNUAL" })` → `{ effectiveDate: new Date("2026-11-01"), amount: 1680, period: "ANNUAL", notes: null }`. Period omitted → `"ANNUAL"`. Amount `""` → error `"Amount is required"`. `"-5"` → not success. No date → not success.
  - `features.test.ts`: move `"/insurance?open=1"` to the "leaves the rest alone" case (`false`) and add `isHealthPath("/insurance")` → `false`.
  - Run `npx vitest run lib/health-schemas.test.ts lib/features.test.ts`. Expected: FAIL.
- [ ] **Step 2: Implement schemas.** In `insuranceSchema` add `propertyIds` and `vehicleIds` (same transform as `memberIds`) and `coverages: z.array(z.object({ label: optionalText, limit: optionalMoney, deductible: optionalMoney })).optional().default([])`, then a `superRefine` that adds "Each coverage line needs a name." at path `["coverages"]` when a row has a limit or deductible but no label, then transform `coverages` with `coverageRows`. `premiumSchema`: `effectiveDate: requiredDate("Date is required")`, `amount: z.string().trim().min(1, "Amount is required").refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Enter 0 or more").transform(Number)`, `period: z.nativeEnum(PremiumPeriod).default("ANNUAL")`, `notes: optionalText`. Export `PolicyInput`. Remove `/insurance` from `HEALTH_PATHS`. Re-export `INSURANCE_KINDS` from `lib/health.ts` so its four importers keep working.
- [ ] **Step 3: Run** the same tests. Expected: PASS.
- [ ] **Step 4: `visibleNotificationsWhere`.** Add `prisma.insurancePolicy.findMany({ where: { kind: { in: [...HEALTH_INSURANCE_KINDS] } }, select: { id: true } })` to the `Promise.all` and include its ids in the excluded list.
- [ ] **Step 5: `lib/insurance-server.ts`.**
  - `loadInsurancePage(health)`: `prisma.insurancePolicy.findMany({ where: healthKindWhere(health), include: { members, properties, vehicles (each `{ select: { id: true, name: true }, orderBy: { name: "asc" } }`), premiums: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] }, coverages: { orderBy: { sortOrder: "asc" } }, attachments: { orderBy: { uploadedAt: "desc" } } }, orderBy: [{ kind: "asc" }, { carrier: "asc" }] })`. With Health off, map each policy's `members` to `[]` and return `people: []` (no names reach the browser). Properties and vehicles always load, `{ id, name }`, by name.
  - `loadAssetPolicies`: `where: { AND: [healthKindWhere(false), assetType === "PROPERTY" ? { properties: { some: { id } } } : { vehicles: { some: { id } } }] }`, select the fields in the signature, coverages by `sortOrder`, policies by carrier.
- [ ] **Step 6: Actions.** Drop `requireHealth`; read `loadFeatures()`.
  - create/update: `insuranceSchema.safeParse`. `linkWrites(kind, features.health, { memberIds, propertyIds, vehicleIds })`; `ok: false` → `{ error: { [field]: [error] } }`. For non-health kinds set `groupNumber`, `memberId`, `outOfPocketMax` to null.
  - create: `members` only when `w.members` is defined (`connect`), `properties`/`vehicles` `connect`, `coverages: { create: rows }`.
  - update: load `existing` (`id`, `kind`); missing, or `!health && isHealthInsuranceKind(existing.kind)` → `{ error: "Not found" }`. One `$transaction`: `insuranceCoverage.deleteMany({ where: { policyId: id } })`, `insurancePolicy.update` with `properties: { set }`, `vehicles: { set }`, `members: { set }` only when defined, then `insuranceCoverage.createMany`.
  - delete: same guard on the existing kind; then as today.
  - `addInsurancePremium`: load the policy's kind, same guard; `premiumSchema.safeParse`; create. `deleteInsurancePremium`: load with `policy: { select: { kind: true } }`, same guard; delete.
  - `revalidateInsurance()` also revalidates `"/assets/properties"` and `"/assets/vehicles"` with `"layout"`.
- [ ] **Step 7: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`. `tsc` errors in `components/insurance/insurance-list.tsx` (old action signature) are expected until Task 6; if any appear, note them and continue, but nothing else may fail.
- [ ] **Step 8: Commit** (only if asked): `git add lib/health-schemas.ts lib/health-schemas.test.ts lib/health.ts lib/features.ts lib/features.test.ts lib/features-server.ts lib/insurance-server.ts lib/actions/insurance.ts && git commit -m "Save policies with links, coverage and premiums, enforcing Health off on the server" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 5: Policy form dialog

**Files:**
- Create: `components/insurance/insurance-form-dialog.tsx` (pattern: `components/rooms/room-form-dialog.tsx`)

**Interfaces:**
- Consumes: `kindOptions`, `allowedLinks`, `isHealthInsuranceKind`, `coverageSuggestions` (Tasks 1–2); `createInsurancePolicy`, `updateInsurancePolicy`, `type PolicyInput` (Task 4); `type PolicyRow` (Task 6 defines it; write it in `insurance-list.tsx` now if Task 6 isn't done).
- Produces: `export function InsuranceFormDialog(props: { open: boolean; onClose: () => void; policy: PolicyRow | null; health: boolean; people: { id: string; name: string }[]; properties: { id: string; name: string }[]; vehicles: { id: string; name: string }[] })`.

- [ ] **Step 1: Read** `05-server-and-client-components.md` and `components/rooms/room-form-dialog.tsx` end to end.
- [ ] **Step 2: Form state.** Local zod schema of strings: carrier (required, "Carrier is required"), planName, kind, policyNumber, phone, startDate, endDate, deductible, groupNumber, memberId, outOfPocketMax, notes, `memberIds`/`propertyIds`/`vehicleIds` as `string[]`, `coverages` as `{ label, limit, deductible }[]` of strings. Reset on open from `policy` (new: kind `"HOME"`, everything else blank). `const kind = useWatch({ control: form.control, name: "kind" })`, then `allowedLinks(kind, health)` and `isHealthInsuranceKind(kind)`.
- [ ] **Step 3: Fields**, in this order: Carrier (placeholder "State Farm"), Plan ("Homeowners HO-3"), Type (Select over `kindOptions(health)`), Policy number, Phone (label "Member services phone" for health kinds, else "Phone"), start and end dates (labels "Coverage starts"/"Coverage ends" for health kinds, "Term starts"/"Renewal date" otherwise), `Deductible (${fmt.currencySymbol})`. Health kinds only: Member ID, Group number, `Out-of-pocket max (...)`. Then the pickers as checkbox lists, each shown only when allowed and non-empty: "Covers people" (`allowed.members && people.length`), "Covers properties" and "Covers vehicles" (`allowed.assets`). Then coverage lines, then Notes.
- [ ] **Step 4: Coverage lines.** `useFieldArray({ control, name: "coverages" })`. Each row: label `Input` with `list="coverage-label-suggestions"` (a `datalist` of `coverageSuggestions(kind)`), `Limit` and `Deductible` number inputs, then icon buttons Move up (`ArrowUp`, disabled on the first row), Move down (`ArrowDown`, disabled on the last), Remove (`X`), with aria-labels "Move up", "Move down", "Remove coverage". "Add coverage" appends a row labelled with the first suggestion not yet used (or blank). Empty list text: "No coverage lines yet."
- [ ] **Step 5: Submit.** Payload as `PolicyInput`: id arrays joined with `","`, and `""` for a picker that isn't shown. Call create or update. Field errors go to `form.setError` for fields the form has (`coverages` errors show under the coverage block); a string error toasts. Success toasts "Policy added." or "Policy updated." and closes. Copy whatever refresh the room dialog does after save.
- [ ] **Step 6: Checkpoint.** `npx eslint .` (8 warnings) and `npx tsc --noEmit` pass.
- [ ] **Step 7: Commit** (only if asked): `git add components/insurance/insurance-form-dialog.tsx && git commit -m "Add the policy form with coverage lines and covered assets" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 6: Insurance page, policy cards, premiums and sidebar

**Files:**
- Modify: `app/(app)/insurance/page.tsx`
- Modify: `components/insurance/insurance-list.tsx` (rewrite)
- Create: `components/insurance/policy-card.tsx`
- Modify: `components/sidebar.tsx` (:12–14 icons, :27–29 items)

**Interfaces:**
- Consumes: `groupPolicies`, `policyStatus`, `insuranceKindLabel`, `isHealthInsuranceKind`, `annualPremium`, `currentAndPrevious`, `premiumChange`, `premiumChangeLabel`, `PREMIUM_PERIODS` (Tasks 1–2); `loadInsurancePage`, `addInsurancePremium`, `deleteInsurancePremium`, `deleteInsurancePolicy` (Task 4); `InsuranceFormDialog` (Task 5); `assetHref` from `lib/assets`.
- Produces: `export type PolicyRow` in `insurance-list.tsx`; `InsuranceList` props `{ policies: PolicyRow[]; people; properties; vehicles; health: boolean; openId?: string }`; `PolicyCard` props `{ policy: PolicyRow; health: boolean; onEdit: () => void }`.

- [ ] **Step 1: Page.** Drop `requireHealth()`. `const { health } = await loadFeatures()`, then `loadInsurancePage(health)`, and pass `health` and `openId={open}` through.
- [ ] **Step 2: List.** Header "Insurance" with subtitle "Home, auto, umbrella and life policies, plus medical, dental and vision." (Health on) or "Home, auto, umbrella and life policies." (off), and the "Add Policy" button. Empty state: "No policies yet" / "Add a policy, then attach the declarations page or card photos on its card." Otherwise one `<section>` per `groupPolicies(policies, health)` entry with an `h2` of its title and the existing two-column card grid. Keep the `openId` effect-free pattern from today's file. Render one `InsuranceFormDialog`.
- [ ] **Step 3: Card** (`policy-card.tsx`, client). Header: carrier and plan, kind badge (`insuranceKindLabel`), status badge (`policyStatus(p, new Date())`), edit and delete buttons as today. Rows, each shown only when set:
  - "Covers": property and vehicle names as `Link`s to `assetHref(...)`, then people's names (Health on). Nothing linked: "Nothing linked yet" (non-health) or "Nobody yet" (health).
  - "Premium": `${fmt.money(annualPremium(current))}/yr`, followed in muted text by `premiumChangeLabel(premiumChange(current, previous))`.
  - Non-health: "Renews" with `fmt.date(endDate, { utc: true })`. Health: the existing "Coverage" range, Member ID, Group, Out-of-pocket max.
  - Policy, Phone, Deductible as today.
  - Coverage lines: a small three-column list (label, limit, deductible) with `fmt.moneyWhole`, blanks as "—".
  - Premiums: a "Premiums" heading with an outline `sm` "Add premium" button, then each premium newest first: date, `fmt.money(amount)` and period label, plus `(${fmt.money(annualPremium(p))}/yr)` when the period isn't ANNUAL, notes muted, and a ghost delete icon (aria-label `Delete premium from ${date}`, `confirm("Delete this premium?")`).
  - Files: `AttachmentList` as today (the loader already sorts newest first).
- [ ] **Step 4: Add premium.** An `EntityFormDialog` in the card with fields effectiveDate ("Starts", date, required), amount (`Amount (${fmt.currencySymbol})`, number, required), period ("Billed", select, required, `PREMIUM_PERIODS`), notes (text). Initial `{ effectiveDate: "", amount: "", period: "ANNUAL", notes: "" }`. Submit `addInsurancePremium(policy.id, values)`; success message "Premium added."
- [ ] **Step 5: Sidebar.** Move `{ href: "/insurance", label: "Insurance", icon: Umbrella }` to right after Equipment in the Home section. Import `Umbrella`; drop `ShieldPlus` from the import if nothing else in the file uses it.
- [ ] **Step 6: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`. `git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing.
- [ ] **Step 7: Manual verification list for the user** (the executor says it didn't run a browser):
  - Health off: Insurance shows in the sidebar under Home, after Equipment. The page opens and lists only non-health kinds; the Type list has no Medical, Dental, Vision or "Other (health)".
  - Add a HOME policy covering a property: Member ID, Group number and Out-of-pocket max aren't in the form; Covers properties and Covers vehicles are. Coverage suggestions offer Dwelling through Medical payments. Reorder and remove lines, save, and the card shows them in that order.
  - Switch the Type to Life: the property and vehicle pickers disappear; with Health on a people picker appears.
  - Add two premiums a year apart (1560 then 1740, yearly): the card reads "$1,740.00/yr +12% vs last term". A monthly premium shows its yearly figure in the history.
  - An end date within 30 days shows "Renews in Nd" in red; a medical policy keeps "Ends in Nd" at up to 60 days.
  - Health on: the Health group appears last with medical, dental and vision policies, each still showing Member ID and covered people.
- [ ] **Step 8: Commit** (only if asked): `git add "app/(app)/insurance/page.tsx" components/insurance components/sidebar.tsx && git commit -m "Show property, auto and life policies in their own Insurance section" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 7: Insurance on the property, vehicle and person pages

**Files:**
- Create: `components/insurance/asset-insurance.tsx` (async server component)
- Modify: `app/(app)/assets/properties/[id]/page.tsx` (first `Promise.all` :37, aside before `AssetCostPanel` :95)
- Modify: `app/(app)/assets/vehicles/[id]/page.tsx` (`Promise.all` :30, aside before `AssetCostPanel` :54)
- Modify: `app/(app)/assets/people/[id]/page.tsx` (Insurance block :103–119, imports :25)

**Interfaces:**
- Consumes: `loadAssetPolicies` (Task 4); `belongingsComparison`, `insuranceKindLabel` (Tasks 1–2); `equipmentValueTotals` (`lib/equipment-value.ts`); `getFormat` (`lib/regional-server`).
- Produces: `AssetInsurance({ policies, belongings }: { policies: { id: string; carrier: string; planName: string | null; kind: string; detail?: string | null }[]; belongings?: { belongings: number; coverage: number } | null })`.

- [ ] **Step 1: Component.** Returns null when `policies` is empty. Otherwise the people page's current block markup (`rounded-lg border bg-card p-3 text-sm`, `ShieldPlus` icon heading "Insurance"), each row a `Link` to `/insurance?open=${p.id}` with carrier and plan, and on the right `insuranceKindLabel(p.kind)` plus `` · ${detail}`` when set. When `belongings` is set, two muted lines under the list: `Belongings to replace: ${fmt.moneyWhole(belongings)}` and `Personal property coverage: ${fmt.moneyWhole(coverage)}`. No judgement text.
- [ ] **Step 2: Property page.** Add `loadAssetPolicies("PROPERTY", id)` to the first `Promise.all`. `const belongings = belongingsComparison(equipmentValueTotals(equipment).CONTENTS, policies)`. Render `<AssetInsurance policies={policies} belongings={belongings} />` before `AssetCostPanel`.
- [ ] **Step 3: Vehicle page.** Same with `loadAssetPolicies("VEHICLE", id)`, no `belongings`.
- [ ] **Step 4: Person page.** Replace the inline block with `<AssetInsurance policies={person.insurancePolicies.map((p) => ({ ...p, detail: p.memberId }))} />`. Remove imports this leaves unused (`INSURANCE_KINDS`; `labelFor` and `ShieldPlus` only if nothing else in the file uses them).
- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`.
- [ ] **Step 6: Manual verification list for the user:**
  - A property linked to a home policy shows an Insurance block above the Cost panel; the policy name opens `/insurance` with that policy's form open.
  - With belongings that have replacement cost or price paid, and a "Personal property" coverage line with a limit, the block shows both figures. Remove the limit and the two lines disappear.
  - A vehicle linked to an auto policy shows the block; an unlinked vehicle shows none.
  - A person (Health on) shows their policies as before; the links now open the policy's form.
- [ ] **Step 7: Commit** (only if asked): `git add components/insurance/asset-insurance.tsx "app/(app)/assets" && git commit -m "Asset pages list their policies and compare belongings with personal property coverage" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 8: Renewal notifications

**Files:**
- Modify: `lib/notifications/checker.ts` (policy query :97–99, loop :193–209)
- Modify: `components/notification-bell.tsx` (`typeIcon` :39), `app/(app)/notifications/page.tsx` (`typeIcon` :16, lucide import :13)

**Interfaces:**
- Consumes: `renewalNotice`, `HEALTH_INSURANCE_KINDS`, `POLICY_RENEWAL_DAYS` (Task 1); `cycleKeyOf` (`./repeat`).

- [ ] **Step 1: Checker.** The health-gated query adds `kind: { in: [...HEALTH_INSURANCE_KINDS] }`; its loop is unchanged. Add an ungated query to the same `Promise.all`: `prisma.insurancePolicy.findMany({ where: { kind: { notIn: [...HEALTH_INSURANCE_KINDS] }, endDate: { gte: startOfToday, lte: new Date(now.getTime() + POLICY_RENEWAL_DAYS * DAY) } } })`. For each, `renewalNotice(p, now)`; when set, push for every user `{ type: "POLICY_RENEWAL", title, message, relatedEntityId: p.id, relatedEntityType: "InsurancePolicy", cycleKey: cycleKeyOf(p.endDate), stage }`. Update the function's doc comment to mention policy renewals.
- [ ] **Step 2: Icons.** Add `POLICY_RENEWAL: Umbrella` to both `typeIcon` maps. `lib/notification-links.ts` already sends `InsurancePolicy` to `/insurance?open={id}`; confirm and leave it.
- [ ] **Step 3: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`. `git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing.
- [ ] **Step 4: Manual verification list for the user:** with Health off, a home policy whose renewal date is in 20 days raises "Renewal coming up: …" in the bell after the next check (or a restart), with an umbrella icon; clicking it opens the policy. A medical policy with Health on still raises "Insurance ending: …" and nothing else.
- [ ] **Step 5: Commit** (only if asked): `git add lib/notifications/checker.ts components/notification-bell.tsx "app/(app)/notifications/page.tsx" && git commit -m "Remind about non-health policy renewals 30 days ahead" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 9: Assistant, search and file routes with Health off

**Files:**
- Modify: `lib/llm/ontology.ts` (`ENTITY_KEYS` :18, `HEALTH_ENTITIES` :26, `EntityDef` :46, `insurancePolicy` :279, two new entities after it)
- Modify: `lib/llm/query.ts` (:283–288), `lib/llm/execute.ts` (`getRecord` :127), `lib/llm/tools/shortcuts.ts` (search :85, `health_alerts` :423)
- Modify: `lib/llm/prompt.ts` (:42)
- Modify: `lib/search/global-server.ts` (`HEALTH_KINDS` :225, `withFeatures` :231, insurance query :451, cards :568–583), `lib/search/entities/text.ts` (`insuranceDoc` :273), `lib/search/entities/sync-server.ts` (:48, :97)
- Modify: `app/api/files/[...path]/route.ts` (:22), `app/api/uploads/route.ts` (after the ROOM check :80)
- Test: `lib/llm/health-off.test.ts`, `lib/llm/ontology.test.ts`

**Interfaces:**
- Consumes: `HEALTH_INSURANCE_KINDS`, `isHealthInsuranceKind`, `insuranceKindLabel`, `renewalWindowDays` (Task 1).
- Produces: `EntityDef.healthOff?: Row` ("ANDed into every query of this entity while Health is off"); `export function healthOffWhere(entity: EntityKey, ctx?: Pick<ToolContext, "health">): Row[]` in `query.ts`; entities `insurancePremium` and `insuranceCoverage`.

- [ ] **Step 1: Write failing tests.**
  - `health-off.test.ts`, `it("reaches non-health insurance with Health off")`:
    - `entityDef("insurancePolicy", off).key` → `"insurancePolicy"`.
    - `JSON.stringify(compileWhere("insurancePolicy", [], off).where)` contains `'"kind":{"notIn":["MEDICAL","DENTAL","VISION","OTHER"]}'`; with `on` it doesn't contain `"notIn"`.
    - `JSON.stringify(compileWhere("insurancePremium", [], off).where)` contains `'"policy":{"kind":{"notIn"'`.
    - `compileWhere("insurancePolicy", [{ field: "members.name", op: "eq", value: "Anna" }], off)` and `compileInclude("insurancePolicy", ["members"], undefined, off)` throw `ToolInputError`.
    - `describeOntology(false)` matches `/^- insurancePolicy:/m`, contains `"properties→property[]"`, doesn't contain `"members→person[]"`.
  - `ontology.test.ts`, `it("links premiums and coverage lines to their policy")`: `ENTITIES.insurancePremium.keys` → `["policyId"]`, `fields.period.values` → `["MONTHLY", "SEMIANNUAL", "ANNUAL"]`, `fields.amount.description` matches `/yearly/`; `ENTITIES.insurancePolicy.relations.vehicles` → `{ kind: "many", entity: "vehicle" }`; `ENTITIES.insurancePolicy.href?.({ id: "i1" })` → `"/insurance"`.
  - Run `npx vitest run lib/llm`. Expected: FAIL.
- [ ] **Step 2: Ontology and query.**
  - Remove `insurancePolicy` from `HEALTH_ENTITIES`; add `"insurancePremium", "insuranceCoverage"` to `ENTITY_KEYS` after it.
  - `insurancePolicy`: description "Insurance policies: home, renters, auto, umbrella, life and other; with Health on also medical, dental and vision. What each covers, its coverage lines and premium history." Relations add `properties` (many property), `vehicles` (many vehicle), `premiums` (many insurancePremium), `coverages` (many insuranceCoverage). `healthOff: { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } }`. `href` stays `() => "/insurance"` (Decision 12).
  - `insurancePremium`: model `insurancePremium`, nameField `effectiveDate`, searchFields `["notes"]`, keys `["policyId"]`, fields `effectiveDate: date`, `amount: { type: "money", description: "Per billing period. Multiply MONTHLY by 12 and SEMIANNUAL by 2 for the yearly cost." }`, `period: enumOf(PremiumPeriod)`, `notes: s`; relation `policy` (one insurancePolicy); `healthOff: { policy: { kind: { notIn: [...] } } }`; defaultSort `effectiveDate desc`; href `() => "/insurance"`.
  - `insuranceCoverage`: nameField `label`, searchFields `["label"]`, keys `["policyId"]`, fields `label: s`, `limit: money`, `deductible: money`, `sortOrder: int`; same relation, `healthOff`, href; defaultSort `sortOrder asc`.
  - `query.ts`: add `healthOffWhere(entity, ctx)` returning `[]` with Health on, else the polymorphic `assetType` rule, the notification rule and `def.healthOff` when present. Use it in `compileWhere` (replacing the inline block), `getRecord` in `execute.ts`, and the search `where` in `shortcuts.ts` (replacing the inline polymorphic line).
  - `health_alerts`: add `kind: { in: [...HEALTH_INSURANCE_KINDS] }` to its policy query.
  - `prompt.ts` :42: change "(people, providers, insurance, health records)" to "(people, providers, health insurance, health records)".
- [ ] **Step 3: Run** `npx vitest run lib/llm`. Expected: PASS.
- [ ] **Step 4: Global search.** Remove `"INSURANCE"` from `HEALTH_KINDS`. In `withFeatures` replace `insurance: NOTHING` with `insurance: { AND: [w.insurance, { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } }] }`. Pass `features.health` into `searchRecords` (add a `health: boolean` parameter at both call sites). The insurance query also includes `properties` and `vehicles` names. On the cards: `people` only when `health` (and member names don't feed ranking text with Health off), a "Covers" fact with the asset names, and "Ending soon" via `insuranceExpiring(r, now, renewalWindowDays(r.kind))`.
- [ ] **Step 5: Search index text.** `InsuranceInput` gains `assets: string[]`. The summary starts with `` `${insuranceKindLabel(p.kind)} insurance policy from …` `` and adds `` `Covers ${list(p.assets)}` `` when there are any. `sync-server.ts` includes property and vehicle names and passes `assets`.
- [ ] **Step 6: File routes.** In the file route, when Health is off and `segments[0] === "insurance"`, load the policy's `kind` by `segments[1]`; a health kind → 404. In the upload route, when `recordType === "INSURANCE"` and Health is off, a health-kind policy → 404 "Record not found".
- [ ] **Step 7: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`.
- [ ] **Step 8: Manual verification list for the user:** with Health off, global search for a home policy's carrier finds it with "Covers Maple Street House" and no people; searching a medical carrier finds nothing. A medical card file's URL returns Not found. The assistant answers "when does my home insurance renew?" with Health off and says health insurance is turned off when asked about the medical plan.
- [ ] **Step 9: Commit** (only if asked): `git add lib/llm lib/search "app/api/files" app/api/uploads && git commit -m "Assistant, search and files see non-health policies with Health off" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 10: Readable export

**Files:**
- Modify: `lib/backup/readable.ts` (types :25–38, insurance block :215–234, `csvTables` :262–282), `lib/backup/viewer.ts` (json map :17–20)
- Modify: `lib/backup/import-rules.test.ts` (`helpers` :12), `Dockerfile` (after :72)
- Modify: `docs/export-format.md` (:59, table :67–84)
- Test: `lib/backup/readable.test.ts`

**Interfaces:**
- Consumes: `isHealthInsuranceKind`, `annualPremium`, `currentAndPrevious` (Tasks 1–2), imported relatively (`"../insurance"`).
- Produces:

```ts
export type PublicPremium = { id: string; policyId: string; effective: string | null; amount: number; period: string; annual: number; notes: string | null }
export type PublicCoverage = { id: string; policyId: string; label: string; limit: number | null; deductible: number | null }
export type PublicPolicy = { id: string; kind: string; carrier: string; plan: string | null; policyNumber: string | null; groupNumber: string | null; memberId: string | null; phone: string | null
  start: string | null; end: string | null; deductible: number | null; outOfPocketMax: number | null; notes: string | null
  personIds: string[]; propertyIds: string[]; vehicleIds: string[]; annualPremium: number | null; premiums: PublicPremium[]; coverages: PublicCoverage[]; files: FileRef[] }
// ReadableData gains `insurance: PublicPolicy[]`; PublicHealth.insurance becomes PublicPolicy[] (health kinds only).
```

- [ ] **Step 1: Write failing tests** in `readable.test.ts`, on `snap()` plus these rows: policies `i1` HOME "Acme Mutual", `i2` MEDICAL "Blue Cross", `i3` LIFE "Lifeco"; `_InsurancePolicyToProperty ('i1', 'p1')`, `_InsurancePolicyToVehicle ('i1', 'v1')`, `_InsurancePolicyToPerson ('i3', 'h1')`; premiums on `i1` dated 2023-11-01 (1500, ANNUAL) and 2024-11-01 (140, MONTHLY); coverage on `i1` "Personal property" 225000; attachment `ai1` INSURANCE on `i1`, filename `dec.pdf`.
  - `it("insurance: non-health policies export without health, with premiums, coverages and what they cover")`, `{ kind: "all", includeHealth: false }`:
    - `data.insurance.map((p) => p.carrier)` → `["Acme Mutual", "Lifeco"]`; `data.health` is null.
    - Acme: `propertyIds ["p1"]`, `vehicleIds ["v1"]`, `personIds []`, `annualPremium 1680`, `premiums.map((p) => p.annual)` → `[1680, 1500]` (newest first), `coverages` → `[{ id: expect.any(String), policyId: "i1", label: "Personal property", limit: 225000, deductible: null }]`, `files[0].name` `"dec.pdf"`.
    - Lifeco `personIds` `[]`. `files` (planned) contains `"insurance/i1/dec.pdf"`.
    - `csvTables(data)` has `insurance.csv`, `insurance-premiums.csv`, `insurance-coverages.csv`; the `insurance.csv` header starts `"﻿people,covers,carrier,plan,kind,"`, and Acme's row contains `Main House; Daily Driver`.
  - `it("insurance: health kinds stay under health")`, `includeHealth: true`: `data.health!.insurance.map((p) => p.carrier)` → `["Blue Cross"]`; Lifeco's `personIds` → `["h1"]`.
  - `it("insurance: one vehicle's export carries the policies that cover it")`, `{ kind: "asset", assetType: "VEHICLE", assetId: "v1" }` → `data.insurance` carriers `["Acme Mutual"]`.
  - Update `it("builds the csv set")` to include `"insurance-coverages.csv"` and `"insurance-premiums.csv"`.
  - Run `npx vitest run lib/backup/readable.test.ts`. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - Read `InsurancePolicy ORDER BY carrier`, `InsurancePremium`, `InsuranceCoverage ORDER BY sortOrder` and the three join tables with `all()` (missing tables in older snapshots give `[]`).
  - One `policyRow(r)` builder for both lists. `personIds` are kept people only (so `[]` without health); `annualPremium` from `currentAndPrevious(premiums, new Date()).current`; premiums newest first; files via `attachedTo("insurancePolicyId", r.id, firstAsset, "insurance")`, where `firstAsset` is the first linked kept property, vehicle or person.
  - `insurance` (top level): non-health kinds, kept when the scope is `all` or the policy links a kept property, vehicle or person. `health.insurance`: health kinds only, with today's member rule.
  - `csvTables`: `insurance.csv` always, over `[...d.insurance, ...(d.health?.insurance ?? [])]`, columns `people, covers, carrier, plan, kind, policyNumber, groupNumber, memberId, phone, start, end, deductible, annualPremium, notes, id` (`covers` = property and vehicle names joined with `"; "`). `insurance-premiums.csv`: `carrier, effective, amount, period, annual, notes, policyId, id`. `insurance-coverages.csv`: `carrier, label, limit, deductible, policyId, id`. Remove the old `insurance.csv` line from the health block.
  - `viewer.ts`: add `"insurance.json": data.insurance` to the json map.
  - Add `"lib/insurance.ts"` to `helpers`, and the `COPY` line to the `Dockerfile`.
  - `docs/export-format.md`: an `insurance.json` bullet (non-health policies, always exported; fields as `PublicPolicy`, with `premiums` and `coverages` and `annualPremium` as today's yearly cost); the `health.json` bullet says its `insurance` holds medical, dental and vision policies with the same fields; the table gains the three insurance rows above the health files, and "The last seven files" becomes "The last six files".
- [ ] **Step 3: Run** `npx vitest run lib/backup`. Expected: PASS.
- [ ] **Step 4: Commit** (only if asked): `git add lib/backup Dockerfile docs/export-format.md && git commit -m "Export non-health policies with premiums and coverage lines" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 11: Demo data, copy and testing checklist

**Files:**
- Modify: `prisma/seed-demo.ts` (in `main()` after the vehicle loop :683, before `seedPeople` :814)
- Modify: `components/settings/feature-settings.tsx` (:47), `README.md` (feature table :58–59), `DEMO-DATA.md` (table :84–88)
- Modify: `TESTING-CHECKLIST.md` (untracked, temporary; read it first)

- [ ] **Step 1: Seed.** Add `seedInsurance(properties, vehicles)`:
  - "State Farm" / "Homeowners HO-3", HOME, covering `properties[0]` (Maple Street House), policy number "HO-4471-208", `startDate at(-344)`, `endDate at(21)` (inside the 30-day window), deductible 2500. Coverage lines in order: Dwelling 450000, Other structures 45000, Personal property 225000, Loss of use 90000, Liability 300000, Medical payments 5000. Premiums `at(-709)` 1560 ANNUAL and `at(-344)` 1740 ANNUAL ("+12% vs last term").
  - "Progressive" / "Auto", AUTO, covering `vehicles[2]` (Work Truck), `startDate at(-40)`, `endDate at(142)`. Lines: Bodily injury 100000, Property damage 50000, Collision (no limit, deductible 1000), Comprehensive (no limit, deductible 500), Uninsured motorist 100000. Premiums `at(-222)` 672 SEMIANNUAL and `at(-40)` 708 SEMIANNUAL.
  - `wipe()` needs nothing new: deleting policies cascades premiums, coverage lines and links. Add the count of non-health policies to the closing summary line. Don't run the seed; `npx tsc --noEmit` covers it.
- [ ] **Step 2: Copy.** Feature settings: "People, providers and health insurance, with everyone's visits, reminders, warranties and health records." README: Home row adds ", plus home, auto and life insurance"; Health row reads "People, providers and health insurance, …". DEMO-DATA: add a row "**Insurance** | A home policy on Maple Street House renewing in 21 days and an auto policy on the Work Truck, each with coverage lines and two premiums".
- [ ] **Step 3: Testing checklist.** Change the intro's list to end "step 4 (manual page on a reminder) and step 5 (insurance)", and the Setup line to "four new database migrations (reminder cost and calendar, equipment value and lifespan, manual page on a reminder, insurance)". Add before `## Known gaps`:

```markdown
## 14. Insurance (step 5)

**With Health off** (Settings → Features)
- [ ] Insurance shows in the side menu under Home, after Equipment.
- [ ] The Insurance page opens. Medical, dental and vision policies don't appear, and the Type list doesn't offer them.
- [ ] A life policy that covers people shows no names. Edit and save it, then turn Health back on: it still covers the same people.

**Adding a policy**
- [ ] Add a home policy for one of your properties. The form doesn't ask for Member ID, Group number or Out-of-pocket max, and does offer your properties and vehicles.
- [ ] Add coverage lines. Typing in the name offers Dwelling, Personal property, Liability and the rest. Move a line up and down, remove one, save: the card shows them in your order.
- [ ] A line with an amount and no name is refused with "Each coverage line needs a name."
- [ ] Switch the type to Auto: the suggestions change to Bodily injury, Collision and so on. Switch to Life: the property and vehicle choices go away.

**Premiums**
- [ ] Add a premium of 1560 a year dated last year, then 1740 dated this year. The card shows "$1,740.00/yr" and "+12% vs last term".
- [ ] Add a monthly premium. The history shows its yearly figure beside it.
- [ ] Delete a premium. It's gone and the card's figure updates.
- [ ] Premiums don't show up on the Costs page.

**Renewal**
- [ ] Set a home policy's renewal date 20 days out. The card says "Renews in 20d" in red, and a "Renewal coming up" notification arrives after the next reminder check, with Health on or off. Clicking it opens the policy.
- [ ] A medical policy (Health on) still says "Ends in …" up to 60 days out and still raises its own "Insurance ending" notification.

**Property and vehicle pages**
- [ ] A property with a linked policy shows an Insurance box above the Cost panel. Its link opens that policy on the Insurance page.
- [ ] With belongings that have a replacement cost or price paid, and a "Personal property" coverage line with an amount, the box shows "Belongings to replace" and "Personal property coverage". Clear the coverage amount and both lines go away.
- [ ] A vehicle on an auto policy shows the same box. A person's page (Health on) still lists their policies, and the links open them.

**With the demo data**
- [ ] Maple Street House shows the State Farm policy, with belongings compared against $225,000 of personal property coverage.
- [ ] The Work Truck shows the Progressive policy. State Farm says "Renews in 21d".

**Export, search and assistant (optional)**
- [ ] A readable export has `insurance.csv`, `insurance-premiums.csv` and `insurance-coverages.csv`, even with health records left out.
- [ ] With Health off, searching for "State Farm" finds the policy; searching for your medical carrier finds nothing.
- [ ] With Health off, ask the assistant "when does my home insurance renew?" It answers with the date.
```

  Under "Known gaps", add that step 5 wasn't checked in a browser either.
- [ ] **Step 4: Final checkpoint.** Run `npx vitest run`, `npx eslint .` and `npx tsc --noEmit`, and quote the summary lines (eslint: 0 errors, 8 warnings). Confirm `git diff --stat -- "app/(app)/page.tsx" components/dashboard lib/costs-server.ts lib/backup/restore.ts` prints nothing. Run `git status` and list the files this step changed. Don't commit unless the user asked. Say that the manual-verification lists in Tasks 6–9 and checklist section 14 are open for the user and that nothing was checked in a browser.
- [ ] **Step 5: Commit** (only if asked): `git add prisma/seed-demo.ts components/settings/feature-settings.tsx README.md DEMO-DATA.md && git commit -m "Demo data and copy for property, auto and life insurance" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` (`TESTING-CHECKLIST.md` stays uncommitted; it's deleted before the PR).
