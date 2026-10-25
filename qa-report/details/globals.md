# QA globals: Features, Regional, Property filter

Settings changed and restored (try/finally, checked in DB after each run):
- FeatureSettings original: health 1, rooms 1, equipmentTab 1, propertyFilter 1 (filter was already ON). Final: identical.
- RegionalSettings original: NO row (code defaults). Every run restored USD / MILES / SQFT / MDY_SHORT / 12h, so a row now exists with default values (same behavior, but the table is no longer empty).
Scripts and raw output: scratchpad\qa\globals\ (feat.cjs, reg.cjs, reg2.cjs, reg3.cjs, pf*.cjs, out\*.json|log).

## 1. Coverage
| Flow | desktop | phone | result | notes |
|---|---|---|---|---|
| Features: Health off (sidebar, dashboard, lists, search, notifications, costs, maintenance, insurance, reports, direct URLs) | yes | no | pass | People/Providers links gone; /providers/[id] 404; /reports/people/[id] 404; people/providers list pages show "Not found" body with HTTP 200 (N1). Dashboard People card, People cost tile, 6 person service records, 2 person reminders, 4 health notifications, medical/dental policies and person names on life policy all hidden. |
| Features: Rooms off | yes | no | pass with U1 | Rooms tab gone, ?tab=rooms falls back to Service, room search hits and ROOMS report section gone. Room name still shown as equipment Location (U1). |
| Features: Equipment tab off | yes | no | pass | Tab gone on property; ?tab=equipment falls back; /assets/equipment and sidebar stay (by design). |
| All three off together | yes | no | pass | Union of the above, no extra effects. |
| Off/on keeps data | yes | n/a | pass | md5 of every row of every table (except Notification/Settings/User) identical across base, each off state and restored; only differences were rows added concurrently by other agents. |
| Regional: currency EUR/JPY/GBP/USD, distance mi/km, area ft2/m2, 5 date formats, 24h | yes | no | pass with W1,N2,N3 | About 28 pages x 3 non-default states regex-scanned for default-format leaks (dollar sign, "Mon d, yyyy", mi, ft2, AM/PM): none, apart from N2. Vehicle pages were re-checked separately (first crawl used a wrong vehicle id). |
| Regional: forms | yes | no | pass | Vehicle/property/equipment add+edit, service record, reminder dialogs, insurance add/premium/edit, warranty, records, providers: labels switch (Cost (EUR sign), Current Distance, Repeat Every (km), Floor area (m2)). No dollar sign or mi left in 12 dialogs under EUR/km. Input values are the raw stored numbers. |
| Regional: stored numbers not converted | yes | n/a | pass | Maple sqFt 2400 and Work Truck currentMileage 96300 unchanged before/during/after (DB peek); full-table fingerprints identical after 4 setting changes. UI says "Changing units relabels existing values; it does not convert them." (Area field). Vehicle page shows 96,300 km under KM. |
| Regional: date format incl UTC-sensitive | yes | no | pass | Alex DOB (UTC midnight) renders 12/03/1984, 1984-03-12, correct day in America/New_York. No page ignored the setting in 3 formats. Chart axis labels stay "Oct 2026" style (fixed). |
| Property filter: counts per property (12 properties) | yes | no | pass | For every property and for All: properties, equipment, vehicles, people, records + total, warranties, schedules, insurance, notifications (active and dismissed) equal an independent DB computation. Dashboard warranties and due(30d) match too (ALL 16/12, Maple 9/5, Lake 5/5, Cedar 2/3). |
| Property filter: linked-only rule | yes | no | pass | Created QA-globals Truck and QA-globals Person linked to Maple: Maple then shows 1 vehicle, 1 person; Lake/Cedar/test (nothing linked) show all 9 vehicles, 7 people. |
| Unassigned equipment shows everywhere | yes | no | pass | 4 unassigned items visible under Maple. |
| Hidden detail pages and reports | yes | no | pass | Vehicle, person, equipment, property pages and all 4 report types show "Hidden by the property filter..." with "Show all properties"; the button clears the cookie and the page renders. |
| Persistence, navigation, reload | yes | partly | pass | Cookie hc-property survives reload and client navigation. Phone: trigger is icon-only 36x28, no horizontal overflow. |
| Bad cookie values | yes | no | pass | unknown id, "all", "../../etc", "a%3Bb", 100 chars, id plus space: all fall back to All properties, no 5xx. A truly deleted property not separately tested (same null path as an unknown id). |
| Setting off clears effect | yes | no | pass | Off with cookie present: 12 properties, 9 vehicles, no dropdown, hidden pages render normally. On again: old cookie takes effect again (selection is remembered). |
| Accent cue | yes | no | pass | svg rect.property-cue first appeared at 120 s with Maple selected. |
| Filter: visible-text leak scan of hidden names | yes | no | pass | 15 pages under Maple: no hidden property/equipment/vehicle/person name in visible text. |
| Filter + insurance edit keeps hidden links | yes | no | pass | Policy covering Maple + Work Truck (hidden) and a life policy covering Alex (hidden) + QA-globals Person: edited under Maple, the form offered only visible links, DB kept the hidden vehicle and both members. |
| Search under filter | yes | no | pass | "Alex" 1 -> 0 matches; "Work Truck" only matches documents containing the word "Work". |
| Costs tiles/charts under filter | yes | no | pass | Maple ALL TIME $4,710.34 equals the DB sum of in-scope service records; spend-by-asset lists only Maple assets. Chart hover tooltips not exercised. |
| Features/filter flows at phone width (other than the trigger) | no | no | skipped | time |

## 2. Findings
No D findings. No W-risk (hidden but should show / shows but should hide) found in the filter or Health-off scopes.

W1 (low) Cost per distance rounds to zero in whole-unit currencies. Repro: Regional currency JPY, open Work Truck. Expected a usable cost per mile. Actual "JPY 0" for 0.15 per mile (money format uses 0 decimals for JPY). The rate becomes meaningless.

U1 Rooms off still exposes rooms. Repro: Rooms off, open property QA-places House Keep ?tab=equipment, or /assets/equipment. Expected: no room names. Actual: "Location: QA-places Study" from the room relation.

U2 Providers stay listed under the property filter with 0 visits and 0.00 spend (for example Dr. Maria Chen under Maple). Provider rows are not property-linked, so the list never shrinks.

U3 Equipment add dialog does not preselect the selected property (vehicle and person do once something is linked). It stays "Not assigned"; harmless because unassigned equipment shows everywhere.

N1 With Health off, /assets/people and /providers answer HTTP 200 with a "Not found" body, while /providers/[id] and /reports/people/[id] answer 404.
N2 /costs says "1 mileage-based reminder isn't included." in km mode (should follow the distance unit).
N3 Purchase price labels on property and equipment forms carry no currency, while vehicle/service/reminder labels show it. Inconsistent.
N4 The layout passes null to loadPropertyFilterChoices, so the dropdown lists every property even while one is selected (the helper's comment says only the selected one). Works fine, differs from the comment.
N5 /intake under the filter ships hidden people's names in the page payload (householdNames), not displayed. Not tested with Health off.
N6 "Per year owned" on the property cost panel changes with the clock (time based, expected).
N7 Regional save leaves a RegionalSettings row where none existed, and starts syncEntities in the background (semantic indexing, not tested).

## 3. QA records left behind
QA-globals Truck (vehicle linked to Maple), QA-globals Person (linked to Maple), QA-globals Carrier Home (home policy: Maple + Work Truck, plan "QA-globals edited under filter"), QA-globals Carrier Life (life policy: Alex + QA-globals Person, same plan text). While these exist, selecting Maple hides all other vehicles and people (linked-only rule). Delete or unlink them to restore the old behavior.

## 4. Not tested
Phone width for Features/Regional flows. Real deletion of a property while its id sits in the cookie. Assistant, push, email, backups, documents (out of scope). Health-off behavior of intake capture. A role=USER view of features (no such account). Chart hover tooltips.
