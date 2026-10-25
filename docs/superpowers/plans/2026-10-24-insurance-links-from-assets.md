# Link policies from person, property and vehicle pages: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Edit dialog on a person's, property's and vehicle's page gets an "Insurance" checkbox list, so a policy can be linked to or unlinked from that asset without opening the policy form.

**Architecture:** Two pure rules join `lib/insurance.ts`: which kinds may link to a given side (built on `allowedLinks`, so the kind rule stays in one place) and a diff that turns "the boxes ticked on this asset" into connect and disconnect lists that only touch this asset's side of eligible policies. `lib/insurance-server.ts` gains a loader for the choices and a helper that runs the diff against the database. `updateProperty`, `updateVehicle` and `updatePerson` take an optional list of policy ids and write the diff in the same `update` call as the asset's own fields. The dialogs show the list only when editing and only when at least one eligible policy exists.

**Tech Stack:** Next.js 16 (app router, server actions), Prisma 7 + SQLite/libSQL (implicit M:N `InsurancePolicy.members / properties / vehicles`, back-relations `insurancePolicies` on `Person`, `Property`, `Vehicle`), zod, react-hook-form, Vitest.

**Spec:** the user's request recorded in `C:\Users\michael.dazzo\.claude-work\projects\C--git-home-center\memory\project-insurance-link-followups.md`, with the Health-off rules of `docs/superpowers/plans/2026-10-24-step5-insurance.md` (Decisions 3 and 4, Global Constraints).

## Decisions (check these)

1. **One "Insurance" checkbox list per dialog, choices filtered by kind.** Property and vehicle list HOME, RENTERS, AUTO, UMBRELLA and PROPERTY_OTHER (Other) policies. A person lists MEDICAL, DENTAL, VISION, OTHER (health) and LIFE. That's exactly `allowedLinks(kind, health).assets` / `.members`; LIFE and health kinds never link assets.
2. **Asset sides always use `health = false`.** The asset kinds don't depend on Health, so the property and vehicle loaders and actions pass `false`, which also applies `healthKindWhere(false)` and keeps health kinds out of the query entirely. A test pins `eligibleKinds("properties", true)` equal to `eligibleKinds("properties", false)`.
3. **People only with Health on, enforced twice.** `updatePerson` already calls `requireHealth()` (a 404 with Health off) before anything else, and `eligibleKinds("members", false)` is `[]`, so even a direct call to the helper with Health off links nothing. The person page itself is already behind `requireHealth()`.
4. **Saving from the asset side touches only this asset.** It uses `connect` / `disconnect` on the asset's `insurancePolicies` relation, never `set` on the policy, so a policy's other properties, vehicles and people stay as they are. Only eligible policies can be connected or disconnected; an ineligible or unknown id in the request is ignored, the same way `linkWrites` silently drops links a kind can't carry.
5. **Not offered when adding an asset.** Create-then-link would be a one-line nested `connect`, but the three list pages (`property-list.tsx`, `vehicle-list.tsx`, `people-list.tsx`) would each need the policy choices loaded, and a new asset rarely has a policy yet. The edit dialog is one click away after saving. If the user wants it on create, it's a small follow-up.
6. **Hidden when there's nothing to pick**, like the Manual row in step 4. When hidden, the action gets `undefined` for the ids and doesn't touch links at all (not "unlink everything").
7. **Choice label** is `Carrier · Plan · Kind`, e.g. "State Farm · Homeowners HO-3 · Home", "Delta Dental · Dental". The kind is there because one carrier often writes both home and auto. Sorted by carrier, then plan. Ended policies are listed like any other, with no marker.
8. **The policy form's `CheckList` moves to `components/forms/check-list.tsx`** and is reused by the property and vehicle dialogs, instead of copying it twice. The person dialog uses `EntityFormDialog`'s existing `"checkboxes"` field kind (comma-separated ids).
9. **Help text lands with each field's UI task**, not in a separate task, because `field-help.test.ts` fails both on an id with no entry and on an entry no form uses. Ids: `property.insurance`, `vehicle.insurance`, `person.insurance`.
10. **No change to the policy form's behaviour, the schema, migrations, backup, search or the assistant.** The join tables already exist; only who edits them changes.

No open questions change what gets built.

## Global Constraints

- Read `AGENTS.md`, `CLAUDE.md`, and `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `07-mutating-data.md` before writing page, client component or server action code.
- Don't touch `app/(app)/page.tsx` or `components/dashboard/*`.
- `lib/insurance.ts` is imported by the backup engine (`lib/backup/readable.ts`). Only `import type` lines are allowed in it. The new functions use nothing outside the file.
- People, property and vehicle detail pages are checked together (repo `CLAUDE.md`). Tasks 3 and 4 change all three.
- In react-hook-form components use `useWatch`, never `form.watch`, in new code. The vehicle dialog's two existing `form.watch("meterUnit")` calls stay as they are.
- Every new labelled field gets a `lib/field-help` entry and a literal `help="…"` / `help: "…"` id. Copy rules are in `lib/field-help/types.ts` and memory note `feedback-user-facing-copy.md`: short, everyday words, no em dashes, no "allows you to / helps you / lets you / ensures".
- Vitest only picks up `lib/**/*.test.ts`. No component tests. Server-action tests mock `@/lib/prisma`, `@/auth`, `next/cache`, `next/navigation` and feature checks, as in `lib/actions/health-changes.test.ts`.
- A task is done when `npx vitest run`, `npx eslint .` (0 errors, exactly 8 pre-existing warnings, no new ones) and `npx tsc --noEmit` all pass.
- Never run `npm run db:seed:demo`. It wipes the dev DB.
- Shell heredocs with quotes break in this environment. Use the Edit tool, or a script in the scratchpad.
- No browser tool is available. UI tasks end with a manual-verification list for the user, and the executor says it did **not** check in a browser.
- **The executor doesn't commit, push, `git add`, `stash` or `checkout` unless the user asks.** Commit steps are for when the user does ask; until then leave everything uncommitted. Messages are one line plus `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

## Review Focus

1. **Unticking a shared policy.** Chubb (umbrella) covers Maple Street House and the Work Truck. Unticking Chubb in Maple Street House's dialog leaves the Work Truck on it. Task 1 tests the diff; Task 2 asserts the action sends `disconnect` for the property only and never writes the policy.
2. **Health off.** Blue Cross (MEDICAL) and Lifeco (LIFE, two people) are on file. With Health off, the property and vehicle dialogs list neither, and `updatePerson` with ids returns a 404 before any query. Task 1 tests `eligibleKinds`; Task 2 tests the person action with `requireHealth` throwing.
3. **A crafted or stale id.** Posting Blue Cross's or Lifeco's id to `updateProperty` connects nothing. Task 1 tests the diff ignores it; Task 2 tests the query only asks for asset kinds.
4. **Saving with the list hidden.** A property edited while no asset policy exists, or saved from the Add dialog, keeps whatever links it had. Task 2 asserts the update has no `insurancePolicies` key when ids are `undefined`.
5. **Ticking a policy that's already linked, or ticking nothing new.** Re-saving the dialog unchanged sends empty `connect` and `disconnect` lists, and no duplicate join row. Task 1 tests an unchanged selection gives `{ connect: [], disconnect: [] }`.

---

### Task 1: Pure rules: eligible kinds, choice label and the link diff

**Files:**
- Modify: `lib/insurance.ts` (after `linkWrites`)
- Test: `lib/insurance.test.ts` (new `describe` block at the end)

**Interfaces:**
- Consumes: `allowedLinks`, `INSURANCE_KINDS`, `insuranceKindLabel`, `InsuranceKindValue` (same file).
- Produces:

```ts
export type LinkSide = "members" | "properties" | "vehicles"
/// Whether a policy of this kind may link to this side. members → allowedLinks(...).members; properties and vehicles → .assets.
export function linksSide(kind: string, health: boolean, side: LinkSide): boolean
/// Kinds that may link to this side, in INSURANCE_KINDS order.
export function eligibleKinds(side: LinkSide, health: boolean): InsuranceKindValue[]
export function policyChoiceLabel(p: { carrier: string; planName: string | null; kind: string }): string
/// Connects and disconnects for one asset. Only eligible policies are touched; ids not in `policies` or not eligible are ignored.
export function assetPolicyDiff(
  side: LinkSide,
  health: boolean,
  policies: { id: string; kind: string; linked: boolean }[],
  chosen: string[],
): { connect: string[]; disconnect: string[] }
```

- [ ] **Step 1: Write failing tests** in `describe("linking policies from an asset")`:
  - `it("lists the kinds each side can link")`:
    - `eligibleKinds("properties", false)` → `["HOME", "RENTERS", "AUTO", "UMBRELLA", "PROPERTY_OTHER"]`; same for `"vehicles"`; `eligibleKinds("properties", true)` equals `eligibleKinds("properties", false)`.
    - `eligibleKinds("members", true)` → `["LIFE", "MEDICAL", "DENTAL", "VISION", "OTHER"]`.
    - `eligibleKinds("members", false)` → `[]`.
    - `linksSide("LIFE", true, "vehicles")` → `false`; `linksSide("UMBRELLA", true, "members")` → `false`; `linksSide("AUTO", false, "properties")` → `true`.
  - `it("labels a policy choice")`: `{ carrier: "State Farm", planName: "Homeowners HO-3", kind: "HOME" }` → `"State Farm · Homeowners HO-3 · Home"`; `{ carrier: "Delta Dental", planName: null, kind: "DENTAL" }` → `"Delta Dental · Dental"`; `{ carrier: "Aflac", planName: "", kind: "OTHER" }` → `"Aflac · Other (health)"`.
  - `it("connects and disconnects only this asset's eligible policies")`, with `policies = [{ id: "home", kind: "HOME", linked: true }, { id: "umb", kind: "UMBRELLA", linked: false }, { id: "auto", kind: "AUTO", linked: true }]`:
    - `assetPolicyDiff("properties", false, policies, ["home", "umb"])` → `{ connect: ["umb"], disconnect: ["auto"] }`.
    - chosen `["home", "auto"]` (unchanged) → `{ connect: [], disconnect: [] }`.
    - chosen `[]` → `{ connect: [], disconnect: ["home", "auto"] }`.
  - `it("ignores ids it may not link")`:
    - `assetPolicyDiff("properties", false, [{ id: "life", kind: "LIFE", linked: false }, { id: "med", kind: "MEDICAL", linked: false }], ["life", "med", "nope"])` → `{ connect: [], disconnect: [] }`.
    - A linked LIFE policy on the properties side with chosen `[]` is not disconnected: `assetPolicyDiff("properties", false, [{ id: "life", kind: "LIFE", linked: true }], [])` → `{ connect: [], disconnect: [] }`.
    - `assetPolicyDiff("members", false, [{ id: "life", kind: "LIFE", linked: true }, { id: "med", kind: "MEDICAL", linked: false }], ["med"])` → `{ connect: [], disconnect: [] }`.
    - `assetPolicyDiff("members", true, [{ id: "life", kind: "LIFE", linked: false }, { id: "med", kind: "MEDICAL", linked: true }, { id: "home", kind: "HOME", linked: false }], ["life", "home"])` → `{ connect: ["life"], disconnect: ["med"] }`.
  - Duplicates in `chosen` (`["umb", "umb"]`) still give `connect: ["umb"]` once (output order follows `policies`).
- [ ] **Step 2: Run** `npx vitest run lib/insurance.test.ts`. Expected: FAIL, the four exports don't exist.
- [ ] **Step 3: Implement** the four exports in `lib/insurance.ts`. `linksSide` calls `allowedLinks`; `eligibleKinds` filters `INSURANCE_KINDS` with `linksSide`; the diff walks `policies` once. No new imports.
- [ ] **Step 4: Run** `npx vitest run lib/insurance.test.ts` and `npx vitest run lib/backup/import-rules.test.ts`. Expected: PASS (the import-rules test proves `lib/insurance.ts` still has no runtime import).
- [ ] **Step 5: Commit** (only if the user asked): `git add lib/insurance.ts lib/insurance.test.ts && git commit -m "Add the rules for linking policies from a person, property or vehicle" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 2: Loader, link helper and the three update actions

**Files:**
- Modify: `lib/insurance-server.ts` (two new exports after `loadAssetPolicies`)
- Modify: `lib/actions/properties.ts` (`updateProperty`), `lib/actions/vehicles.ts` (`updateVehicle`), `lib/actions/people.ts` (`updatePerson`)
- Test: `lib/actions/asset-policy-links.test.ts` (new)

**Interfaces:**
- Consumes: `LinkSide`, `eligibleKinds`, `policyChoiceLabel`, `assetPolicyDiff` (Task 1); `healthKindWhere` (same file).
- Produces:

```ts
// lib/insurance-server.ts
/// Policies that may link to this side, as checkbox choices, sorted by carrier then plan.
export async function loadPolicyChoices(side: LinkSide, health: boolean): Promise<{ id: string; name: string }[]>
/// The connect/disconnect lists for one asset, read from the database and run through assetPolicyDiff.
export async function assetPolicyLinks(side: LinkSide, assetId: string, chosen: string[], health: boolean): Promise<{ connect: string[]; disconnect: string[] }>

// actions (new optional last parameter; undefined = leave links alone)
export async function updateProperty(id: string, data: PropertyInput, policyIds?: string[])
export async function updateVehicle(id: string, data: VehicleInput, policyIds?: string[])
export async function updatePerson(id: string, values: FormValues): Promise<ActionResult>
//   reads values.insurancePolicyIds (comma-separated) when the key is present; absent = leave links alone
```

- [ ] **Step 1: Write failing tests** in `lib/actions/asset-policy-links.test.ts`. Mock `@/lib/prisma` with `insurancePolicy.findMany`, `property.update`, `vehicle.update`, `person.update` as `vi.fn()`s; `@/auth` returns a session; `next/cache` `revalidatePath` is a spy; `next/navigation` `redirect` throws; `@/lib/asset-delete-server` and `@/lib/upload-fs` are stubs; `@/lib/features-server` exposes `requireHealth` as a `vi.fn()` (default resolves). The policy query's mocked rows carry the relation for the side being saved, e.g. `{ id: "chubb", kind: "UMBRELLA", properties: [{ id: "p1" }] }` for linked and `properties: []` for not linked.
  - Fixtures: `validProperty = { name: "Maple Street House", type: "HOUSE", address: "12 Maple St" }`, `validVehicle = { name: "Work Truck", make: "Ford", model: "F-150", year: "2020", meterUnit: "MILES" }`, `validPerson = { name: "Jordan Rivera", relationship: "SELF" }`.
  - `describe("updateProperty")`:
    - `it("unlinks only this property from a shared policy")`: rows `chubb` (linked) and `sf` (HOME, not linked); `updateProperty("p1", validProperty, ["sf"])` → `{ success: true }`; `property.update` called with `data` containing `insurancePolicies: { connect: [{ id: "sf" }], disconnect: [{ id: "chubb" }] }` and `where: { id: "p1" }`; nothing calls an `insurancePolicy.update`.
    - `it("asks only for policies that can cover a property")`: the `findMany` `where` contains `kind: { in: ["HOME", "RENTERS", "AUTO", "UMBRELLA", "PROPERTY_OTHER"] }` and the `healthKindWhere(false)` clause `kind: { notIn: ["MEDICAL", "DENTAL", "VISION", "OTHER"] }`.
    - `it("leaves links alone when no ids are sent")`: `updateProperty("p1", validProperty)` → `findMany` not called, and `property.update`'s `data` has no `insurancePolicies` key.
    - `it("revalidates the Insurance page when links change")`: with ids, `revalidatePath` was called with `"/insurance"` and `"/assets/properties/p1"`.
    - `it("writes nothing on invalid fields")`: `updateProperty("p1", { ...validProperty, name: "" }, ["sf"])` returns `error.name`; `property.update` not called.
  - `describe("updateVehicle")`: `it("links an auto policy to this vehicle")`: rows `prog` (AUTO, `vehicles: []`); `updateVehicle("v1", validVehicle, ["prog"])` → `vehicle.update` `data.insurancePolicies` equals `{ connect: [{ id: "prog" }], disconnect: [] }`.
  - `describe("updatePerson")`:
    - `it("links health and life policies with Health on")`: rows `bc` (MEDICAL, `members: [{ id: "h1" }]`) and `life` (LIFE, `members: []`); `updatePerson("h1", { ...validPerson, insurancePolicyIds: "life" })` → `person.update` `data.insurancePolicies` equals `{ connect: [{ id: "life" }], disconnect: [{ id: "bc" }] }`; `revalidatePath` got `"/insurance"`.
    - `it("does nothing with Health off")`: `requireHealth` rejects with `new Error("NEXT_HTTP_ERROR_FALLBACK;404")`; the call rejects; `findMany` and `person.update` not called.
    - `it("leaves links alone without the field")`: `updatePerson("h1", validPerson)` → `findMany` not called, no `insurancePolicies` key.
- [ ] **Step 2: Run** `npx vitest run lib/actions/asset-policy-links.test.ts`. Expected: FAIL (no third parameter, no `insurancePolicies` in the update).
- [ ] **Step 3: Implement the two helpers** in `lib/insurance-server.ts`. Both query `insurancePolicy.findMany` with `where: { AND: [healthKindWhere(health), { kind: { in: eligibleKinds(side, health) } }] }`. `loadPolicyChoices` selects `id, carrier, planName, kind`, orders `[{ carrier: "asc" }, { planName: "asc" }]`, maps to `{ id, name: policyChoiceLabel(p) }`. `assetPolicyLinks` selects `id`, `kind` and the side's relation filtered to `{ where: { id: assetId }, select: { id: true } }`, maps each row to `linked: row[side].length > 0`, and returns `assetPolicyDiff(side, health, rows, chosen)`.
- [ ] **Step 4: Implement the actions.** After validation, when ids are given: `const links = await assetPolicyLinks(side, id, ids, health)` and spread `insurancePolicies: { connect: links.connect.map((p) => ({ id: p })), disconnect: links.disconnect.map((p) => ({ id: p })) }` into the existing `update`'s `data`, then add `revalidatePath("/insurance")`. Property and vehicle pass `"properties"` / `"vehicles"` with `health = false` (Decision 2). Person passes `"members"` and `true` (after `requireHealth()`), parsing `values.insurancePolicyIds` with `split(",").filter(Boolean)` only when `"insurancePolicyIds" in values`. `personSchema` already strips the extra key, so `parsed.data` is unchanged.
- [ ] **Step 5: Run** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 6: Commit** (only if asked): `git add lib/insurance-server.ts lib/actions/properties.ts lib/actions/vehicles.ts lib/actions/people.ts lib/actions/asset-policy-links.test.ts && git commit -m "Save policy links from the person, property and vehicle edit actions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 3: Insurance list in the property and vehicle dialogs

**Files:**
- Create: `components/forms/check-list.tsx` (moved from `components/insurance/insurance-form-dialog.tsx:68-87`)
- Modify: `components/insurance/insurance-form-dialog.tsx` (import `CheckList`, delete the local copy)
- Modify: `components/properties/property-form-dialog.tsx`, `components/properties/property-edit-button.tsx`, `app/(app)/assets/properties/[id]/page.tsx` (`Promise.all` :41, `PropertyEditButton` :117)
- Modify: `components/vehicles/vehicle-form-dialog.tsx`, `components/vehicles/vehicle-edit-button.tsx`, `app/(app)/assets/vehicles/[id]/page.tsx` (`Promise.all` :32, `VehicleEditButton` :78)
- Modify: `lib/field-help/assets.ts` (two entries)

**Interfaces:**
- Consumes: `loadPolicyChoices` (Task 2); `loadAssetPolicies` (already on both pages, gives the linked ids); `updateProperty(id, data, policyIds?)`, `updateVehicle(id, data, policyIds?)` (Task 2).
- Produces:

```ts
export function CheckList(props: { label: string; help: string; options: { id: string; name: string }[]; value: string[]; onChange: (next: string[]) => void }): JSX.Element
// PropertyFormDialog / VehicleFormDialog gain optional props:
//   policyChoices?: { id: string; name: string }[]   (default [])
//   policyIds?: string[]                              (linked now; default [])
// PropertyEditButton({ property, policyChoices, policyIds }), VehicleEditButton({ vehicle, policyChoices, policyIds })
```

- [ ] **Step 1: Move `CheckList`** to `components/forms/check-list.tsx` (`"use client"`, same markup, exported) and import it in the policy form. No behaviour change.
- [ ] **Step 2: Property dialog.** Add `policyIds: z.array(z.string())` to the zod schema, `[]` in both default/reset objects for a new property and `policyIds ?? []` when resetting for an existing one. `const showInsurance = !!property && policyChoices.length > 0`. When true, render `<CheckList label="Insurance" help="property.insurance" … />` after Notes (it spans both columns already), reading the value with `useWatch({ control: form.control, name: "policyIds" })` and writing with `form.setValue("policyIds", next, { shouldDirty: true })`. On submit, split `policyIds` off the values and call `updateProperty(property.id, rest, showInsurance ? policyIds : undefined)`. Add `policyIds` to the `useEffect` dependency list.
- [ ] **Step 3: Vehicle dialog.** Same as Step 2 with `help="vehicle.insurance"` and `updateVehicle`.
- [ ] **Step 4: Edit buttons and pages.** Each edit button passes its two new props through. Property page adds `loadPolicyChoices("properties", false)` to the first `Promise.all` and renders `<PropertyEditButton property={property} policyChoices={policyChoices} policyIds={policies.map((p) => p.id)} />`. Vehicle page does the same with `"vehicles"`. List pages are unchanged (Decision 5).
- [ ] **Step 5: Help entries** in `lib/field-help/assets.ts`, after `property.notes` and `vehicle.notes`:

```ts
"property.insurance": {
  title: "Insurance",
  what: "The policies that cover this property, such as home, renters or umbrella.",
  use: "Ticked policies show in the Insurance box on this page and list this property on the Insurance page. Unticking one removes only this property from it.",
},
"vehicle.insurance": {
  title: "Insurance",
  what: "The policies that cover this vehicle, such as auto or umbrella.",
  use: "Ticked policies show in the Insurance box on this page and list this vehicle on the Insurance page. Unticking one removes only this vehicle from it.",
},
```

- [ ] **Step 6: Checkpoint.** `npx vitest run` (includes `field-help.test.ts`), `npx eslint .` (8 warnings), `npx tsc --noEmit`. `git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing.
- [ ] **Step 7: Manual verification list for the user** (the executor says it didn't run a browser):
  - Maple Street House → Edit: an "Insurance" list under Notes shows State Farm, Progressive and Chubb with kinds; State Farm is ticked. No Lifeco, no Blue Cross, with Health on or off.
  - Tick Chubb and save: the Insurance box on the page lists Chubb, and Chubb's card on the Insurance page names Maple Street House.
  - Tick Chubb on the Work Truck too, then untick it on Maple Street House: Chubb still covers the Work Truck.
  - Add Property / Add Vehicle from the list pages: no Insurance list.
  - The policy form's Covers properties / vehicles / people lists look and work as before.
- [ ] **Step 8: Commit** (only if asked): `git add components/forms/check-list.tsx components/insurance/insurance-form-dialog.tsx components/properties components/vehicles "app/(app)/assets/properties/[id]/page.tsx" "app/(app)/assets/vehicles/[id]/page.tsx" lib/field-help/assets.ts && git commit -m "Link policies from the property and vehicle edit dialogs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 4: Insurance list in the person edit panel

**Files:**
- Modify: `components/people/person-fields.ts`, `components/people/person-edit-button.tsx`
- Modify: `app/(app)/assets/people/[id]/page.tsx` (`Promise.all` :66, `PersonEditButton` :118)
- Modify: `lib/field-help/health.ts` (one entry after `person.notes`)

**Interfaces:**
- Consumes: `loadPolicyChoices` (Task 2); `person.insurancePolicies` (already loaded on the page, :56); `updatePerson` reading `insurancePolicyIds` (Task 2).
- Produces:

```ts
export function personFields(providers: { id: string; name: string }[], policies: { id: string; name: string }[] = []): FieldConfig[]
//   appends { name: "insurancePolicyIds", label: "Insurance", kind: "checkboxes", wide: true, help: "person.insurance", options } only when policies.length > 0
export function personInitial(person?: Person | null, policyIds?: string[]): FormValues
//   adds insurancePolicyIds: policyIds.join(",") only when policyIds is given
// PersonEditButton({ person, providers, policyChoices, policyIds })
```

- [ ] **Step 1: Fields.** Extend `personFields` and `personInitial` as above. `people-list.tsx` keeps calling `personFields(providers)` and `personInitial()`, so the Add Person dialog is unchanged.
- [ ] **Step 2: Edit button.** Pass `personFields(providers, policyChoices)` and `personInitial(person, policyChoices.length > 0 ? policyIds : undefined)`, so the key only reaches `updatePerson` when the list is shown (Decision 6).
- [ ] **Step 3: Page.** Add `loadPolicyChoices("members", true)` to the `Promise.all` at :66 (the page is behind `requireHealth()`), and pass `policyChoices` and `policyIds={person.insurancePolicies.map((p) => p.id)}` to `PersonEditButton`.
- [ ] **Step 4: Help entry** in `lib/field-help/health.ts`:

```ts
"person.insurance": {
  title: "Insurance",
  what: "The health and life policies that cover this person.",
  use: "Ticked policies show in the Insurance box on this page and list this person on the Insurance page. Unticking one removes only this person from it.",
},
```

- [ ] **Step 5: Checkpoint.** `npx vitest run`, `npx eslint .` (8 warnings), `npx tsc --noEmit`.
- [ ] **Step 6: Manual verification list for the user** (Health on; the executor says it didn't run a browser):
  - A person → Edit: an "Insurance" list after Notes shows Blue Cross, Delta Dental and Lifeco, with the ones that cover them ticked. No home, auto or umbrella policies.
  - Untick Delta Dental and save: it leaves this person's Insurance box, and Delta Dental's card on the Insurance page still lists the other person.
  - Add Person on the People list: no Insurance list.
  - Turn Health off: the person page is gone (as before) and no dialog lists people or health policies.
- [ ] **Step 7: Commit** (only if asked): `git add components/people "app/(app)/assets/people/[id]/page.tsx" lib/field-help/health.ts && git commit -m "Link health and life policies from the person edit panel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 5: Testing checklist, demo data check and final checkpoint

**Files:**
- Modify: `TESTING-CHECKLIST.md` (intro line, new section before `## Known gaps`)

- [ ] **Step 1: Demo data check.** Read `prisma/seed-demo.ts` `seedInsurance` (around :605-680) and the health seed (:704-705) and confirm it already has: State Farm on Maple Street House, Progressive on a vehicle, Chubb with nothing linked, Lifeco and Blue Cross and Delta Dental on both people. No seed change is needed; `npx tsc --noEmit` covers the seed. Don't run either seed command.
- [ ] **Step 2: Intro line.** Change "and the field help popovers (section 17)" to "the field help popovers (section 17) and linking policies from asset pages (section 18)". Keep every other section as it is.
- [ ] **Step 3: Add section 18** before `## Known gaps`:

```markdown
## 18. Linking policies from a person, property or vehicle

**Property and vehicle** (Health on or off)
- [ ] Open Maple Street House and click Edit. Under Notes there's an "Insurance" list with your home, renters, auto, umbrella and other policies. Life and health policies aren't in it. State Farm is already ticked.
- [ ] Tick Chubb and save. Chubb now shows in the Insurance box on the page, and on the Insurance page Chubb's card names Maple Street House.
- [ ] Open the Work Truck, tick Chubb and save. Go back to Maple Street House, untick Chubb and save. Chubb still covers the Work Truck.
- [ ] Add Property and Add Vehicle don't show the Insurance list. Link a new one with Edit after saving.
- [ ] Delete every home, auto and umbrella policy on a scratch copy (or use a fresh database): the Insurance list doesn't show at all, and saving the dialog still works.

**Person** (Health on)
- [ ] Open a person and click Edit. After Notes there's an "Insurance" list with your medical, dental, vision and life policies, and the ones that cover this person are ticked. Home and auto policies aren't in it.
- [ ] Untick Delta Dental and save. It leaves this person's Insurance box, and its card on the Insurance page still lists the other person.
- [ ] Add Person doesn't show the Insurance list.

**With Health off**
- [ ] The property and vehicle lists never show medical, dental, vision or life policies.
- [ ] Turn Health back on: every person still has the policies they had.

**Help**
- [ ] The "?" beside each new Insurance list says what ticking and unticking does, in plain words.
```

- [ ] **Step 4: Final checkpoint.** Run `npx vitest run`, `npx eslint .` and `npx tsc --noEmit`, and quote the summary lines (eslint: 0 errors, 8 warnings). Confirm `git diff --stat -- "app/(app)/page.tsx" components/dashboard` prints nothing. Run `git status` and list the files this work changed. Don't commit unless the user asked. Say that the manual-verification lists in Tasks 3 and 4 and checklist section 18 are open for the user and that nothing was checked in a browser.
- [ ] **Step 5: Commit** (only if asked): nothing to commit here beyond earlier tasks; `TESTING-CHECKLIST.md` stays uncommitted (it's deleted before the PR).
