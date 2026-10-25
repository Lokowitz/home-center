# QA report: money (insurance, costs, dashboard)

Environment note: the machine and dev server run in US Eastern time (EDT, UTC-4). Date inputs are stored as UTC midnight. That matters for W1 and W3 below. Scripts: scratchpad\qa\money\*.cjs. Screenshots: scratchpad\qa\shots\money-*.png.

## 1. Coverage

| Feature or flow | Desktop | Phone | Result | Notes |
|---|---|---|---|---|
| Service record create (cost 0, cents, 0.10, 10.005, 999-style large, 1e21, negative, blank) via property Service tab | yes | no | partial fail | Saved exactly as typed; negative and 1e21 accepted (W4, U3). Double-click submit makes one record only. |
| Service record edit cost/vendor/date, delete | yes | no | pass | /costs asset row, vendor list, DB all matched after edit and after delete. Deleting an equipment record removed the property's child row and total correctly. |
| /costs tiles: 2026 to date, All of 2025, All time, Average per month | yes | overflow only | FAIL | Boundary dates land in the wrong period (W1). Tile values otherwise equal DB sums. Deltas on tile all-time matched +12.87 for six records I added. |
| Hover popovers on all four tiles | yes | no | pass with bug | Monthly, yearly and daily tooltips work. Daily tile attributes records to the previous day (W1). |
| Trend chart, composition bar, ranked bars, vendor bars: hover | yes | no | pass | Tooltips show correct amounts, share and counts. |
| Year / By (month, quarter, year) / Category / Asset-type filters | yes | no | pass with bug | Category click, clear chip and "Show as table" work. 21 hostile query strings (year=abc, -1, 99999, 1e3, bogus category/bucket/type, duplicates) gave no errors or 5xx. Year buckets wrong at boundaries (W1). |
| Spend by asset incl. property row and child rows | yes | no | pass | Property total = own + equipment (1246.79 + 100.10 = 1346.89). "Property itself" row and equipment row correct. type=EQUIPMENT and type=PROPERTY views correct. |
| Planned spend, next 12 months | yes | no | pass | Added once/every-30-days/overdue/outside-window/zero reminders. Total delta 382.35 = 250.50 + 123.00 (12 x 10.25) + 5.55 + 3.30. Oct 1 2027 item excluded, zero estimate excluded, overdue counted once this month. Property page "Planned" matched /costs. Planned item click opens that reminder. |
| Dashboard counts, Spending card, reminders, expiring warranties | yes | overflow only | partial fail | Counts match DB (allowing for other agents writing). Spending card uses the same local-time bucketing (W1). Hydration error (W6). |
| /insurance create: Home, Auto, Umbrella, Life, Medical, Renters | yes | Renters only | pass | Grouping (Property and auto / Life / Health), status chips (Renews today, Ended, Active), linking to property and vehicle all correct. |
| Policy validation (blank carrier, end before start, negative deductible, coverage amount without name) | yes | no | pass | Clear messages, nothing saved. |
| Coverage lines add, reorder, edit, amounts | yes | no | pass | Order persists (sortOrder). Cents are hidden on the card (U2). |
| Premiums add (yearly, monthly, every 6 months, 0, 33.335, 145.505, future-dated), validation, delete | yes | add only | pass | Current premium logic, yearly conversion and "+12% vs last term" correct. Negative, blank amount and blank date refused. Delete removes only that premium. Sub-cent amounts accepted. |
| Delete policy cascade | yes | no | pass | Policies 9 to 8, premiums -2, coverages -2, no orphans, linked property and other policy untouched. |
| Edit policy kind (Home to Life to Home) | yes | no | pass | Property link cleared on Life, premiums and coverages kept, relink works. |
| Property and vehicle page Insurance box | yes | vehicle only | pass | "Belongings to replace $1,500" (1500.25 rounded to whole dollars) and "Personal property coverage $225,000" appeared after I set equipment values. |
| Insurance deep link ?open=id, bogus id, Escape | yes | yes | pass | |
| Renewal dates (Renews in 22d, today, yesterday) | yes | no | pass | Notification bell for renewals not checked (see section 4). |
| Warranties created for dashboard check | yes | no | partial fail | Dashboard 30d and 60d correct. Date display wrong (W3). |
| Phone width (375) for /costs, /dashboard, /insurance | no | yes | pass | No horizontal scroll on any of the three. Extreme text clips (U4). |

## 2. Findings

### D (data loss or corruption)
None found. Delete, edit and cascade paths kept data consistent.

### W (wrong behavior)

W1. Records on the first or last day of a period land in the wrong period (all period math uses local getters on UTC-midnight dates).
- Repro: add service records on the property QA-money Property: 2026-01-01 cost 0.11, 2025-01-01 cost 0.33, 2026-10-01 cost 3.33, 2026-10-25 cost 1.11, 2031-01-01 cost 0.20, 2032-01-01 cost 0.05. Open /costs and /costs?year=2031.
- Expected: 2026-01-01 counts in "2026 to date"; 2025-01-01 counts in "All of 2025"; Oct 1 counts in October; today's record shows on today's daily bar; 2031-01-01 in 2031.
- Actual (EDT server): "2026 to date" rose 12.21 instead of 12.32; "All of 2025" got the 2026-01-01 amount and lost the 2025-01-01 amount (it went to 2024); October record landed in September; today's record (Oct 25) shows on the Oct 24 daily bar and Oct 25 reads $0.00; /costs?year=2031 spend-by-asset 1,239.87 vs 1,240.02 expected from the entered dates (the 2031-01-01 record counted in 2030, the 2032-01-01 record counted in 2031, and 2032 never appears in the Year list). Dashboard Spending card "in 2026" showed 11,675.84; summing entered dates gives 11,680.95. Property page "2026 to date" has the same error. Jan 2031 bar on the trend chart is $0.00 though two records are dated Jan 1 2031.
- Cause: lib/costs.ts (`getFullYear`, `getMonth`, `getDate`, `yearToDate`, `bucketKeyOf`, `dailyTotals`) vs dates saved as UTC midnight. The service table and insurance cards format with UTC and look right, so the two views disagree. Screenshot: money-costs-2031.png, money-nest_costs_year_2031.png.

W2. One mistyped year (0202 instead of 2022) wrecks the costs page.
- Repro: add a service record dated 0202-05-05, cost 1.00 on any asset. Open /costs and /costs?year=all.
- Expected: date refused or page unaffected.
- Actual: date accepted. "All time" tile bars show years 790 to 801, all $0 (the real 2024 to 2026 bars are gone). "Average per month" fell from $717 to $0.85. "Spend over time" for All years starts at year 202 and is cut off at 600 buckets, so the real data is not drawn. Deleting the record restored everything. Screenshots: money-typoyear-*.png.

W3. Warranty dates show one day early.
- Repro: add a warranty with expiration 2026-11-24 and purchase 2026-11-01 (QA-money W30, QA-money Wbefore). View /warranties and the property's Warranties tab.
- Expected: Nov 24 and Nov 1.
- Actual: "Nov 23, 2026" and "Oct 31, 2026", while the status says "30d left" and the edit form shows 2026-11-24. A warranty expiring today (2026-10-25) shows "Expired" and "Oct 24" and disappears from the dashboard's Active Warranties count and Expiring list although it is still valid today.

W4. Negative costs are accepted with no warning.
- Repro: add a service record with cost -5.00.
- Expected: refused or clearly labeled as a refund. Actual: saved, shows "-$5.00" in lists, lowers totals, and makes category shares odd (a category read "Repair 100%" next to "Uncategorized 0%").

W5. Warranty purchase date after expiration date is accepted (Wbefore: bought Nov 1, expired Oct 1). Insurance does validate its date pair.

W6. Dashboard hydration error and a broken tile for names ending in an emoji.
- Repro: a property named `QA-places Prop "A" <b>&'é 🏠` (made by the places agent) exists. Load / a few times.
- Actual: the Properties card shows "Q�" and the console reports "Hydration failed because the server rendered text didn't match the client" (2 of 3 loads). Cause: `initialsOf` in lib/asset-visuals.ts takes `parts[last][0]`, which splits the emoji surrogate pair.

W7. No sanity bounds on dates in money forms. Premium dates 0001-01-01 and 275760-01-01 saved (the latter stored as 05:00 UTC because the six-digit year parses as a local date, shown as "Jan 1, 275760"). Same unbounded year as W2.

W8. Future-dated records inflate totals but are missing from the charts. QA records dated 2030 to 2032 are in "All time" and "Average per month" (average divides by months up to today) but the All-time bars stop at the current year and "Spend over time" for All years ends today, so chart and tile totals disagree. The "All time" tile was 1,240.37 higher than the sum of its bars.

### U (confusing UX)

U1. Dialog default date is the UTC date: at 23:30 local on Oct 25 the Add Record dialog prefilled 2026-10-26 (tested with a mocked clock). Evenings in US time zones record tomorrow's date.

U2. Coverage amounts show whole dollars only: 450000.50 shows "$450,001", deductible 250.75 shows "$251 ded." Premiums and deductibles elsewhere show cents.

U3. No upper bound on money fields. Cost 1e21 and deductible 1e21 saved; page shows "$1,000,000,000,000,000,000,000.00" and chart axes read "$500000000000000000k".

U4. At phone width a very long carrier name and a huge deductible are clipped at the card edge instead of wrapping (money-insurance-phone.png). Only extreme input.

U5. Premiums can be added and deleted but not edited; a typo means delete and re-add.

U6. Life policy with nobody linked says "Nothing linked yet" while health policies say "Nobody yet", though life policies link people.

U7. Saves take 2 to 4 seconds in the dev server and the dialog gives no visible progress; my scripts saw the dialog still open after 1.5 s on several saves (all saved). Not verified whether a spinner shows.

### N (nits)
- Escape closes a half-filled policy or record dialog without asking.
- Average per bar in ranked tooltip includes zero-cost records in its count.
- Sub-cent premiums (145.505, 33.335) are stored as typed and only rounded on display.
- The insurance page has no overall premium total (not a bug, noting that "totals" exist only per card).

## 3. QA records left behind
- Property: QA-money Property (1 Money Way). Equipment: QA-money Equip (price 999.99, replacement 1500.25). Vehicle: QA-money Vehicle.
- Service records (all on QA-money Property unless noted): QA-money R1 (now cost 1234.50, vendor QA-money Vendor2), R2 dime (0.175, Jan 1 2031), R3 jan1, R4 dec31, R5 zero, R6 dec31-2031, R7 jan1-2032, R8 nocat (10.005), R10 inf (no cost), G dbl, A jan1-2026, B dec31-2025, C jan1-2025, D oct20, E oct1, F today.
- Reminders: QA-money P1 once feb, P2 every30, P3 outside, P4 lastday, P5 overdue, P6 zero.
- Warranties: QA-money W30, W60, Wexpired, Wtoday, Wbefore.
- Policies: QA-money Home Ins (5 premiums, 3 coverages, linked to QA-money Property), Auto Ins (QA-money Vehicle), Umbrella Ins, Life Ins, Med Ins, Phone Ins (renters), and one policy named `QA-money "Quote" <b>x</b> & 'é' 🏠 LLL...` (334 characters, deductible 1e21).
- Deleted by my own tests: R9 neg, R11 1e21, T typo-year (service records); QA-money H equip (equipment record); QA-money Del Test (policy with 2 premiums and 2 coverages); three odd premiums on the Home policy (1e21, year 0001, year 275760).
- Note for cleanup: record F and the 2025/2026 QA records add about 12.9 to the user's real 2025 and 2026 totals; the 2030 to 2032 records add about 1,247 to All time and Average per month.

## 4. Not tested
- Health off paths (global setting, owned by another agent), person visits and medical costs on /costs (type=PERSON), and policies covering people.
- Notification bell and renewal notices (need the reminder job; notifications are out of scope).
- Dark mode, tablet and wide layouts.
- Non-US time zones (only EDT available), so W1 and W3 are confirmed for UTC-4 only. By the code they should not occur at UTC or east of it.
- Phone width for service record, reminder and edit-policy flows (phone coverage was add policy, add premium, and page loads).
- File attachments on policies and records (out of scope).
- Exact dashboard "Due (30d)" for mileage-based reminders (date-based count matched DB at 11).
