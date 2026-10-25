# Property filter — design

## Why

Someone with a home and a rental wants to see landlord obligations apart from
their own household at a glance: "what's due at the rental this month?" without
the home's furnace filter, the family car and the kids' checkups in the way.
Today every list mixes all properties.

Success: pick "Rental" in a dropdown at the top of the page and nothing that
belongs to the home is shown or counted anywhere: lists, cards, totals, charts,
detail pages, reports, notifications, search and the assistant. Pick "All
properties" and everything is back. Turned off (the default), nothing about the
site changes and no page does extra work.

## Goals

- Settings → Features gets a "Property filter" switch, off by default.
- With the switch on and two or more properties, a dropdown sits in the top bar,
  left of the search box: "All properties" plus each property by name.
- One behaviour: items belonging to another property are left out of the query.
  They aren't shown, counted or offered anywhere in the app.
- Vehicles and people can each be linked to one property, from their edit forms.
- Vehicles and people follow the same rule: if none are linked to the selected
  property, they aren't filtered; once any is linked, only the linked ones show.
- While a property is selected, the dropdown gives a quiet visual reminder about
  every two minutes, so a forgotten filter gets noticed.

## Non-goals

- Not a permission or privacy boundary. Anyone can switch back to "All
  properties", and a direct file URL (`/api/files/…`) still serves its file.
- Email digests and push aren't filtered (see Decisions).
- Backups and the readable export aren't filtered.
- No dim or fade mode. Out-of-scope items are left out, full stop.
- No multi-select ("home + rental") and no saved views.
- No linking providers to properties. Providers are a shared directory.
- No more than one property per vehicle or per person.

## Anti-goals

- A forgotten filter that makes data look lost. The dropdown always shows its
  current value, a filtered empty list says it's filtered, and the cue draws the
  eye back to it now and then.
- A cue that nags: no pulsing, scaling, sound or layout shift.
- Losing data by editing under a filter. Saving a form must never drop a link to
  something the filter is hiding (an umbrella policy's link to the other
  property, a family policy's member who lives at the other property).
- Cost when off: no cookie read, no dropdown, no extra query on any page.

## Constraints

- Next.js 16.4.3 app router, no Cache Components, no `"use cache"` anywhere.
  Every `(app)` page renders per request. `staleTimes.dynamic` defaults to 0.
- Prisma 7 + SQLite. ServiceRecord, Warranty and MaintenanceSchedule point at
  their asset polymorphically (`assetType` + `assetId`, no foreign key).
  Notification points at its subject by `relatedEntityId` only.
- Vitest covers `lib/**/*.test.ts` in a node environment (no DOM). Pure rules get
  plain tests; server modules can be tested with `vi.mock` of `@/lib/prisma` and
  `next/headers`, as `lib/actions/asset-policy-links.test.ts` does.
- The field-help test requires an entry for every `help="…"` id and use of every
  entry.
- Uncommitted work in the tree (push notifications, backup secrets) touches
  `app/(app)/settings/page.tsx`, `prisma/schema.prisma` and the latest
  migration `20261025022858_push_and_interval_settings`. Implementation starts
  after that work is committed; the new migration sorts after it.

## The rule

Selected property P. An item is **out of scope** when it belongs to a property
other than P, or to a vehicle or person the linked-only rule hides. Everything
else stays.

**Linked-only rule (vehicles and people, one shared function).** Count the
vehicles linked to P. Zero: no vehicle is hidden. One or more: every vehicle not
linked to P is hidden, whether unlinked or linked elsewhere. People work the
same way, counted separately. Example, household of four with only Ana linked to
Rental: under Rental only Ana shows, and Ben, Cara and Dev with all their
records drop out; under Home (no one linked) all four show.

| Model | Out of scope when | Notes |
|---|---|---|
| Property | `id ≠ P` | |
| Equipment | `propertyId` set and `≠ P` | Unassigned equipment stays. |
| Vehicle | hidden by the linked-only rule | |
| Person | hidden by the linked-only rule | |
| HealthCondition, Medication, Allergy, Immunization, Observation | their person is hidden | |
| Room, RoomPaint | room's `propertyId ≠ P` | |
| ServiceRecord, Warranty, MaintenanceSchedule | their asset (property, equipment, vehicle or person) is out | |
| InsurancePolicy | it has property, vehicle or member links and none of them is in scope | An umbrella linked to both properties stays; a family health policy stays while any covered person shows; an unlinked policy stays. |
| InsurancePremium, InsuranceCoverage | their policy is out | |
| Attachment | what it hangs on is out: its own asset (DOCUMENT), its record, warranty, schedule, room, policy or health record | Inbox files stay. |
| Notification | its `relatedEntityId` is an out-of-scope schedule, warranty, policy, medication or immunization | Custom notifications stay. |
| InboxItem | never | A suggestion pointing at a hidden asset is shown as no suggestion. |
| Provider | never | Its visit counts only count visible people's records. |

## How the selected property is stored

**A cookie, per device: `hc-property=<propertyId>`.** No cookie, an empty value
or an unknown id means "All properties".

| Option | Server reads it every request | Cost | Verdict |
|---|---|---|---|
| Cookie | yes, `cookies()` | free | chosen |
| URL param `?property=` | only if every link, redirect and form carries it | touches every `Link` and `redirect` | no |
| `User` column | yes, one query | a query per request; switching on the phone changes the laptop | no |

It follows `lib/placement.ts` and `lib/sidebar-state.ts`: pure read/write
helpers, the client writes `document.cookie` and calls `router.refresh()` (as
`components/settings/placement-settings.tsx:67-69` does), which re-renders the
route and drops the client router cache. Same-origin `fetch` calls, including
the assistant's `POST /api/chat`, carry the cookie.

## How queries get scoped

One server loader, one pure module, and the scope passed explicitly.

`lib/property-filter.ts` (pure, `import type` only):

- cookie name, `readPropertyFilter`, `propertyFilterCookie`;
- `linkedOnlyHidden(rows, P)`: the shared linked-only rule;
- `buildScope({ property, equipment, vehicles, people })` →

  ```ts
  type PropertyScope = {
    propertyId: string
    propertyName: string
    /** Equipment assigned to some other property. */
    hiddenEquipmentIds: string[]
    /** Linked-only rule; empty when no vehicle is linked to P. */
    hiddenVehicleIds: string[]
    /** Linked-only rule; empty when no person is linked to P. */
    hiddenPersonIds: string[]
  }
  ```

- where fragments per model, each taking `PropertyScope | null` and returning
  `{}` for null: `ownedScopeWhere`, `propertyScopeWhere`, `equipmentScopeWhere`,
  `vehicleScopeWhere`, `personScopeWhere`, `personChildScopeWhere` (health
  records), `roomScopeWhere`, `policyScopeWhere`, `attachmentOutOfScopeWhere`,
  `notificationScopeWhere(hiddenEntityIds)`;
- `assetInScope(scope, assetType, assetId)` for rows already in memory (detail
  page guard, the dashboard's activity index, costs grouping), tested to agree
  with `ownedScopeWhere`;
- `keepHiddenLinks(currentIds, chosenIds, visibleIds)` for saving link lists
  without dropping hidden links;
- `propertyLinkWrite(value)` for the vehicle and person forms: `undefined` →
  no write, `""` → `null`, an id → the id.

`ownedScopeWhere` as Prisma (empty id lists drop their clause):

```ts
{ AND: [
  { OR: [{ assetType: { not: "PROPERTY" } }, { assetId: P }] },
  { OR: [{ assetType: { not: "EQUIPMENT" } }, { assetId: { notIn: hiddenEquipmentIds } }] },
  { OR: [{ assetType: { not: "VEHICLE" } }, { assetId: { notIn: hiddenVehicleIds } }] },
  { OR: [{ assetType: { not: "PERSON" } }, { assetId: { notIn: hiddenPersonIds } }] },
] }
```

`lib/property-filter-server.ts`:

- `loadPropertyScope = cache(async () => …)`: setting off → `null` without
  calling `cookies()`; no or unknown cookie → `null`; else one `Promise.all`
  (property by id, equipment with a property, vehicles, people) and
  `buildScope`. The setting comes from the FeatureSettings row `loadFeatures`
  already reads, so off costs nothing.
- `loadHiddenEntityIds = cache(async (scope) => …)`: ids of out-of-scope
  schedules, warranties, policies, medications and immunizations, for
  notifications. Only notification surfaces call it (the layout does, for the
  bell).
- `outOfScopeAttachmentIds(scope)` in `lib/documents/scope.ts`, beside
  `healthAttachmentIds()`, for the document index.

**Shared loaders and tools take the scope as an argument and never read the
cookie themselves** (`loadCostRecords`, `loadPlannedSchedules`,
`loadInsurancePage`, `loadAssetIndex`, `loadPolicyChoices`, `assetPolicyLinks`,
`propertiesWithRooms`, document helpers, assistant tools). Entry points read
it: pages, the layout, server actions and the chat route handler.

Polymorphic rows can't be joined to `Equipment.propertyId` in Prisma, so a
precomputed id set per request is the only practical shape. The fragments are
pure functions of that scope.

## Where it applies

| Surface | How |
|---|---|
| Dashboard | every count, card, thumbnail, due list, expiring list, activity list and the spend chart use the fragments. "Is the household empty" checks stay unfiltered so the fresh-start card doesn't appear under a quiet property. |
| Maintenance, Warranties, Records | list, paging count, headline counts, totals |
| Costs | every loader call gets `scope`; in-memory groupings use `assetInScope`. Costs → People lists only people who show. |
| Asset lists | properties, vehicles, equipment, people |
| Providers | list stays; visit counts use `ownedScopeWhere` |
| Insurance page | `policyScopeWhere`; premiums and coverages follow |
| Asset detail pages and reports | an out-of-scope property, vehicle, equipment or person shows a "Hidden by the property filter" panel with a "Show all properties" button instead of its content. In-scope pages need no other change: their related lists hold their own data. |
| Pickers | asset selects, the records `?asset=` filter, equipment's property select, the vehicle and person property selects, insurance link lists (properties, vehicles, members) and policy checklists offer only in-scope items |
| Saving links | `assetPolicyLinks` only diffs in-scope policies; the insurance action merges hidden property, vehicle and member links back with `keepHiddenLinks` |
| Notifications page and bell | `notificationScopeWhere(await loadHiddenEntityIds(scope))`, ANDed with today's `visibleNotificationsWhere`. Unread count and "mark all read" touch only visible rows. |
| Global search | keyword, semantic-entity and document paths all scoped (below) |
| Assistant | data scoped (below), plus a prompt line naming P |
| Intake | items stay; pickers scoped |
| Email digests, push | not filtered |

Empty states on filtered lists read: "Nothing here for {property}. Switch to All
properties to see everything."

## Search

`lib/search/global-server.ts` has three result paths and all three get the
scope:

- keyword and semantic-entity hits: `withPropertyScope(wheres, scope)` beside
  `withFeatures` (:246), applied in the keyword path (:732) and in
  `semanticRecords` (:300). It covers the person and health keys too;
- document hits from the separate index: the `hidden` deny-list (:718) becomes
  the union of `healthAttachmentIds()` and `outOfScopeAttachmentIds(scope)`.

## Assistant

**Where the scope comes from:** the chat route handler (`app/api/chat/route.ts`)
calls `loadPropertyScope()` on its own request. The chat panel's `fetch` is
same-origin, so it carries the device's cookie: the assistant sees what the
page around it sees. The scope goes into `ToolContext` (`lib/llm/query.ts:26`)
as `scope` and `hiddenEntityIds`, the single object every tool already gets.
`app/api/assistant-test/route.ts` (admin model test) passes no scope.

**What gets scoped:**

- `compileWhere` ANDs `entityScopeWhere(entity, ctx)` next to `def.scope` and
  `healthOffWhere` (`query.ts:296-298`), covering `find_records` and `aggregate`.
- `getRecord` (`execute.ts:123-129`) and the `search` tool
  (`tools/shortcuts.ts:66`, :81-86) add the same fragment.
- Name lookups in the shortcut tools (`assetScope`/`propertyScope`,
  `shortcuts.ts:162-182`) skip out-of-scope assets and people, so "Rental
  furnace" under "Home" answers "not found". `cost_summary` passes `scope` to
  `loadCostRecords`; `asset_history`, `warranty_status`, `maintenance_status`
  and `medication_history` add the fragments.
- Documents: `search_documents` adds `outOfScopeAttachmentIds` to
  `excludeAttachmentIds` (`tools/documents.ts:112`); `isHidden` (:132) and
  `read_document` (:166-173) refuse out-of-scope files; `list_documents` and
  `countNotIndexed` add `NOT attachmentOutOfScopeWhere` to `scopeWhere`
  (`lib/documents/scope.ts:37`).
- The system prompt gains one line: "The user is viewing {P}. Items from other
  properties are hidden from you; if asked about them, say the property filter
  is hiding them."

**How the path is tested:** `loadPropertyScope` gets a mocked test (cookie
present, absent, unknown id, setting off without touching `cookies()`);
`compileWhere` gets tests with a scoped `ctx`; `entityScopeWhere` gets a test
per ontology entity; `buildSystemPrompt` gets the line test. The route itself
is two lines (load, pass) and is checked by hand.

## Notifications, email, push

The in-app list and the bell follow the filter. **Email digests and push
don't.** They run in the scheduler without a request or a cookie, and a
per-device view choice must not decide whether someone gets reminded about the
rental's smoke detectors. Notification rows are still created for every
property; only their display is filtered.

## Attention cue

While the switch is on **and** a property is selected (never on "All
properties"), the dropdown plays a thin accent-coloured trace that runs once
around its border, about 1.8 seconds, roughly every two minutes.

- **Drawing:** an absolutely positioned SVG over the trigger (`inset-0`,
  `pointer-events-none`, `overflow-visible`), one `<rect>` with the trigger's
  corner radius, `pathLength="100"`, `stroke="var(--primary)"`, 1.5px wide,
  `stroke-dasharray="14 86"`. A CSS keyframe animates `stroke-dashoffset` from
  100 to 0 with a fade in and out at the ends. Nothing in the layout moves.
- **Timing:** a small client effect starts a 120-second interval; each tick sets
  a `tracing` flag that `onAnimationEnd` clears. The interval is cleared on
  unmount and while `document.visibilityState` is `hidden`; when the tab comes
  back it restarts with a fresh two minutes (no catch-up burst). The first trace
  waits a full interval after the page loads, so switching property doesn't
  trigger one.
- **Reduced motion:** under `prefers-reduced-motion: reduce` there's no trace
  and no timer; the trigger keeps a static 1px `ring-primary/40` while a
  property is selected.
- **Themes:** colours come from the theme tokens (`--primary`), so it works in
  light, dark and every theme in `lib/themes.ts`.
- **Pure logic:** `lib/property-filter-cue.ts` holds `CUE_INTERVAL_MS = 120_000`,
  `CUE_DURATION_MS = 1_800` and `cueActive({ selected, hidden, reducedMotion })`,
  unit-tested.

## Schema

```prisma
model FeatureSettings {
  …
  /// A property dropdown in the top bar that leaves out everything belonging to other properties. Off by default.
  propertyFilterEnabled Boolean @default(false)
}

model Vehicle {
  …
  /// The property it belongs to, for the property filter. Optional.
  propertyId String?
  property   Property? @relation(fields: [propertyId], references: [id], onDelete: SetNull)

  @@index([propertyId])
}

model Person {
  …
  /// The property this person belongs to, for the property filter. Optional.
  propertyId String?
  property   Property? @relation(fields: [propertyId], references: [id], onDelete: SetNull)

  @@index([propertyId])
}

model Property {
  …
  vehicles Vehicle[]
  people   Person[]
}
```

Migration: one column with a default on `FeatureSettings`, a nullable column
plus index on `Vehicle` and on `Person`. Prisma rebuilds the three tables in
SQLite (copy, drop, rename) as earlier feature-flag migrations did. Existing
rows get `false` and no links. Backups are whole-database snapshots, so an older
backup restores and migrates forward. Deleting a property unlinks its vehicles
and people.

## Settings and copy

- New card on Settings → Features after Equipment tab: "Property filter" with an
  On/Off badge and the checkbox "Show a property filter in the top bar", help id
  `features.property-filter`. Note under it: "Pick a property and everything
  that belongs to your other properties is left out: lists, totals, search,
  notifications and the assistant. Emails and push still cover everything."
- Vehicle and person edit forms: a "Property" select ("Not assigned" plus the
  properties in scope), help ids `vehicle.property` and `person.property`, shown
  only while the switch is on. The server leaves the link untouched when the
  field isn't sent, so saving with the switch off never clears a link.
- Dropdown: selected name, truncated; on a phone a building icon with the name
  in the menu. Hidden when the switch is off or there are fewer than two
  properties.

## Risks

- **Leaks through a path nobody scoped.** The surfaces table is the checklist;
  the final task greps every `prisma.*.findMany` in `app/(app)`, `lib/llm` and
  `lib/search` and accounts for each.
- **Dropped links on save.** Covered by `keepHiddenLinks` and the scoped
  `assetPolicyLinks`, with tests.
- **Linking one person empties a property's health view.** By design (the
  user's rule), but surprising: linking Ana to Rental hides the other three
  people under Rental. The help text for `person.property` says so.
- **Stale page after switching.** `router.refresh()` re-renders and clears the
  router cache; back/forward can restore an old render for a moment. Accepted.
- **SQLite parameter count.** `notIn` lists hold hundreds of ids at most.

## Calls made without the user (check these)

1. Cookie per device, not per user.
2. Unassigned equipment and unlinked policies stay under every property.
3. Email and push stay unfiltered; in-app notifications are filtered.
4. Pickers offer only in-scope items; filing something under another property
   means switching to All properties first.
5. A hidden detail page or report shows a "Hidden by the property filter" panel
   rather than a 404.
6. Hidden links are kept when a form is saved under the filter.
7. Direct file URLs, backups and the readable export are not filtered.
8. Dropdown hidden with fewer than two properties; the vehicle and person
   "Property" fields hidden while the switch is off.
9. The cue's first trace waits a full interval; reduced motion gets a static
   ring instead.

## Decided by the user

- One behaviour: filter in the query. No dim mode.
- Strict: nothing from another property appears anywhere, except email and push.
- One property per vehicle and per person, set on their edit forms.
- People follow the vehicle rule exactly (linked-only once any is linked).
- A periodic border-trace cue while a property is selected.

## Open questions

1. **Email digests and push unfiltered?** Default: yes, they cover every
   property whatever a device has selected.
2. **Unassigned equipment under a selected property.** Default: shown
   everywhere. Hiding it would match the vehicle and people rule but makes
   unassigned things vanish under every choice.
3. **Hidden detail page: panel or 404?** Default: panel with a "Show all
   properties" button.
4. **Per-user instead of per-device?** Default: per device.
