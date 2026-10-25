# QA layout results (read-only sweep)

Method: Edge headless, ADMIN, 4 sizes x light/dark (theme via next-themes localStorage "theme", not a cookie) x sidebar expanded/collapsed (cookie hc-sidebar; phone has the drawer only). 32 pages per combo: /, 4 asset lists, 4 detail pages (every tab clicked), 3 /reminders sub-pages, /costs, /maintenance, /insurance, /warranties, /providers, /records, /intake, /notifications, /search?q=a, /settings/install, /reports/vehicles/<id>, 9 settings tabs (look only). Per page: documentElement overflow, off-screen text outside scrollers, clipped text, tap targets (phone), canvas-based contrast < 3:1 in dark, console/page errors. Dialog sweep: every Add/New/Edit/Log/Plan button per page and per tab, six size/theme combos, checked dialog bounds, submit button reachable, Escape closes. Raw data in scratchpad\qa\layout\*.json. Screenshots: shots\layout-*. Note: main is the scroll container (overflow-y-auto), so full-page PNGs show only the first viewport.

## Coverage table (pages x sizes). "pass" = no horizontal overflow, nothing off-screen, no contrast < 3:1 in dark, no new errors, light and dark, both sidebar states

| Page | phone 375 | tablet 768 | desktop 1280 | wide 1920 |
|---|---|---|---|---|
| / | pass (hydration error, F2) | pass (F2) | pass (F2) | pass (F2) |
| /assets/equipment, people, properties, vehicles | pass (small taps F4) | pass | pass | pass |
| detail equipment / people / properties / vehicles, all tabs | pass (small taps F4) | pass | pass | pass |
| /reminders x3 (equipment, properties, vehicles) | pass (inputs 80x32, F4) | pass | pass | pass |
| /costs | pass (tile numbers see F3) | pass | pass | pass (F3) |
| /maintenance, /insurance, /warranties, /providers, /records | pass (F4) | pass | pass | pass |
| /intake, /notifications, /search?q=a | pass (F4) | pass | pass | pass |
| /settings tabs x9, /settings/install | pass (F4) | pass | pass | pass |
| /reports/vehicles/<id> | FAIL F1 (sw 424 > 375) | pass | pass | pass |
| Add/Edit dialogs (all pages, all tabs) | pass | pass | pass | pass |

Dialogs: 31 per combo opened and cancelled (no saves). Edit dialogs on the 4 detail pages checked at phone, tablet, desktop in light and dark. All fit the viewport (phone dialog 343 wide, 40..771 of 812 tall, scrolls internally when long), submit button reachable, Escape closes. No dialog problem found.
Dark theme: zero text/background pairs under 3:1 on any page, after fixing my first contrast probe (it mis-parsed oklch colors; ignore the stale phone/tablet "contrast" lines in sweep-phone.json etc., use the *dark.json files).
Sticky header and sidebar: header stays pinned, sidebar full height, collapsed rail shows icons, phone drawer opens with correct overlay (screenshot layout-x-drawer-phone-dark).

## Findings

W/U
- F1 (U, phone only) /reports/vehicles/<id> scrolls sideways at 375 (scrollWidth 424). The Service history table is wider than the page; Cost column ($149.00, TOTAL $328.20) is cut off at the right edge, and the Summary strip clips "$328.20" and "WARRANTIE". Repro: phone, open /reports/vehicles/cmvmsiaer0003b8optqbnti1o (Daily Driver, has 3 service records). Expected: table fits or scrolls inside its own box. Shot: layout-phone-light-exp-_reports_vehicles_cmvmsiaer0003b8optqbnti1o. Also the Print/Save as PDF button sits on a sheet where the page is wider than the sheet on phone. Other asset types' reports not opened (only a vehicle report requested).
- F2 (W, all sizes, light and dark, expanded and collapsed) Dashboard "/" logs "Hydration failed because the server rendered text didn't match the client" on every load (pageerror; the Next dev "1 Issue" badge appears bottom-left). Only "/" does it. Not caught: what field differs (server vs client text), probably a date or time or the Q-initials tile (see F5). Expected: no hydration error.
- F5 (N/W, all sizes, dashboard Properties tile) A QA property tile shows "Q" + a replacement character (a half emoji). Initials are taken by cutting a string at a UTF-16 unit, which splits a surrogate pair for names with emoji after the first letter. Shot: layout-tablet-dark-col-_ (tile third row, left). Takes the first two "letters" of a name like "Q<emoji>...". Also a candidate cause for F2 (server and client may render the broken character differently); unconfirmed.
- F3 (N) /costs stat tiles with extreme test data ("$999,999,999,999,999,900,000.00" ALL TIME, "$38,461,538,461,538,460,000.00" AVERAGE) fit at 1920 only just; at 375 they wrap inside the tile with no clipping detected, but they are unreadable. Data comes from other QA agents' huge-number tests, so it is an edge case, not a layout bug.
- F4 (U, phone) Tap targets under 40px, nearly everywhere (measured at 375): Menu button 32x32, Property filter 36x28, view toggle buttons (Large/Small cards/List) 28x28, row "More actions" 28x28, edit/delete icons 28x28 and premium delete 24x24, "Help for this field" 16x16, checkboxes 16x16, "Dismiss tip" 22x22, "View all" 72x24, Costs filter chips 24 high, Complete/Snooze/Dismiss on notifications 28 high, text links 19-20 high, "Add X" buttons 32 high, settings inputs 32 high, reminder day inputs 80x32. Nothing overlapping. Sorting header buttons 28 high.
- N: collapsed sidebar (tablet, desktop, wide, collapsed state) hides labels with overflow (reported as clipped text in my probe); this is the intended rail, no visible issue.
- N: Next dev overlay "N" badge overlaps the sidebar "Settings" link and the phone drawer's Settings label in dev only; ignore in production.

No horizontal overflow, clipped or overlapping text, or unusable table/chart found on any other page at any size. Tabs strips on detail pages scroll inside their own box on phone (the Documents tab trigger sits cut off at the right edge until scrolled, by design).

## QA records left behind
None created (read-only).

## Not tested
- Other report types (properties, people, equipment reports) and print layout; only one vehicle report was opened.
- Eleven other themes (Ledger, Frost, etc.); only Spruce and Spruce Night.
- Role USER view of pages (no USER account).
- Dialogs opened from row "More actions" menus on list pages (Add dialogs only on lists), and delete confirmations.
- Contrast of chart labels inside SVGs only partly covered (text leaf nodes counted, no failures); focus rings not checked.
- Landscape orientations and sizes between the four.
