# HomeCenter UI test report

Run date: 2026-10-25. Headless Edge against the dev server (localhost:3000) and the real `prisma/dev.db`. Backup taken first: `prisma/dev.db.backup-before-qa`. Nothing in the code was changed.

Excluded by request: email and push notifications, the AI assistant, backup and restore, semantic models and document settings, uploads. Intake was only load-tested.

## Result in one paragraph

No data loss or corruption found (0 D findings). Every delete and cascade was checked against the database and removed exactly what it should. After the run, `PRAGMA integrity_check` returns ok and `foreign_key_check` returns 0 violations. The bugs are in how dates, bad input and small screens are handled: 32 wrong-behavior findings, about 46 confusing-UX findings and about 38 nits across nine agents.

## What was run

| Agent | Area | Mode | D | W | U | N |
|---|---|---|---|---|---|---|
| assets | Equipment, vehicles | parallel | 0 | 4 | 9 | 3 |
| places | Properties, rooms, people, health | parallel | 0 | 6 | 7 | 7 |
| upkeep | Maintenance, records, warranties, providers | parallel | 0 | 6 | 5 | 6 |
| money | Insurance, costs, dashboard | parallel | 0 | 8 | 7 | 4 |
| surfaces | Notifications, search, reports, navigation, 404s | parallel | 0 | 2 | 7 | 4 |
| layout | 32 pages x 4 sizes x light/dark, all dialogs | parallel, read-only | 0 | 1 | 2 | 3 |
| layout2 | Re-check of overflow inside `main` (phone, tablet) | read-only | 0 | 0 | 5 (U/N mix) | |
| access | Users, roles, USER account, login, appearance | serial wave | 0 | 4 | 6 | 4 |
| globals | Features, regional, property filter | serial wave | 0 | 1 | 3 | 7 |

Parallel agents shared the one database, so each used its own `QA-<name>` records and asserted on those, never on global totals. The agents that change global settings (features, regional, users) ran after the first wave, and globals restored every setting it changed.

Screen sizes: 375 (phone), 768 (tablet), 1280 (desktop), 1920 (wide). Layout checks also covered dark theme and both sidebar states.

## What held up

- Equipment delete removes exactly 4 rows (itself, one record, one warranty, one schedule). Vehicle delete removes 5 (the same plus its policy link). Property, policies and neighbors survived.
- Property, room, person (with all health data), provider, condition and policy deletes all behaved as the schema says. Rooms keep their name in equipment `location` when a room is deleted.
- Complete on a schedule creates one service record with the right cost and date, even on a double-click.
- Planned spend matched five test reminders to the cent. Property totals roll up equipment correctly.
- Turning Health, Rooms or the Equipment tab off and on changed no rows (a hash of every table matched before, during and after).
- Changing currency, units and date format never altered stored numbers.
- Property filter counts matched an independent database count for all 12 properties on every filtered page. Bad cookie values fell back safely.
- Login, forced password change, role guards, session end after password change or user delete, and per-device appearance settings all worked. Admin actions are guarded on the server.
- Dark theme had no contrast pair under 3:1. Dialogs fit at every size and close on Escape.

## Findings grouped by cause

These are the 32 W findings and most of the U findings, folded into the shared causes. Fixing the first four removes most of the list.

### 1. Date-only values shown a day early (US Eastern)

Dates are stored as UTC midnight. About 18 `fmt.date(...)` calls omit `{ utc: true }`, while 42 others pass it. Entered Nov 24 displays as Nov 23.

- Affected displays: equipment installed and purchased, vehicle and property purchased, warranty purchase and expiry, maintenance next due and last completed, snooze dates, room panel due dates.
- A warranty that expires today shows "Expired" and leaves the dashboard counts.
- Cost periods use local getters in `lib/costs.ts`, so a record on the first or last day of a month or year lands in the neighboring period. Tiles, year filter, daily bars and the dashboard Spending card are all off by those records.
- Next-due math drifts across daylight saving time: completing 2026-10-25 on a 30-day schedule stores a time that shows as Nov 23.
- The Add Record dialog prefills the UTC date, so after about 8 pm US Eastern it prefills tomorrow.

Only confirmed for UTC-4. By the code it should not occur at UTC or east of it.

### 2. Money and number fields have no sane bounds

- Negative costs accepted on service records. Negative vehicle price accepted (equipment refuses it).
- Costs of 1e21 and 1e30 saved. They pushed Records, Costs and dashboard totals to $1e30 (the upkeep agent deleted those records).
- Years 0202, 0001 and 275760 accepted. One record dated 0202 broke the costs page (All-time bars became years 790 to 801, the monthly average dropped from $717 to $0.85). Completing a schedule on 9999-12-31 stored a malformed date that sorted first.
- Interval and refill fields accept 99999999999, then the next action returns HTTP 500.
- A warranty can have a purchase date after its expiry date. Insurance validates this pair, warranties do not.
- Names have no length limit (a 400-character user name and a 334-character policy name saved).

### 3. Failures that tell the user nothing

- Server-side validation errors (year 1850, negative price, square feet 1500.5) show only "Please fix the errors and try again." with no field marked. The server sends field errors, the dialogs drop them.
- Silent HTTP 500s with a stuck dialog: reminder picker with 99999999 days, medication Refilled with a huge interval, completing a schedule with a huge interval, second click on Delete schedule, saving an edit for a property deleted in another tab.
- Deleting a user who has ever created a service record, observation, attachment or inbox item returns 500. Those foreign keys do not cascade, so such an account can never be deleted. Nothing is lost, but the admin gets no message.

### 4. Small screens

The page itself never scrolls sideways, but `main` does, so a page-level check misses it. The first layout pass reported a pass here and was wrong. layout2 measured `main` directly.

- Detail pages for equipment, vehicles, properties and people: the action buttons keep full width beside the title. At 375 px `main` is 542 to 770 px wide and "Report" and "Download all files" are off screen. Tablet with the sidebar open fails the same way except on vehicles.
- Tab strips on equipment, properties and vehicles have no `overflow-x-auto` (people has it).
- All four report pages overflow the document at 375 px.
- Equipment list toolbar ends 5 px past the edge.
- Insurance Add Policy dialog: a property label with a long unbroken name is 1612 px wide in a 343 px dialog.
- Users tab: the Actions column is clipped at 375 px, so an admin on a phone cannot reset or delete users. A long name pushes every row's controls out of reach.
- A 5000-character note grows the textarea to 1800 px and the Add Record button leaves the screen.
- Notifications "Mark all read" is clipped at 375. The header search box shrinks to "Sea" at 768.
- Most tap targets on phone are under 40 px (menu 32, view toggles 28, premium delete 24, help icons 16).
- Huge test values make the cost tiles unreadable at phone width. Edge case.

### 5. Hydration error on the dashboard

`initialsOf()` in `lib/asset-visuals.ts` takes `parts[0][0]`, which splits an emoji. The server renders U+FFFD, the client keeps the lone surrogate, and React rebuilds the tree. It shows as "Q" plus a replacement character on a property tile and as a console error on every dashboard load while a name ending in an emoji exists. Taking the first code point (`[...s][0]`) fixes it.

### 6. Other behavior bugs

- Search treats `_` and `%` as wildcards. It only widens results.
- Emails are unique case-sensitively, so `A@x.test` and `a@x.test` are two logins.
- Clicking a notification on `/notifications` does not mark it read (the bell does).
- Adding a service record does not update a vehicle's mileage, but completing a reminder does.
- JPY: cost per mile shows ¥0 for a $0.15 per mile rate (rounding to whole yen).
- Rooms off: room names still appear as equipment "Location".
- Property filter on: providers stay listed with 0 visits and $0.00. Add Equipment does not preselect the selected property.
- Future-dated records count in All time and the monthly average but not in the charts.
- Provider search results link to the providers list, not the record. Searches that reduce to nothing ("the", "&", one character) say "Nothing matched".
- Form labels' `for` ids do not match input ids in help-popover dialogs (labels do not focus fields).
- Coverage amounts show whole dollars, premiums show cents. Premiums cannot be edited, only deleted and re-added.
- Double-clicking Create User shows a spurious failure toast. Backup API routes return 401 to a USER where 403 fits.

## What was not tested

- Attachment and inbox cascades on delete (need uploads). The user-delete 500 on those two tables comes from the schema, not a run.
- Time zones other than US Eastern.
- Row "More actions" dialogs and delete confirmations at phone width, in-between sizes, landscape, print layout beyond one report type per size, the 10 other themes.
- The assistant card observation edit and undo, chart hover tooltips under the property filter, deleting a property that is in the cookie, the login throttle limits.

## Test data left behind

- Many `QA-*` properties, equipment, vehicles, people, records, reminders, warranties and policies. They add about $1,247 to All time and about $13 to real 2025 and 2026 totals. Filter by name `QA-` to find them.
- QA user accounts (one admin) with their passwords written in `details/access.md`. Delete them if this database is ever reachable from outside.
- Selecting Maple under the property filter hides other vehicles and people while `QA-globals Truck` and `QA-globals Person` are linked to it. That follows the linked-only rule.
- `RegionalSettings` now has a row with the defaults. All notifications were marked read.

## Where the detail is

Per-agent reports with coverage tables, repros and screenshot names are in `qa-report/details/`. Screenshots (55 MB) and scripts are in the session scratchpad: `C:\Users\michael.dazzo\AppData\Local\Temp\claude\C--git-home-center\a9a95277-7069-4806-b8b3-f6b58894a4ca\scratchpad\qa\`.
