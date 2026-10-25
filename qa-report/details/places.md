# QA report: places (Properties, rooms, People, health)

Run against dev.db on localhost:3000, headless Edge, admin account. Scripts are in scratchpad\qa\places\. Dev server was slow to compile on first hit of a route, so several checks were re-run with longer waits (no product bug in that).

## 1. Coverage

| Feature or flow | desktop | phone | result | notes |
|---|---|---|---|---|
| Property create (all fields, special chars, emoji, 5k notes) | yes | yes | pass | DB verified. Double-click creates one row. |
| Property create validation (empty name/address) | yes | - | pass | Inline messages. |
| Property create with bad numbers (year 1700, sqFt -5/1500.5, price -1/0) | yes | - | FAIL (W1) | Generic toast only, no field shows the error. |
| Property edit (prefill, clear all optional fields, Esc discards) | yes | - | pass | Cleared fields saved as NULL. |
| Property purchase date display | yes | yes | FAIL (W2) | Shown one day early. |
| Property insurance link and unlink (edit dialog) | yes | - | pass | Join rows verified; only the ticked policy changes; other policies untouched. |
| Property delete with rooms, equipment, vehicle, person, policy, reminders, service record | yes | - | pass | See section on delete below. |
| Property list: card sizes, list view, sort by Price, row click, actions menu | yes | yes | pass | |
| Property detail tabs: Service, Rooms, Equipment, Maintenance (page load, tab params, bogus tab, bogus open id) | yes | yes | pass | Bad id shows "Not found" page with HTTP 200 (N6). |
| Property Report page, Download all files (zip) | yes | - | pass (load only) | /reports/properties/[id] 200, zip 200. |
| /assets/properties/[id]/reminders template picker | yes | - | partial | Valid add works, duplicate title is flagged, dblclick adds once, days 0 and -5 refused with a message. Days 99999999 gives HTTP 500 (W3). |
| Save + add reminders from Add Property | yes | - | pass | Lands on picker. |
| Room create (all fields, paints, flooring date) | yes | yes | pass | Double-click creates one room. Browser blocks negative area. |
| Room edit (paints add/remove, rename, tabs) | yes | yes | pass desktop, FAIL phone (W4) | |
| Room with equipment: location text links when room is created (case-insensitive) | yes | - | pass | Matching ignores case and outer spaces. |
| Equipment added from room dialog (stacked) | yes | - | pass | Location defaults to the room, Esc closes only the top dialog. |
| Room delete with linked equipment and a room-tagged service record | yes | - | pass | equipment.location becomes the room name, roomId NULL; service record kept with roomId NULL; paints removed, no orphans. |
| Room rename keeps equipment linked | yes | - | pass | |
| People create (all fields, provider, property, future DOB, double-click) | yes | yes | pass | |
| People edit (clear DOB, change property, insurance ticks) | yes | - | pass | |
| Person insurance link/unlink in edit dialog | yes | - | pass | Unticking Delta for the QA person left Alex and Sam's links untouched. |
| Conditions create/edit/delete, status/resolved-date rules, warning text | yes | yes | pass | Status switch clears resolved date as the checklist says. |
| Medications create/edit/delete, prescriber and condition links, past/current split | yes | yes | pass except W5 | |
| Medication "Refilled" | yes | yes | pass with valid interval, FAIL with huge interval (W5) | Next date = today UTC + interval, verified in DB. |
| Medication list/timeline/before-after views | yes | - | pass (load only) | |
| Allergies create/edit/delete, sidebar callout | yes | - | pass | |
| Immunizations create/edit/delete, next-due before given refused | yes | - | pass | |
| Observations create/edit/delete, 60-char limit, 1-week limit, tag cleanup, condition link | yes | - | pass | Assistant-card edit/undo (applyObservationEdit) is assistant territory, not tested. |
| Person delete cascade | yes | - | pass | See below. |
| Provider delete with person/condition/medication links | yes | - | pass | All three set to NULL, records kept. |
| Condition delete with linked medication | yes | - | pass | Medication kept, conditionId NULL. |
| Delete confirm cancel keeps data (all health types) | yes | - | pass | |
| Stale edit of a record deleted elsewhere | yes | - | FAIL (W6) | |
| Person Medical summary page, Download all files | yes | - | pass (load only) | |
| People list (cards, list view), 404 for bad id | yes | yes | pass | |
| Dates and units | yes | yes | partial | Health dates use UTC and are right. Property purchase date is wrong (W2). Area label "Square footage" and ft2 fine; m2 setting not changed (global). |
| Phone (375) key flows | - | yes | partial | Everything works, but property and person detail pages are wider than the screen (W4). |

Delete results (all verified in DB, neighbours checked):
- Property delete (QA House with 2 rooms, 3 equipment, 1 vehicle, 1 person, 1 home policy, 2 reminders, 1 service record): property, rooms, room paints, property reminders and service record deleted. Equipment kept with propertyId NULL and location = room name (Fridge "qa-places PANTRY", Oven and Toaster unchanged). Vehicle kept, propertyId NULL. Person kept, propertyId NULL. Policy kept, only the join row removed. Alex, Sam and the bystander person unchanged (updatedAt identical).
- Person delete (1 condition, 1 medication, 1 allergy, 1 immunization, 1 observation, 1 visit, 1 reminder, 2 policy links): all gone, join rows gone, 8 policies still exist, Alex/Sam/bystander row counts and policy links identical before and after.

## 2. Findings

### D (data loss or corruption)
None found.

### W (wrong behavior)

W1. Property form shows no field-level errors for server-side number rules.
- Repro: Properties > Add Property, name and address filled, Square footage 1500.5 (or -5), Purchase price 0 or -1, Year built 1700, click Add Property.
- Expected: message under the bad field (rooms do this).
- Actual: red toast "Please fix the errors and try again." only, nothing marked. The form ignores `result.error` (property-form-dialog.tsx onSubmit). Number inputs here have no min, so the browser does not catch it either. Screenshot: places-prop-badnums.

W2. Property "Purchased" date is one day early on the detail page.
- Repro: Add a property with Purchase Date 2020-02-29 (also 2021-01-31). Open it.
- Expected: Feb 29, 2020. Actual: "Feb 28, 2020" (Jan 30, 2021 for the second). The edit form still shows 2020-02-29. `fmt.date(property.purchaseDate)` in app/(app)/assets/properties/[id]/page.tsx has no `{ utc: true }`; the date is stored at UTC midnight and the server runs in America/New_York. Health pages pass utc:true and are correct (Born Feb 29, 1980). Likely the same on vehicles and equipment pages (not checked, other agents' scope).

W3. Reminder picker returns HTTP 500 for a huge interval.
- Repro: /assets/properties/[id]/reminders, set "Replace HVAC filter" days to 99999999, click Add.
- Expected: "Check the intervals" message. Actual: HTTP 500 (PrismaClientValidationError on maintenanceSchedule.createMany, invalid date), no toast, nothing saved. Values 0 and -5 are handled properly.

W4. Phone width: property and person detail pages are wider than the screen.
- Repro at 375x812: open Lake Cabin (or any property), or Alex Rivera.
- Expected: content fits, buttons wrap. Actual: `main` scrolls sideways (scrollWidth 742 on property, 765 on Maple Street House, 664 on both people). The title is cut off, the Edit/Report/Download row has `shrink-0` buttons that sit at x=107..445, and the service table is 746 wide. Person page: "Medical summary" and "Download all files" sit at x=335..664. With a long unbroken name or address the Edit button lands at x=2812 and the address runs out of its card (places-phone-propdetail). Also the Room edit dialog (existing room) clips its second column (Level, Dimensions, Flooring product) at the right edge on phone (places-phone-roomedit). The qa-lib `overflowX` helper does NOT detect this because the scroll is inside `main`; other agents may be reporting false "no overflow".

W5. Medication refill interval has no upper limit; "Refilled" then returns 500.
- Repro: person > Medications > Add, "Refill every (days)" 99999999999, save (saves, Int stored as 99999999999). Click Refilled.
- Expected: field rejected on save (observations cap duration at a week; allergy/immunization have no such field). Actual: HTTP 500 PrismaClientValidationError on medication.update, no toast, row left as is. The same row shows Next refill "—". Schema `optionalWholeNumber` has no max.

W6. Saving an edit for a record deleted in another tab gives HTTP 500 and a stuck dialog.
- Repro: open property edit dialog, delete the property from the list in a second tab, click Save Changes.
- Expected: "This property no longer exists" and close. Actual: HTTP 500 (Prisma P2025 on property.update), no message, dialog stays open. Nothing is resurrected. Not tried for people but updatePerson has the same shape (no existence check).

### U (confusing UX)

U1. Room "Add paint" pre-fills a surface name (Walls, Ceiling, Trim). A row you never fill in is still saved as a paint with only the surface ("Trim" with no color), because blank detection looks at the pre-filled surface. Clear the surface to drop it.

U2. Deleting a room silently removes the room tag from its service records and reminders (roomId NULL; they stay on the property). The confirm text only mentions equipment.

U3. Property delete confirm says "Equipment in it is kept." but does not say that vehicles and people linked to it are unlinked (they are, SetNull), nor that its reminders, service records and documents go.

U4. A person's linked Property is saved but never shown on the person detail page (only visible in the edit dialog).

U5. Duplicate names are accepted everywhere: two properties "QA-places Dup", two rooms whose names match case-insensitively ("qa-places  pantry" and "qa-places PANTRY"). With two same-name rooms, equipment location text auto-links to neither of them by design, which can confuse.

U6. Observation dated far in the future (2999-12-31) is accepted, and the Year-at-a-glance calendar then shows a "2999" year. Birth dates of year 0001 or 1850 are accepted (Born "Jan 1, 1 (2025)", age 176). Only "future DOB" is refused.

U7. Person detail tab strip is cut off at 1280 wide ("Allergie..." clipped, needs scroll); fine functionally.

### N (nits)

N1. Property purchase price 1e30 accepted and stored (no upper bound).
N2. The person photo placeholder shows only the first word of the name ("QA-places").
N3. After Save in the room dialog, the first save took more than 1.5 s on dev (toast appeared late). Dev-only.
N4. Medication "Refilled" counts from today's UTC date, so after about 20:00 US Eastern the next date can be computed from tomorrow's date. Not verified at that hour; only read in code (markMedicationRefilled).
N5. Non-existent /reports/people/[id] logs "Encountered a script tag while rendering React component" in the console (global-not-found page, dev warning).
N6. /assets/properties/nope and /assets/people/nope show the friendly Not found page but with HTTP 200, not 404.
N7. Property form number inputs accept "e" notation (1e30).

## 3. QA records left behind
- Properties: `QA-places Prop "A" <b>&'é 🏠`, `QA-places DblClick`, `QA-places Phone House WWWW...` (very long name), two `QA-places Dup` (one with price 1e30), `QA-places House Keep` (room `QA-places Study`, equipment `QA-places Lamp`).
- Rooms: `QA-places Study` (House Keep), `QA-places Phone Room` (Phone House).
- Equipment: `QA-places Lamp` (in House Keep), plus orphaned by the delete test: `QA-places Fridge`, `QA-places Oven`, `QA-places Toaster` (no property, location text only).
- Vehicle: `QA-places Car` (no property after delete test).
- People: `QA-places Bystander` (allergy `QA-places Bee`, DOB 2000-02-29), `QA-places Phone Person`.
- Deleted by my own tests: property `QA-places House`, person `QA-places Pat` with all health data, provider `QA-places Dr. Prescriber`, property `QA-places Stale`, the health rows on Phone Person, and a first test property row for the double-click check was kept (`QA-places DblClick`).
- Shared policies State Farm and Chubb were linked and unlinked on my QA properties; final links match the starting state (State Farm to Maple Street House only). Blue Cross and Delta Dental were ticked on and then removed from my deleted QA person; Alex and Sam links unchanged.

## 4. Not tested
- Health switched off, Rooms feature off, property filter, USER role (global or cookie scopes owned elsewhere or not available).
- File uploads and attachments on rooms, conditions, observations (out of scope rule).
- Assistant-card observation edit/undo (applyObservationEdit, deleteObservationIfUnchanged): assistant territory.
- Person-level Reminders tab and Visits editing beyond creating one of each (maintenance/records agents).
- m2 and km unit rendering (changing Regional is off limits).
- Property and person at tablet and wide widths.
