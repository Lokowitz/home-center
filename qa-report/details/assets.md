# QA results: assets (Equipment and Vehicles)

Scripts: scratchpad\qa\assets\*.cjs. Screenshots: scratchpad\qa\shots\assets-*.png. The dev server was slow at times (a create took over 1.5 s); I waited on toasts and the DB instead of fixed delays. One lost write came from closing the browser before the request finished (my script's fault, not the app's).

## 1. Coverage

| Feature or flow | desktop | phone | result | notes |
|---|---|---|---|---|
| Equipment list: cards, small cards, list, view persists after reload | yes | load + overflow only | pass | view mode cookie works |
| Equipment list sort (Name, Property, Category) and paging (25 per page, page 2) | yes | no | pass | card views have no sort and no paging |
| Equipment/Vehicles list search or filter | n/a | n/a | not present | no search, filter or status on either list. Only the global "Search everything" bar and the property filter exist |
| Equipment create (all fields, property) | yes | yes (HVAC, "Save + add reminders") | pass | DB row matches input |
| Equipment create: empty submit, cancel then reopen, duplicate name, double-click submit | yes | no | pass | double-click made one row. Duplicate names allowed, and the UI can't tell the two rows apart |
| Equipment edit (detail Edit, list menu Edit), clear price / replacement / life to null, Counts As, property to none and back | yes | no | pass | cleared values saved as null, not 0 |
| Equipment validation: life 0, 12.5, 101 | yes | no | pass | stopped by browser tooltip, no app message (matches the checklist) |
| Equipment validation: negative purchase price | yes | no | fail (U) | see U1 |
| Equipment room link by Location text, then property change | yes | no | pass | room linked and text cleared. After a property change, roomId null and the text kept |
| Equipment special chars, emoji, 235-char name, script tags in notes | yes | no | pass | round trips exactly, rendered as text |
| Equipment detail, tabs, reload, Escape closes dialog, back/forward after save | yes | yes (load) | pass with bugs | W1, U4 |
| Equipment service / warranty / maintenance add through the UI | yes | no | pass | rows verified in DB |
| Plan replacement, cancel (no row), save (one row), Report page, Download zip | yes | no | pass | zip returned 200 |
| Equipment reminders page: Skip returns to the Maintenance tab | yes | yes | pass | |
| Equipment delete (list menu, confirm text, dismiss then accept) | yes | no | pass | see section 2 |
| Equipment "link to provider" | n/a | n/a | not present | Equipment has no provider field in the schema or the UI |
| Vehicle list: three views, sorts (Year, Mileage, Make, VIN), persist | yes | load + overflow | pass | |
| Vehicle create (all fields, property, units), "Save + add reminders" | yes | yes | pass | |
| Vehicle validation: empty, year 1850, 99999, 2021.5, mileage -5 and 12.7 | yes | no | pass, U2 | rejected with a generic toast only |
| Vehicle validation: negative purchase price, huge price, huge mileage | yes | no | fail (W2) | saved |
| Vehicle edit: Hours/Miles switch, clear price/mileage, property to none, long and special VIN | yes | edit dialog opens, Save reachable, Escape closes | pass | label switches to "Current Hours" |
| Vehicle insurance link and unlink in the detail Edit dialog (link 2, unlink 1, unlink all, edit other field) | yes | no | pass | other vehicles' links untouched (checked the join table) |
| Vehicle insurance in the list-menu Edit dialog | yes | no | n/a | the list dialog has no Insurance section (U5) |
| Vehicle reminders page: defaults, interval validation, add 2, revisit shows "Already has a reminder" | yes | yes (layout) | pass | U6 |
| Vehicle service / warranty / schedule add; complete reminder with mileage, edit and delete service record | yes | no | pass with bugs | W1, W3, W4, U7 |
| Vehicle delete | yes | no | pass | see section 2 |
| Archived or status handling | n/a | n/a | not present | neither asset type has an archive or status |
| Property filter: empty list text, unassigned items stay visible | yes | no | pass | not-found page for a bogus id reads fine |
| Phone width (375): lists, details, dialogs, reminders page | | yes | pass with bugs | U3, U6. `overflowX` stays false because the clipped content sits inside a scroll container |
| s.problems (console, page errors, 5xx) | all runs | all runs | one page error | N1 |

## 2. Delete tests (exact diff)

I snapshotted every row id in 15 tables, plus the policy-to-vehicle join table, before and after. I compared by id because other agents write at the same time.

Equipment (QA-assets Test Mower, with 1 service record, 1 warranty, 1 maintenance schedule, linked to Lake Cabin):
- Confirm text: `Delete "X"? This will also delete all associated records.` Dismiss deleted nothing. Accept removed exactly 4 rows: the Equipment row, its ServiceRecord, its Warranty and its MaintenanceSchedule.
- Nothing else was lost. A second equipment row with the same name survived. The property, the other assets' records and the policies are untouched.
- No orphan Attachment or InboxItem rows point at the deleted id. I could not test attachments (uploads are out of scope).
- Reloading the deleted detail URL gives the "Not found" page.

Vehicle (QA-assets Test Truck, with 1 service record, 1 warranty, 1 schedule, linked to Lake Cabin and to the Progressive policy, which Work Truck also uses):
- Exactly 5 rows removed: the Vehicle, its ServiceRecord, Warranty, MaintenanceSchedule and its policy-join row.
- The Progressive policy survived, Work Truck's link to it survived, and the property survived.
- The service record added by another agent during the run was not touched.

## 3. Findings

### D (data loss or corruption)
None found. Deletes and the insurance unlink are exact.

### W (wrong behavior)

W1. Date-only fields show one day early on several pages (US Eastern machine, server in the same zone).
- Repro: Add equipment with Purchase Date 2024-05-01 and Install Date 2024-05-02. Open its detail page.
- Expected: Purchased May 1, Installed May 2.
- Actual: Purchased Apr 30, 2024, Installed May 1, 2024. The edit dialog and the Report page show the right dates.
- The same happens for warranty Purchased/Expires (entered 2027-05-01, shows Apr 30, 2027), maintenance Next Due and Last Completed (entered 2027-01-15, shows Jan 14), and the vehicle detail "Purchased" (2021-06-15 shows Jun 14).
- Cause: these pages call `fmt.date(d)` without `{ utc: true }`, but dates are stored as UTC midnight. Service records pass `utc: true`, so they are correct.
- Files: components/warranties/warranty-list.tsx, components/maintenance/maintenance-list.tsx, app/(app)/assets/equipment/[id]/page.tsx, app/(app)/assets/vehicles/[id]/page.tsx.
- Equipment age and "days left" use other code and looked right.

W2. Vehicle purchase price, mileage and cost have no bounds.
- Repro: Edit a vehicle and enter Purchase Price -100. It saved -100. Price 1e12 and Mileage 99999999999 also saved.
- Expected: refused, as equipment refuses a negative price.
- Actual: stored. The vehicle's cost panel then reads "$99,999,999,999.00" and stretched the phone layout.
- Cause: lib/vehicle-input.ts has no `.min(0)` on `purchasePrice` and no upper bounds.

W3. Service record cost accepts negatives.
- Repro: Add service record with Cost -20. It saved -20, which lowers the cost totals.
- Expected: refused. Mileage -3 is refused, so cost is inconsistent.
- A huge cost (99999999999) saved too.

W4. Adding a service record with a higher mileage does not update the vehicle's current mileage, but completing a reminder does.
- Repro: Vehicle at 45,000 mi. Add service record with Mileage at Service 45,500. Current mileage stays 45,000. Completing a reminder at 1,200 mi on a vehicle at 1,000 raised it to 1,200.
- Expected: same behavior in both flows (or neither).

### U (confusing UX)

U1. Server-side validation failures show only a generic toast.
- Negative equipment price, vehicle year 1850, 99999 or 2021.5, vehicle mileage -5 or 12.7, service cost/mileage: the dialog stays open with "Please fix the errors and try again." and no message on the field.
- The server returns field errors; the dialogs never display them.

U2. Warranty accepts an expiration date before its purchase date (purchase 2025-01-01, expiry 2020-01-01). It saved and shows "Expired". Vendor phone accepts "abc 123 <b>".

U3. Phone detail pages: the header buttons are clipped.
- On the equipment detail at 375 px, "Report" and "Download all files" are off the right edge and the title squeezes to a narrow column. The vehicle page is the same, and the page can be pushed sideways. The tab row is cut off ("Maintenance Remind...").
- Screenshots: assets-phone-_assets_equipment_cmvo6y9j60063dgop1ebm6.png, assets-veh-maint-phone.png.

U4. Form labels are not linked to their inputs. The label `for` id doesn't match the input id (`_r_i_-form-item` vs `_r_l_-form-item`), so clicking a label does not focus the field and screen readers lose the name. It affects every dialog that uses the help-popover label (equipment, vehicle, warranty and service dialogs all checked).

U5. The vehicle list's Edit menu opens a dialog without the Insurance list. Insurance links can only be changed from the detail page's Edit. The vehicle list dialog also hides the property select unless the property switch is on.

U6. Phone: the "mi" unit on the vehicle default-reminders page is cut off at the card edge (assets-veh-reminders-phone.png).

U7. Editing a recurring reminder and clearing both the days and miles saves it as a one-time reminder with no message, while the default-reminders page refuses a blank interval. The result is valid ("Once") but surprising.

U8. Vehicle detail does not show the vehicle's property or its purchase price in the side list (equipment shows both). Equipment's Price tile shows a rounded value ($500 for 499.99).

U9. Two rows with the same name can't be told apart in the list menu, and the delete confirm names only the title.

### N (nits)

N1. One React page error was seen once and not reproduced: `NotFoundError: Failed to execute 'insertBefore' on 'Node'`. It happened in a long run on the vehicle detail page: delete a service record through confirm, open and cancel the warranty dialog, switch tabs, edit a schedule. Three repeats of the schedule edit plus the "clear both intervals" flow gave no error.

N2. A deleted or unknown id returns HTTP 200 with the "Not found" page (the same for /reminders). Probably a framework streaming effect.

N3. Equipment and vehicle lists have no search or filter, and the card layouts cannot be sorted.

## 4. QA records left behind
- Equipment: "QA-assets Test Mower" (id cmvo6def1002mdgoph6gfe0zh; Lake Cabin, location text "QA-places Study", reversed-dates warranty "QA-assets Mow Warranty (reversed)", notes "back-test"). "QA-assets Phone Furnace" (id cmvo6y9j60063dgop1ebm6tx6; HVAC, expected life 15, replacement cost 7000, one "Replace QA-assets Phone Furnace" schedule).
- Vehicle: "QA-assets Phone Van" (id cmvo6rsx4004udgoplzpim11x; schedules "Oil change" and "Tire rotation" (both now one-time), service records "Oil change" (completed through the reminder), edge-case records "QA-assets Svc ..." (future date, 1850 date, 99999999999 cost, emoji title)).
- Consumed by the delete tests: the original QA-assets Test Mower with its records, and QA-assets Test Truck with its records.

## 5. Not tested
- Uploading files and attachments (out of scope), so delete cascades for attachment files and image folders are untested.
- Provider link on equipment and vehicles (no such field exists).
- Archive or status (not present).
- Non-ADMIN role (no USER account exists).
- Notifications, assistant and backup flows (out of scope).
- Vehicle huge-number layout at desktop beyond the cost panel; the multi-user timezone case (server and browser were both US Eastern).
