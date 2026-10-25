# QA upkeep: /maintenance, /records, /warranties, /providers

Scripts: scratchpad\qa\upkeep\*.cjs. Server actions were slow (3-5 s) during the run, so some early asserts needed longer waits; results below are from re-checked DB state.

## 1. Coverage
| Flow | Desktop | Phone | Result | Notes |
|---|---|---|---|---|
| Schedule create (interval, calendar months, once, vehicle miles) | yes | no | pass w/ findings | W2, U3 |
| Schedule validation (empty title, 0/neg/decimal interval, day 31, no months) | yes | no | pass | native min/max and toasts block them |
| Schedule edit, cancel, Escape, kind switch every/months/once | yes | no | pass | |
| Schedule delete (confirm dismiss/accept) | yes | no | pass | W4 on double-click |
| Complete: one record, cost/date/vendor/notes, double-click | yes | yes (saved, cost 4) | pass for record count | exactly 1 record on double-click |
| Next-due math: interval days (1, 10, 30, 90, 365), calendar, once, miles | yes | no | FAIL (W1b) | miles, once, calendar behave as the checklist says |
| Complete with "Add to service history" off | yes | no | pass | 0 records, schedule advances |
| Snooze 1d/1w/1m, unsnooze, skip (interval, calendar), once has no skip, pause/resume | yes | no | pass | toast date off by one (W1) |
| Template picker (/reminders): none checked, 0 days, double-click add, Skip | yes | overflow only | pass | N2 |
| /maintenance page: counts, sort, badges | yes | yes | pass w/ findings | page has no actions and no group headers (badges + sort only); U2 |
| Records: create, edit, clear cost, cancel, Escape, validation, delete (from asset page) | yes | add dialog opens only | pass w/ findings | W5, U1 |
| Records "Completes reminder" link | yes | no | pass | exactly 1 record, schedule advanced 11-10 to 11-20 |
| Records filters: q, asset, sort, page 999, junk params | yes | no | pass | N3 |
| Warranties create/edit/delete, expiry states, filters | yes | page load only | pass w/ findings | W1, N1 |
| Providers create/edit validation/delete | yes | page load only | pass | N5 |
| Provider delete only nulls links (visit, condition, prescription, person primary) | yes | no | pass | row counts of 11 tables unchanged except Provider -1; vendor text on the visit kept |
| Overflow at 375 on 6 pages | | yes | pass | no sideways page scroll |

## 2. Findings

### D
None found. Failed transactions rolled back (huge interval: no service record created).

### W
W1. Dates are shown one day early for maintenance and warranties (US Eastern). Repro: add a schedule with Next Due 2026-10-20; the row says "Oct 19, 2026" while the edit form says 2026-10-20. Same for Last Completed (complete 2026-10-25, row says Oct 24), warranty Expires/Purchase (enter Oct 24, list says Oct 23), and the skip toast. Cause: those cells call fmt.date(d) without { utc: true }; Records, health etc. use utc and show the right day. Places: components/maintenance/maintenance-list.tsx:231,239; app/(app)/maintenance/page.tsx:172,179; components/warranties/warranty-list.tsx:176,179; app/(app)/warranties/page.tsx:169; components/maintenance/snooze-menu.tsx:81.
W1b. Interval next-due drifts across daylight saving. completeSchedule does setDate(getDate()+n) in local time on a UTC-midnight date. Complete 2027-03-01 on a 30-day schedule: stored 2027-03-30T23:00Z, expected 2027-03-31. Complete 2026-10-25 on 30 days: stored 2026-11-24T01:00Z (no longer midnight), displays "Nov 23". Complete 2026-10-01 on 90 days: 12-30T01:00Z. Completions that do not cross a DST change are exact (365d, 10d, 1d). Skip uses the same pattern.
W2. Interval has no upper bound. Interval 99999999999 days saves; completing it throws Prisma "Invalid Date", HTTP 500, and the Complete dialog stays open with no toast. Nothing saved.
W3. Completing with date 9999-12-31 on a 1-day schedule stores a malformed date "+010000-01-01". Pages render it as "Dec 31, 9999" but SQLite string sort put it first on /maintenance. No range check on Complete date or record date (0001-01-01 accepted).
W4. Double-click Delete on a schedule: the second delete throws P2025 (HTTP 500 plus pageerror); the first works. deleteMaintenanceSchedule has no lookup guard (records and warranties do). Double-click delete on a record or warranty shows two "deleted" toasts (second returns "Not found", ignored).
W5. Service record cost accepts negatives (-50 saved) and 1e30. Records total, /costs and the dashboard then showed $1,000,000,000,000,000,000,000,000,000,000.00 and float noise ($9.999999999999999). Schedule estimated cost also accepted 9e30. The Complete dialog and schedule form have min 0; the record schema (z.coerce.number()) has none.
W6 (code reading only). updateServiceRecord writes createdById = session user, so editing reassigns the creator. Cannot show with one user.

### U
U1. A 5000-char note makes the record dialog's textarea grow to 1800 px; the dialog has no max height or scroll (overflow visible), so Add Record sits at y=1252 in an 800 px window and cannot be clicked. Shot: upkeep-rec-long.png.
U2. On phone /maintenance scrolls inside its card and shows only Status and Asset; the Task name needs a sideways swipe. Shot: upkeep-phone-_maintenance.png.
U3. A schedule with no repeat, date or mileage saves ("QA-upkeep NoRepeat") and never becomes due.
U4. Complete with an empty date gives only "Something went wrong."
U5 (code only). Default date in Complete and Add Record dialogs is toISOString() (UTC), so after about 8 pm Eastern "today" prefills as tomorrow. Not reproducible at test time.

### N
N1. A warranty expiring today shows "Expired" (midnight UTC at the start of the day).
N2. The template picker lets you tick a reminder marked "Already has a reminder with this name" and makes a duplicate.
N3. Records search treats "%" as a wildcard (q=% matched all).
N4. Warranty expiry before purchase date and junk phone are accepted.
N5. Duplicate provider names allowed; the delete confirm text does not mention the people's primary-care link (it is nulled too).
N6. Completing a set-months reminder early skips a cycle, and a second complete skips another (matches checklist wording).

## 3. QA records left behind
Equipment "Dishwasher": schedules QA-upkeep Interval30, NoRepeat, "Q's" (long weird title), Once, Cal, NoLog, CloseCheck, DST-spring, DST-fall, Yearly365; records QA-upkeep Rec1, RecCompletes, RecCompletes2, RecDec (0.005), RecZero, ToDelete, Daily1 x3 (dates 0001-01-01, 2099-01-01, 2026-11-01), plus completion records for the schedules above; warranties QA-upkeep W Expired/Today/30d/61d/1y and W Reversed. Vehicle Honda Civic: schedule QA-upkeep Tires and its record. Person "QA-upkeep Person" with QA-upkeep Visit, QA-upkeep Condition, QA-upkeep Med (provider links now null).
Removed because they distorted other agents' totals or sort: RecHuge, RecNeg, Huge schedule, Daily1 schedule and its 9999 record, provider "QA-upkeep Dr Test" (consumed by the delete test), and the Civic reminders the template picker created (titles had no QA prefix).

## 4. Not tested
Vehicle odometer bump on completion (would change a shared vehicle's mileage). Setting a primary provider on an existing person (FK checked via PRAGMA: ON DELETE SET NULL; created QA person behaved correctly). Receipts and uploads (out of scope). Manual link and Find page. Notification dismissal on complete/snooze. Role=USER (no account). Phone: edit and delete flows, warranty and provider dialogs beyond page load. The after-8-pm default date.
