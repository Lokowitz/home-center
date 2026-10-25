# Property filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional dropdown in the top bar leaves everything that belongs to other properties out of every list, count, total, chart, detail page, report, picker, notification, search result and assistant answer. Vehicles and people can be linked to one property each, and the dropdown gives a quiet periodic cue while a property is selected. Off by default and free when off.

**Architecture:** A cookie (`hc-property`) holds the selected property per device. `loadPropertyScope()` (React `cache`, once per request) turns it into a `PropertyScope` holding the out-of-scope equipment, vehicle and person ids, and returns `null` without reading cookies while the feature is off. A pure module, `lib/property-filter.ts`, turns a scope into Prisma where fragments per model; vehicles and people share one linked-only rule. Entry points (pages, layout, actions, the chat route) read the scope; shared loaders and assistant tools receive it as an argument.

**Tech Stack:** Next.js 16.4.3 (app router, server actions, no Cache Components), Prisma 7 + SQLite, zod, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-property-filter-design.md`

## Order and size

17 tasks. Tasks 1–13 are the first slice worth testing end to end: every screen follows the filter. Search (Task 14) and the assistant (Task 15) close the last two leaks; ship to users only after Task 15, since the spec promises nothing from other properties appears anywhere. The cue (Task 16) depends only on Task 5 and can run any time after it. Task 17 is the final check and leak audit.

Honest size: roughly 2,600–3,300 changed lines including tests, about 60 files. Five to seven working days for one person; about two and a half days of agent execution with per-task review. Hardest: the dashboard (Task 12), costs (Task 11, a 582-line page fed by shared loaders), search (Task 14: three result paths plus the separate document index) and the assistant (Task 15: `compileWhere`, `getRecord`, seven shortcut tools and four document paths).

## Global Constraints

- **Start only after the uncommitted push-notification and backup-secrets work is committed.** It touches `prisma/schema.prisma`, `app/(app)/settings/page.tsx` and the latest migration `20261025022858_push_and_interval_settings`. The new migration must sort after it.
- The executor doesn't commit, push, `git add`, `stash` or `checkout` unless the user asks. Each task's commit step is a checkpoint; leave changes uncommitted until asked.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `07-mutating-data.md`, `08-caching.md`, `15-route-handlers.md` and `03-api-reference/04-functions/cookies.md` before writing layout, client component, action or route code.
- Read `prisma/schema.prisma` before data changes. Migrate with `npx prisma migrate dev --name property_filter`, then `npx prisma generate`; `tsc` fails without it.
- Feature off means: no dropdown, no `cookies()` read for the filter, no query beyond the FeatureSettings row `loadFeatures` already reads. Every changed entry point starts with `const scope = await loadPropertyScope()` and must behave exactly as today when it is `null`.
- Shared loaders and assistant tools take `scope` as an argument and never call `loadPropertyScope()` themselves.
- Out of scope means "belongs to a property other than P, or to a vehicle or person the linked-only rule hides" (spec, "The rule"). Unassigned equipment and unlinked policies always stay.
- Email digests and push are not changed (`lib/notifications/checker.ts`, `scheduler.ts`, `push*.ts` stay as they are).
- `lib/property-filter.ts` and `lib/property-filter-cue.ts` may only have `import type` lines.
- Vitest only picks up `lib/**/*.test.ts` and has no DOM. Server modules are tested with `vi.mock` as in `lib/actions/asset-policy-links.test.ts`.
- Field help: every `help="…"` id needs an entry in `lib/field-help/*.ts` and every entry must be used, in the same task (`lib/field-help/field-help.test.ts:75`). No em dashes in help copy.
- In react-hook-form use `useWatch`, never `form.watch`.
- Record the eslint warning count in Task 1. No task may add a warning.
- Never run `npm run db:seed:demo` (it wipes the dev DB).
- No browser tool. UI tasks end with a manual checklist and the executor says it did **not** check in a browser.
- A task is done when `npx vitest run`, `npx eslint .` and `npx tsc --noEmit` all pass.

## Review Focus

1. **Dropped links on save.** With Home selected, editing the umbrella policy (linked to Home and Rental) keeps the Rental link; editing a family health policy keeps a member hidden by the filter; editing a Home vehicle keeps its link to a Rental-only policy. Pinned in Task 3 (`keepHiddenLinks`) and Task 8 (`assetPolicyLinks` test).
2. **Linked-only boundaries, vehicles and people.** P has none linked: all show. P has one linked: unlinked ones and those linked elsewhere drop out, with their records, reminders, warranties, health records, notifications and documents. Pinned in Task 2 tests (both kinds, same function) and Task 13's notification test.
3. **Stale or foreign cookie.** The selected property is deleted, or the cookie names an id that never existed: every page shows everything, no error, the dropdown reads "All properties" and the cue doesn't run. Pinned in Task 4 (`loadPropertyScope` mocked test) and Task 16 (`cueActive`).
4. **Saving a form with the switch off** never clears a vehicle's or person's property link; choosing "Not assigned" with it on does. Pinned in Task 2 (`propertyLinkWrite`).
5. **Assistant leaks by name or id.** Under Home, "what's the Rental boiler's warranty?", a hidden person's medication history and `read_document` on a Rental manual id all come back empty or refused. Pinned in Task 15 tests.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (`model Property` :218, `model Vehicle` :284, `model Person` :338, `model FeatureSettings` :849)
- Create: `prisma/migrations/<timestamp>_property_filter/migration.sql` (generated)

- [ ] **Step 1:** Record the baseline: `npx eslint . 2>&1 | tail -3` and `npx vitest run 2>&1 | tail -5`. Note the warning count.
- [ ] **Step 2:** Add exactly the spec's "Schema" section: `FeatureSettings.propertyFilterEnabled Boolean @default(false)`; `propertyId String?` + `property Property? @relation(fields: [propertyId], references: [id], onDelete: SetNull)` + `@@index([propertyId])` on both `Vehicle` and `Person`, with the spec's doc comments; `Property.vehicles Vehicle[]` and `Property.people Person[]`.
- [ ] **Step 3:** `npx prisma migrate dev --name property_filter` then `npx prisma generate`. Expected: a folder sorting after `20261025022858_push_and_interval_settings`.
- [ ] **Step 4:** Read the generated SQL: the three rebuilt tables copy every existing column; `propertyFilterEnabled` defaults to `false`.
- [ ] **Step 5:** `npx tsc --noEmit` and `npx vitest run`. Expected: pass.
- [ ] **Step 6: Commit checkpoint** — `Add the property filter switch and vehicle and person property links to the schema.`

### Task 2: Pure scope rules, part 1

**Files:**
- Create: `lib/property-filter.ts`
- Test: `lib/property-filter.test.ts`

**Interfaces — Produces:**

```ts
import type { AssetType, Prisma } from "@/app/generated/prisma/client"
export type PropertyScope = {
  propertyId: string; propertyName: string
  hiddenEquipmentIds: string[]; hiddenVehicleIds: string[]; hiddenPersonIds: string[]
}
type Linked = { id: string; propertyId: string | null }
export const PROPERTY_FILTER_COOKIE = "hc-property"
export function readPropertyFilter(value: string | undefined): string | null
export function propertyFilterCookie(propertyId: string | null): string
export function linkedOnlyHidden(rows: Linked[], propertyId: string): string[]
export function buildScope(input: { property: { id: string; name: string }; equipment: Linked[]; vehicles: Linked[]; people: Linked[] }): PropertyScope
export function assetInScope(scope: PropertyScope | null, assetType: AssetType, assetId: string): boolean
export function ownedScopeWhere(scope: PropertyScope | null): { AND?: object[] }  // assignable to ServiceRecord/Warranty/MaintenanceSchedule where inputs, like ownedWhere in lib/features.ts
export function filteredEmptyText(scope: PropertyScope | null): string | null
export function propertyLinkWrite(value: string | undefined): { propertyId?: string | null }
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("readPropertyFilter / propertyFilterCookie", () => {
  it("reads an id and treats empty, missing or 'all' as all", () => {
    expect(readPropertyFilter("ckabc123")).toBe("ckabc123")
    expect(readPropertyFilter(undefined)).toBeNull()
    expect(readPropertyFilter("")).toBeNull()
    expect(readPropertyFilter("all")).toBeNull()
  })
  it("rejects values that can't be an id", () => {
    expect(readPropertyFilter("a b")).toBeNull()
    expect(readPropertyFilter("x".repeat(65))).toBeNull()
  })
  it("writes a year-long site-wide cookie, and clears it for all", () => {
    expect(propertyFilterCookie("p1")).toBe("hc-property=p1; path=/; max-age=31536000; samesite=lax")
    expect(propertyFilterCookie(null)).toBe("hc-property=; path=/; max-age=0; samesite=lax")
  })
})

// Fixtures: home H, rental R. Equipment: furnace F1 on H, boiler F2 on R, mower F3 unassigned.
// Vehicles: car V1 on H, truck V2 on R, trailer V3 unlinked.
// People (household of four): Ana on R, Ben, Cara, Dev unlinked.
describe("linkedOnlyHidden", () => {
  it("hides nothing when no row is linked to the property", () => {
    expect(linkedOnlyHidden(people, "H")).toEqual([])
  })
  it("hides unlinked rows and rows linked elsewhere once one is linked", () => {
    expect(linkedOnlyHidden(people, "R").sort()).toEqual(["Ben", "Cara", "Dev"])
    expect(linkedOnlyHidden(vehicles, "H").sort()).toEqual(["V2", "V3"])
  })
})

describe("buildScope", () => {
  it("hides equipment on other properties and keeps unassigned equipment", () => {
    expect(buildScope({ property: H, equipment, vehicles, people }).hiddenEquipmentIds).toEqual(["F2"])
  })
  it("applies the linked-only rule to vehicles and people separately", () => {
    const onH = buildScope({ property: H, equipment, vehicles, people })
    expect(onH.hiddenVehicleIds.sort()).toEqual(["V2", "V3"])
    expect(onH.hiddenPersonIds).toEqual([])
    const onR = buildScope({ property: R, equipment, vehicles, people })
    expect(onR.hiddenVehicleIds.sort()).toEqual(["V1", "V3"])
    expect(onR.hiddenPersonIds.sort()).toEqual(["Ben", "Cara", "Dev"])
  })
})

describe("assetInScope", () => {
  it("is true for everything without a scope", () => { expect(assetInScope(null, "PERSON", "Ben")).toBe(true) })
  it("on Rental keeps Rental, its and unassigned equipment, the truck and Ana", () => {
    const s = buildScope({ property: R, equipment, vehicles, people })
    expect(["PROPERTY:R", "EQUIPMENT:F2", "EQUIPMENT:F3", "VEHICLE:V2", "PERSON:Ana"].every((k) => assetInScope(s, ...split(k)))).toBe(true)
    expect(["PROPERTY:H", "EQUIPMENT:F1", "VEHICLE:V1", "VEHICLE:V3", "PERSON:Ben"].some((k) => assetInScope(s, ...split(k)))).toBe(false)
  })
  it("on Home keeps all four people (none linked to Home)", () => {
    const s = buildScope({ property: H, equipment, vehicles, people })
    expect(["Ana", "Ben", "Cara", "Dev"].every((p) => assetInScope(s, "PERSON", p))).toBe(true)
  })
})

describe("ownedScopeWhere", () => {
  it("adds nothing without a scope", () => { expect(ownedScopeWhere(null)).toEqual({}) })
  it("matches the spec's fragment", () => {
    expect(ownedScopeWhere(buildScope({ property: R, equipment, vehicles, people }))).toEqual({ AND: [
      { OR: [{ assetType: { not: "PROPERTY" } }, { assetId: "R" }] },
      { OR: [{ assetType: { not: "EQUIPMENT" } }, { assetId: { notIn: ["F1"] } }] },
      { OR: [{ assetType: { not: "VEHICLE" } }, { assetId: { notIn: ["V1", "V3"] } }] },
      { OR: [{ assetType: { not: "PERSON" } }, { assetId: { notIn: ["Ben", "Cara", "Dev"] } }] },
    ] })
  })
  it("drops the person clause when no person is hidden", () => { /* scope on H: three clauses */ })
  it("agrees with assetInScope on every fixture row", () => {
    // A small matcher in the test file evaluates AND / OR / not / notIn / equals over {assetType, assetId}
    // rows built from every fixture, on both H and R, and compares with assetInScope row by row.
  })
})

describe("filteredEmptyText", () => {
  it("names the property", () => {
    expect(filteredEmptyText(scopeOnH)).toBe("Nothing here for Home. Switch to All properties to see everything.")
    expect(filteredEmptyText(null)).toBeNull()
  })
})

describe("propertyLinkWrite", () => {
  it("leaves the link alone when the field wasn't sent", () => { expect(propertyLinkWrite(undefined)).toEqual({}) })
  it("clears it for Not assigned and sets it for an id", () => {
    expect(propertyLinkWrite("")).toEqual({ propertyId: null })
    expect(propertyLinkWrite("p1")).toEqual({ propertyId: "p1" })
  })
})
```

- [ ] **Step 2:** `npx vitest run lib/property-filter.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. `readPropertyFilter` accepts `/^[A-Za-z0-9_-]{1,64}$/` except `"all"`. `buildScope` hides equipment whose `propertyId` is set and not P, and calls `linkedOnlyHidden` for vehicles and for people.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit checkpoint** — `Property filter scope rules, with one linked-only rule for vehicles and people.`

### Task 3: Pure scope rules, part 2: other models, notifications, link merging

**Files:**
- Modify: `lib/property-filter.ts`, `lib/property-filter.test.ts`

**Interfaces — Produces:**

```ts
export function propertyScopeWhere(scope: PropertyScope | null): Prisma.PropertyWhereInput        // { id: P }
export function equipmentScopeWhere(scope: PropertyScope | null): Prisma.EquipmentWhereInput      // { id: { notIn: hiddenEquipmentIds } } or {}
export function vehicleScopeWhere(scope: PropertyScope | null): Prisma.VehicleWhereInput          // { id: { notIn: hiddenVehicleIds } } or {}
export function personScopeWhere(scope: PropertyScope | null): Prisma.PersonWhereInput            // { id: { notIn: hiddenPersonIds } } or {}
export function personChildScopeWhere(scope: PropertyScope | null): { personId?: { notIn: string[] } }  // health records
export function roomScopeWhere(scope: PropertyScope | null): Prisma.RoomWhereInput                // { propertyId: P }
export function policyScopeWhere(scope: PropertyScope | null): Prisma.InsurancePolicyWhereInput
export function attachmentOutOfScopeWhere(scope: PropertyScope): Prisma.AttachmentWhereInput
export function notificationScopeWhere(hiddenEntityIds: string[]): Prisma.NotificationWhereInput
export function keepHiddenLinks(currentIds: string[], chosenIds: string[], visibleIds: string[]): string[]
```

- `policyScopeWhere`: `{ OR: [ { properties: { none: {} }, vehicles: { none: {} }, members: { none: {} } }, { properties: { some: { id: P } } }, { vehicles: { some: { id: { notIn: hiddenVehicleIds } } } }, { members: { some: { id: { notIn: hiddenPersonIds } } } } ] }`.
- `attachmentOutOfScopeWhere`, with `owned = ownedScopeWhere(scope)` and `hiddenPeople = { personId: { in: hiddenPersonIds } }`: `OR` of `{ recordType: "DOCUMENT", NOT: owned }`, `{ serviceRecord: { is: { NOT: owned } } }`, `{ warranty: { is: { NOT: owned } } }`, `{ maintenanceSchedule: { is: { NOT: owned } } }`, `{ room: { is: { propertyId: { not: P } } } }`, `{ insurancePolicy: { is: { NOT: policyScopeWhere(scope) } } }`, and, only when `hiddenPersonIds` is non-empty, `{ healthCondition: { is: hiddenPeople } }`, `{ medication: … }`, `{ allergy: … }`, `{ immunization: … }`, `{ observation: … }`.
- `notificationScopeWhere([])` → `{}`; otherwise `{ OR: [{ relatedEntityId: null }, { relatedEntityId: { notIn: ids } }] }` (`notIn` alone drops SQL NULL, as `visibleNotificationsWhere` notes).
- `keepHiddenLinks`: chosen ids plus every current id the user couldn't see, de-duplicated.

- [ ] **Step 1: Failing tests.** Task 2 fixtures plus policies `homeOwners` ([H]), `rentalOwners` ([R]), `truckAuto` (vehicles [V2]), `familyHealth` (members [Ana, Ben]), `bensLife` (members [Ben]), `umbrella` ([H, R]), `unlinked` (nothing).
  - Every fragment with `null` → `{}`; `personChildScopeWhere(scopeOnH)` → `{}`; `personChildScopeWhere(scopeOnR)` → `{ personId: { notIn: ["Ben", "Cara", "Dev"] } }`.
  - A test-file matcher over the seven policies: on R keeps rentalOwners, truckAuto, familyHealth (Ana shows), umbrella, unlinked and drops homeOwners, bensLife; on H keeps homeOwners, familyHealth, bensLife, umbrella, unlinked and drops rentalOwners, truckAuto.
  - `attachmentOutOfScopeWhere(scopeOnH)` has six `OR` branches (no person hidden); `attachmentOutOfScopeWhere(scopeOnR)` has eleven; its room branch is `{ room: { is: { propertyId: { not: "R" } } } }`.
  - `notificationScopeWhere(["s1"])` → `{ OR: [{ relatedEntityId: null }, { relatedEntityId: { notIn: ["s1"] } }] }`.
  - `keepHiddenLinks(["H", "R"], ["H"], ["H"])` → `["H", "R"]`; `keepHiddenLinks(["H", "R"], [], ["H"])` → `["R"]`; `keepHiddenLinks(["H"], ["H", "X"], ["H", "X"])` → `["H", "X"]`.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit checkpoint** — `Property filter fragments for every property-linked model.`

### Task 4: Loaders and the Features switch

**Files:**
- Modify: `lib/features-server.ts` (:11-18)
- Create: `lib/property-filter-server.ts`, test `lib/property-filter-server.test.ts`
- Modify: `lib/actions/feature-settings.ts`, `components/settings/feature-settings.tsx` (new card after "Equipment tab"), `app/(app)/settings/page.tsx:187`, `lib/field-help/system.ts`

**Interfaces — Produces:**

```ts
// lib/features-server.ts
export const loadPropertyFilterEnabled: () => Promise<boolean>     // cache(); same cached row as loadFeatures
// lib/property-filter-server.ts
export const loadPropertyScope: () => Promise<PropertyScope | null>                       // cache()
export const loadHiddenEntityIds: (scope: PropertyScope | null) => Promise<string[]>      // cache(); [] for null
export async function loadPropertyFilterChoices(scope: PropertyScope | null): Promise<{ id: string; name: string }[] | null>  // null when off; P only under a scope
```

- [ ] **Step 1: Failing tests** (`vi.mock` of `@/lib/prisma`, `next/headers` and `@/lib/features-server`):
  - switch off → `null`, the mocked `cookies` was **not** called, no prisma method was called;
  - switch on, no cookie → `null`, no prisma call;
  - switch on, cookie `"R"`, property found → equals `buildScope` over the mocked equipment, vehicles and people;
  - switch on, cookie for a deleted property (`findUnique` → null) → `null`;
  - `loadHiddenEntityIds(null)` → `[]` with no query; with a scope, the union of ids from `maintenanceSchedule.findMany` and `warranty.findMany` with `{ NOT: ownedScopeWhere(scope) }`, `insurancePolicy.findMany` with `{ NOT: policyScopeWhere(scope) }`, and `medication.findMany` / `immunization.findMany` with `{ personId: { in: hiddenPersonIds } }` (skipped when that list is empty).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** In `features-server.ts` move the `findUnique` into a private `featureRow = cache(...)` read by `loadFeatures` and `loadPropertyFilterEnabled` (default `false`). `Features` stays unchanged. `loadPropertyScope` runs property `findUnique({ select: { id, name } })`, `equipment.findMany({ where: { propertyId: { not: null } }, select: { id, propertyId } })`, `vehicle.findMany` and `person.findMany` (both `select: { id, propertyId }`) in one `Promise.all`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Action schema gains `propertyFilterEnabled: z.boolean()`; keep `revalidatePath("/", "layout")`. Card markup as Rooms: title "Property filter" with On/Off badge; description "A dropdown in the top bar that narrows the site to one property."; checkbox "Show a property filter in the top bar", `help="features.property-filter"`; note exactly as the spec's "Settings and copy". Toast name `"Property filter"`. Settings page passes `loadPropertyFilterEnabled()`.
- [ ] **Step 6:** Help entry `"features.property-filter"`: title "Show a property filter in the top bar"; what "Adds a dropdown next to search for picking one property. Each device remembers its own choice."; use "Everything that belongs to your other properties is then left out: lists, totals, search, notifications and the assistant. Emails and push still cover everything. Nothing is deleted."
- [ ] **Step 7:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 8: Manual checklist:** switch on/off shows the right toast and badge.
- [ ] **Step 9: Commit checkpoint** — `Settings → Features can turn on a property filter.`

### Task 5: Dropdown, hidden-asset panel, and maintenance, warranties, records

**Files:**
- Create: `components/property-filter.tsx` (client), `components/hidden-by-filter.tsx` (client)
- Modify: `app/(app)/layout.tsx` (first `Promise.all` at :33; render before `GlobalSearch` at :73-77)
- Modify: `app/(app)/maintenance/page.tsx:62-78`, `app/(app)/warranties/page.tsx:72-87`, `app/(app)/records/page.tsx:53-103`

**Interfaces — Produces:** `PropertyFilter({ properties: { id: string; name: string }[]; selectedId: string | null })`; `HiddenByFilter({ propertyName: string; ownerName?: string })` (used in Task 10).

- [ ] **Step 1:** `PropertyFilter`: `Select` from `components/ui/select`, "All properties" (value `__all__`) then each property. On change: `document.cookie = propertyFilterCookie(id)` and `router.refresh()` in `startTransition`. Trigger `aria-label="Property filter"`, `relative`, `max-w-40 truncate`; below `sm` a lucide `Building2` icon only. Task 16 adds the cue inside this trigger.
- [ ] **Step 2:** `HiddenByFilter`: a card reading "Hidden by the property filter. This belongs to {ownerName ?? 'another property'}, and {propertyName} is selected." with a "Show all properties" button that clears the cookie and refreshes.
- [ ] **Step 3:** Layout loads choices with `loadPropertyFilterChoices(null)` (the dropdown lists every property) and renders the dropdown only when `choices && choices.length >= 2`, with `selectedId={scope?.propertyId ?? null}`.
- [ ] **Step 4:** Each of the three pages ANDs `ownedScopeWhere(scope)` into its `where` for the list, the paging count, the headline counts, records' `_sum` and warranties' expiring count. When a filtered list is empty, show `filteredEmptyText(scope)`.
- [ ] **Step 5:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
- [ ] **Step 6: Manual checklist:** switch off: no dropdown, row counts unchanged. On with one property: no dropdown. On with two: pick Rental, only Rental and shared items on the three pages, the empty state names Rental; pick All, everything returns. Delete the selected property: everything shows, dropdown reads All properties.
- [ ] **Step 7: Commit checkpoint** — `A property dropdown in the top bar narrows reminders, warranties and records.`

### Task 6: Link a vehicle to a property

**Files:**
- Modify: `lib/vehicle-input.ts` (:4-35), test `lib/vehicle-input.test.ts`
- Modify: `lib/actions/vehicles.ts` (`createVehicle` :11, `updateVehicle` :24)
- Modify: `components/vehicles/vehicle-form-dialog.tsx`, `components/vehicles/vehicle-edit-button.tsx`, `components/vehicles/vehicle-list.tsx`
- Modify: `app/(app)/assets/vehicles/page.tsx`, `app/(app)/assets/vehicles/[id]/page.tsx:39`
- Modify: `lib/field-help/assets.ts` (after `vehicle.insurance`)

**Interfaces — Consumes:** `propertyLinkWrite`, `loadPropertyFilterChoices(scope)`. **Produces:** `vehicleSchema` gains `propertyId: z.string().optional()`; `vehicleData` spreads `propertyLinkWrite(v.propertyId)`. Dialog prop `propertyChoices?: { id: string; name: string }[]` (absent = field hidden).

- [ ] **Step 1: Failing tests:** `"propertyId" in vehicleData(parse(valid))` is `false`; `propertyId: ""` → `null`; `propertyId: "p1"` → `"p1"`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Actions: a non-empty `propertyId` with no such property returns `{ error: { propertyId: ["Pick a property from the list."] } }`.
- [ ] **Step 6:** Dialog: "Property" select modelled on `components/equipment/equipment-form-dialog.tsx:162-175` ("Not assigned" plus choices), `help="vehicle.property"`, only when `propertyChoices` is passed; submit sends `propertyId` only then. Pages pass `await loadPropertyFilterChoices(scope) ?? undefined`.
- [ ] **Step 7:** Help entry `"vehicle.property"`: title "Property"; what "The property this vehicle belongs to."; use "With the property filter on, a property with any vehicles linked shows only those. A property with none linked shows every vehicle."
- [ ] **Step 8:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 9: Manual checklist:** switch off, field hidden, saving keeps an existing link. Switch on, link V1 to Home: under Home, the truck and trailer and their reminders leave Maintenance.
- [ ] **Step 10: Commit checkpoint** — `Vehicles can be linked to a property.`

### Task 7: Link a person to a property

**Files:**
- Modify: `lib/health-schemas.ts` (`personSchema` :49), test `lib/health-schemas.test.ts`
- Modify: `lib/actions/people.ts` (`createPerson` :13, `updatePerson` :26)
- Modify: `components/people/person-fields.ts` (`personFields`, `personInitial`), `components/people/person-edit-button.tsx`, `components/people/people-list.tsx` (its add form)
- Modify: `app/(app)/assets/people/page.tsx`, `app/(app)/assets/people/[id]/page.tsx`
- Modify: `lib/field-help/health.ts` (beside the other `person.*` ids)

**Interfaces — Consumes:** `propertyLinkWrite`, `loadPropertyFilterChoices(scope)`. **Produces:** `personSchema` gains `propertyId: z.string().optional()`; `personFields(providers, policies = [], properties?: { id: string; name: string }[])` adds a `select` field `propertyId` labelled "Property" with `help: "person.property"` only when `properties` is passed; `personInitial(person, policyIds, withProperty = false)` sets `propertyId: person?.propertyId ?? ""` only when `withProperty`.

- [ ] **Step 1: Failing tests** in `health-schemas.test.ts`: `personSchema.parse(validPerson).propertyId` is `undefined`; `"p1"` parses to `"p1"`; `""` parses to `""` (the action turns it into `null` through `propertyLinkWrite`).
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement; actions spread `propertyLinkWrite(parsed.data.propertyId)` and reject an unknown id with `"Pick a property from the list."`. **Step 4:** Run; PASS.
- [ ] **Step 5:** Pages pass `await loadPropertyFilterChoices(scope) ?? undefined` to the form.
- [ ] **Step 6:** Help entry `"person.property"`: title "Property"; what "The property this person lives at or belongs to."; use "With the property filter on, a property with anyone linked shows only those people and their records. A property with no one linked shows everyone."
- [ ] **Step 7:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 8: Manual checklist:** switch off, field hidden, saving keeps the link. Switch on, link Ana to Rental: under Rental, Ben, Cara and Dev's checkups leave Maintenance and Records; under Home all four show.
- [ ] **Step 9: Commit checkpoint** — `People can be linked to a property.`

### Task 8: Asset lists, providers, insurance page, and keeping hidden links

**Files:**
- Modify: `app/(app)/assets/properties/page.tsx:8`, `app/(app)/assets/vehicles/page.tsx:8`, `app/(app)/assets/equipment/page.tsx:9`, `app/(app)/assets/people/page.tsx:15`, `app/(app)/providers/page.tsx:9-15`
- Modify: `lib/insurance-server.ts` (`loadInsurancePage` :25, `loadPolicyChoices` :75, `assetPolicyLinks` :86), `app/(app)/insurance/page.tsx`
- Modify: `lib/actions/insurance.ts` (:46-47, :78-80), `lib/actions/vehicles.ts`, `lib/actions/properties.ts`, `lib/actions/people.ts` (callers of `assetPolicyLinks`)
- Test: `lib/actions/asset-policy-links.test.ts`

**Interfaces — Produces:** `loadInsurancePage(health, scope = null)`, `loadPolicyChoices(side, health, scope = null)`, `assetPolicyLinks(side, assetId, chosen, health, scope = null)`; the person, property and vehicle name lists in `loadInsurancePage` (:45-47) scoped with the matching fragments.

- [ ] **Step 1: Failing test** in `asset-policy-links.test.ts`: with a scope, `assetPolicyLinks` passes `policyScopeWhere(scope)` into the `findMany` `where`, so a linked out-of-scope policy is never in `disconnect`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement; actions load `scope` and pass it. **Step 4:** Run; PASS.
- [ ] **Step 5:** Insurance update (:78-80): `members`, `properties` and `vehicles` `set` lists become `keepHiddenLinks(currentIds, chosen, visibleIds)`, with current ids read in the action and visible ids from the scoped name lists.
- [ ] **Step 6:** Asset list queries add `propertyScopeWhere` / `vehicleScopeWhere` / `equipmentScopeWhere` / `personScopeWhere`; providers' `serviceRecord.groupBy` adds `ownedScopeWhere(scope)`; empty lists show `filteredEmptyText(scope)`.
- [ ] **Step 7:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 8: Manual checklist:** Rental selected with Ana linked: People shows Ana; Insurance shows Rental's policy, the family health policy and the umbrella, not Home's or Ben's life policy. Edit the family health policy, save, switch to All: Ben is still a member.
- [ ] **Step 9: Commit checkpoint** — `Asset lists, providers and insurance follow the property filter without dropping hidden links.`

### Task 9: Pickers

**Files:**
- Modify: `lib/assets-server.ts` (`loadAssetIndex` :8; only `options` is scoped, names stay complete)
- Modify: `lib/rooms-server.ts` (`propertiesWithRooms` :46), `app/(app)/intake/page.tsx:14-31`, `lib/inbox-server.ts` (:55-64), `app/(app)/records/page.tsx:83-103`, and every page passing `propertiesWithRooms()` or `loadAssetIndex().options` to a form (`grep -rn "propertiesWithRooms\|\.options" app components`)

**Interfaces — Produces:** `loadAssetIndex(scope: PropertyScope | null = null)`; `propertiesWithRooms(scope: PropertyScope | null = null)`.

- [ ] **Step 1:** Scope `options` with `assetInScope`; scope `propertiesWithRooms` with `propertyScopeWhere`. Intake pickers use the scoped lists; an inbox suggestion whose asset is out of scope resolves to no suggestion. Health record forms' person pickers (if any list people) use `personScopeWhere`.
- [ ] **Step 2:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
- [ ] **Step 3: Manual checklist:** Rental selected: the records "Add" asset select, the records asset filter, the equipment property select and the Intake "file to" select offer no Home items and no hidden people.
- [ ] **Step 4: Commit checkpoint** — `Pickers offer only the selected property's items.`

### Task 10: Detail pages and reports

**Files:**
- Modify: `app/(app)/assets/properties/[id]/page.tsx`, `app/(app)/assets/vehicles/[id]/page.tsx`, `app/(app)/assets/equipment/[id]/page.tsx`, `app/(app)/assets/people/[id]/page.tsx`, `app/reports/[type]/[id]/page.tsx`

- [ ] **Step 1:** After loading the asset, `if (!assetInScope(scope, TYPE, id)) return <HiddenByFilter propertyName={scope!.propertyName} ownerName={…} />` (owner: the property's own name, or the linked property's name for equipment, vehicles and people; none for unlinked ones hidden by the linked-only rule).
- [ ] **Step 2:** On in-scope detail pages, pass `scope` to the edit dialogs' choice loaders (`loadPolicyChoices`, `propertiesWithRooms`, `loadPropertyFilterChoices`) so pickers match Task 9.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
- [ ] **Step 4: Manual checklist:** Home selected, open a Rental URL from history: the panel shows and "Show all properties" opens the page. Same for a hidden person and a Rental report.
- [ ] **Step 5: Commit checkpoint** — `Detail pages and reports of hidden items say they're hidden.`

### Task 11: Costs

**Files:**
- Modify: `lib/costs-server.ts` (`loadCostRecords` :14, `loadPlannedSchedules` :49), `app/(app)/costs/page.tsx:65-74` and its in-memory groupings

**Interfaces — Produces:** both loaders take `filter?: { …existing…; scope?: PropertyScope | null }`; the scope applies only when no `assetId` / `assets` filter is given.

- [ ] **Step 1:** Add `...ownedScopeWhere(filter?.scope ?? null)` to both `where` clauses under that rule. `components/costs/asset-cost-panel.tsx` is unchanged (detail pages are guarded in Task 10).
- [ ] **Step 2:** The page passes `{ scope }` at :66, :69 and :74, and drops out-of-scope rows built from `assets` with `assetInScope`.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
- [ ] **Step 4: Manual checklist:** Rental selected with Ana linked: year-to-date equals the sum of Rental's, its and unassigned equipment's, the truck's and Ana's costed records; Costs → People lists only Ana; All restores the old totals exactly.
- [ ] **Step 5: Commit checkpoint** — `Costs follow the property filter.`

### Task 12: Dashboard

**Files:**
- Modify: `app/(app)/page.tsx` (:38-77 and the lists derived after it)

- [ ] **Step 1:** Counts (:49-57) use `propertyScopeWhere`, `vehicleScopeWhere`, `equipmentScopeWhere`, `personScopeWhere` and `ownedScopeWhere`. `personTotal` and `recordTotal` (:55-56, the "is the household empty" checks) stay unfiltered.
- [ ] **Step 2:** Due reminders (:60-63) and expiring warranties (:65-69) AND `ownedScopeWhere(scope)`; thumbnails (:70-73) use the per-model fragments; `loadCostRecords({ scope })`; activity-index entries pass through `assetInScope`.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
- [ ] **Step 4: Manual checklist:** Rental selected: Properties card says 1, Vehicles and People count only those shown, the due list and spend chart hold no Home items; the fresh-start card doesn't appear.
- [ ] **Step 5: Commit checkpoint** — `The dashboard follows the property filter.`

### Task 13: Notifications page and bell

**Files:**
- Modify: `app/(app)/layout.tsx:36-45`, `app/(app)/notifications/page.tsx:35-47`, `lib/actions/notifications.ts` (`markAllNotificationsRead` :19)
- Test: `lib/actions/notifications.test.ts` (new, mocked)

- [ ] **Step 1: Failing test:** with `loadPropertyScope` mocked to a scope and `loadHiddenEntityIds` to `["s9", "med3"]`, `markAllNotificationsRead` calls `updateMany` with a `where` containing `notificationScopeWhere(["s9", "med3"])`; with `null`, the `where` is today's.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Layout and notifications page AND `notificationScopeWhere(await loadHiddenEntityIds(scope))` with `visibleNotificationsWhere(features)` in their `findMany` and `count` calls.
- [ ] **Step 6:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 7: Manual checklist:** Rental selected with Ana linked: no Home reminder and no refill reminder for Ben in the bell or on the page; the unread badge counts only visible ones; "mark all read" then All leaves Home's unread. A digest email still lists everything.
- [ ] **Step 8: Commit checkpoint** — `Notifications follow the property filter; emails and push don't.`

### Task 14: Global search

**Files:**
- Modify: `lib/search/global-server.ts` (`globalSearch` :709-760, `semanticRecords`, new `withPropertyScope` beside `withFeatures` :246)
- Modify: `lib/documents/scope.ts` (beside `healthAttachmentIds` :30)

**Interfaces — Produces:** `outOfScopeAttachmentIds(scope: PropertyScope | null): Promise<string[]>` (`[]` for null; else ids matching `attachmentOutOfScopeWhere`).

- [ ] **Step 1:** `withPropertyScope(all, scope)` ANDs: property `propertyScopeWhere`, vehicle `vehicleScopeWhere`, equipment `equipmentScopeWhere`, person `personScopeWhere`, condition/medication/allergy/immunization/observation `personChildScopeWhere`, service/maintenance/warranty `ownedScopeWhere`, insurance `policyScopeWhere`, room `roomScopeWhere`; provider untouched. Apply after `withFeatures` at :732 and in `semanticRecords` (:300).
- [ ] **Step 2:** `hidden` (:718) becomes the union of `healthAttachmentIds()` (Health off) and `outOfScopeAttachmentIds(scope)`; build it whenever either applies.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
- [ ] **Step 4: Manual checklist** (Rental selected, Ana linked): Home's furnace, its warranty vendor, a word inside its manual, a Home room's paint colour, Home's policy number and Ben's medication each find nothing; under All they're found. A semantic query about the furnace doesn't surface it.
- [ ] **Step 5: Commit checkpoint** — `Search follows the property filter.`

### Task 15: Assistant

**Files:**
- Create: `lib/llm/property-scope.ts`, test `lib/llm/property-scope.test.ts`
- Modify: `lib/llm/query.ts` (`ToolContext` :26, `compileWhere` :296-298), test `lib/llm/query.test.ts`
- Modify: `lib/llm/execute.ts` (:123-129), `lib/llm/tools/shortcuts.ts` (:66, :81-86, :162-182, :210-230, :275-284, :322, :364, and the `medication_history` tool), `lib/llm/tools/documents.ts` (:106-173), `lib/documents/scope.ts` (`scopeWhere` :37, `listDocumentRefs`, `countNotIndexed`)
- Modify: `lib/llm/prompt.ts` (:38), test `lib/llm/prompt.test.ts`
- Modify: `app/api/chat/route.ts` (:43-49)

**Interfaces — Produces:**

```ts
// lib/llm/query.ts
export type ToolContext = { …existing…; scope?: PropertyScope | null; hiddenEntityIds?: string[] }
// lib/llm/property-scope.ts
export function entityScopeWhere(entity: EntityKey, ctx: Pick<ToolContext, "scope" | "hiddenEntityIds">): Row
```

Mapping: property, vehicle, equipment, person, room → their fragment; healthCondition, medication, allergy, immunization, observation → `personChildScopeWhere`; serviceRecord, warranty, maintenanceSchedule → `ownedScopeWhere`; insurancePolicy → `policyScopeWhere`; insurancePremium, insuranceCoverage → `{ policy: { is: policyScopeWhere } }`; roomPaint → `{ room: { is: roomScopeWhere } }`; notification → `notificationScopeWhere(hiddenEntityIds ?? [])`; provider → `{}`.

- [ ] **Step 1: Failing tests:**
  - `entityScopeWhere` returns `{}` for every `ENTITY_KEYS` entry with no scope, and the mapping above per key with `scopeOnR`.
  - `compileWhere("warranty", [], { ...ctx, scope: scopeOnR })` contains `ownedScopeWhere(scopeOnR)` in its `AND`; `compileWhere("medication", [], …)` contains `personChildScopeWhere(scopeOnR)`; without `scope` both equal today's output (existing tests stay green).
  - `buildSystemPrompt({ now, viewing: "Lake Cabin" })` contains `"The user is viewing Lake Cabin. Items from other properties are hidden from you; if asked about them, say the property filter is hiding them."`; without `viewing` it doesn't contain "viewing".
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement `entityScopeWhere`, add it to `compileWhere`'s `and` after `healthOffWhere`, add `viewing?: string` to `buildSystemPrompt` (line after "Today is"). **Step 4:** Run; PASS.
- [ ] **Step 5:** Thread `ctx.scope` through: `getRecord` and the `search` tool add `entityScopeWhere`; name lookups (`assetScope`, `propertyScope`) skip assets and people failing `assetInScope`; `cost_summary` calls `loadCostRecords({ scope: ctx.scope })`; `asset_history`, `warranty_status`, `maintenance_status` and `medication_history` add the fragments.
- [ ] **Step 6:** Documents: `search_documents` adds `await outOfScopeAttachmentIds(ctx.scope)` to `excludeAttachmentIds`; `isHidden` and `read_document` also refuse ids in that set ("That file isn't available while the property filter is on."); `scopeWhere` gains an optional `NOT: attachmentOutOfScopeWhere(scope)`, passed by `list_documents` and `countNotIndexed`.
- [ ] **Step 7:** Route: `const scope = await loadPropertyScope()` on the request (the chat panel's same-origin `fetch` carries the cookie), `hiddenEntityIds = await loadHiddenEntityIds(scope)`, both into `ctx`, and `viewing: scope?.propertyName` into `buildSystemPrompt`. `app/api/assistant-test/route.ts` unchanged.
- [ ] **Step 8:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 9: Manual checklist** (Rental selected, Ana linked): "what's due this month?" lists no Home items; "Home furnace warranty?" and "Ben's medications?" say the filter hides them; asking for a Home manual by name finds nothing. Under All, all of them work.
- [ ] **Step 10: Commit checkpoint** — `The assistant follows the property filter.`

### Task 16: Attention cue on the dropdown

**Files:**
- Create: `lib/property-filter-cue.ts`, test `lib/property-filter-cue.test.ts`
- Create: `components/property-filter-cue.tsx` (client)
- Modify: `components/property-filter.tsx` (render the cue inside the trigger), `app/globals.css` (keyframes beside `chart-draw` :479; reduced-motion rule in the block at :510)

**Interfaces — Produces:**

```ts
// lib/property-filter-cue.ts
export const CUE_INTERVAL_MS = 120_000
export const CUE_DURATION_MS = 1_800
export function cueActive(s: { selected: boolean; hidden: boolean; reducedMotion: boolean }): boolean
// components/property-filter-cue.tsx
export function PropertyFilterCue({ active }: { active: boolean }): JSX.Element | null
```

- [ ] **Step 1: Failing tests:** `cueActive` is true only for `{ selected: true, hidden: false, reducedMotion: false }`; false for each of the other seven combinations. `CUE_INTERVAL_MS` is `120000` and `CUE_DURATION_MS` is between `1500` and `2000`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** CSS in `globals.css`: `@keyframes property-cue-trace` animating `stroke-dashoffset` from `100` to `0` and `opacity` `0 → 1` (first 10%) `→ 1` (90%) `→ 0`; class `.property-cue` applies it once over `1.8s ease-in-out`; under `prefers-reduced-motion: reduce`, `.property-cue { animation: none; opacity: 0 }`.
- [ ] **Step 6:** `PropertyFilterCue`: when `active`, an effect starts `setInterval(CUE_INTERVAL_MS)` that sets `tracing = true`; a `visibilitychange` listener clears the interval while hidden and starts a fresh one when visible; reads `matchMedia("(prefers-reduced-motion: reduce)")` and listens for changes; cleans up the interval and both listeners on unmount. While `tracing`, it renders `<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>` with one `<rect x="0" y="0" width="100%" height="100%" rx={the trigger's corner radius in px} pathLength={100} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="14 86" className="property-cue" onAnimationEnd={() => setTracing(false)} />`. Under reduced motion it renders nothing and the trigger gets `ring-1 ring-primary/40` instead.
- [ ] **Step 7:** `PropertyFilter` passes `active={selectedId !== null}`; nothing renders on "All properties".
- [ ] **Step 8:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`.
- [ ] **Step 9: Manual checklist:**
  - Rental selected: after two minutes a thin accent line runs once around the dropdown in under two seconds and stops; nothing around it moves (check with the dropdown next to the search box at desktop and phone widths).
  - "All properties" selected: no trace, ever.
  - Switch to another tab for five minutes and back: no burst of traces; the next comes two minutes later.
  - OS "reduce motion" on: no trace; a faint static ring shows while a property is selected.
  - Light, dark and at least two other themes from `lib/themes.ts`: the line uses the theme's accent and is visible but quiet.
  - Navigate between pages: still one trace per two minutes (no duplicate timers; React dev tools show one interval).
- [ ] **Step 10: Commit checkpoint** — `The property dropdown gives a quiet reminder while a property is selected.`

### Task 17: Final check and leak audit

- [ ] **Step 1:** `npx vitest run` — all pass. Quote the summary line.
- [ ] **Step 2:** `npx eslint .` — 0 errors, warning count equal to Task 1's baseline.
- [ ] **Step 3:** `npx tsc --noEmit` — no output.
- [ ] **Step 4:** `grep -rn "loadPropertyScope" lib/costs-server.ts lib/insurance-server.ts lib/assets-server.ts lib/rooms-server.ts lib/llm/tools lib/documents` returns nothing.
- [ ] **Step 5:** Leak audit: `grep -rn "prisma\.[a-zA-Z]*\.\(findMany\|count\|aggregate\|groupBy\)" app/\(app\) app/reports lib/llm lib/search lib/*-server.ts`. For each hit on a property-, vehicle- or person-linked model, note in the report whether it's scoped, guarded by Task 10, or deliberately unscoped (names-only lookups, email/push, backups).
- [ ] **Step 6:** Feature-off regression list for the user: switch off with a leftover `hc-property` cookie, every page matches `main` and no cue runs.
- [ ] **Step 7:** Report "Left open": every manual checklist above (not checked in a browser) and the spec's open questions.
