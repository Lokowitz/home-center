# QA layout2: horizontal overflow redo (main-aware), read-only

Method: Edge headless, ADMIN, light theme, sidebar expanded, phone 375 and tablet 768. Per page: documentElement scrollWidth/clientWidth AND main.scrollWidth/clientWidth, plus every visible element whose right edge exceeds the viewport (tag, text, class, right edge; sorted unclipped first). Detail pages: every tab clicked and re-measured. Dialogs: every Add/New/Edit/Log/Plan button (max 6 per page/tab), dialog scrollWidth vs clientWidth, fields/buttons outside the dialog box. Scripts and raw data: scratchpad\qa\layout2\ (sw.cjs, chain.cjs, sw-phone.json, sw-tablet.json, sum.txt, chain-phone.txt). Screenshots (viewport clips): shots\layout2-*.
Key difference from layout.md: that run read document scroll only; the page scrolls inside main, so "pass" there was wrong for the four detail pages and /assets/equipment.

## Coverage table (57 page/tab measurements per size, 33 dialogs per size)

| Page | phone 375 | tablet 768 | notes |
|---|---|---|---|
| / | pass | pass | |
| /assets/people, properties, vehicles (lists) | pass | pass | |
| /assets/equipment (list) | FAIL main 380/375 | pass | F3 |
| detail equipment, all 5 tabs | FAIL main 686/375 | FAIL main 686/544 | F1, F2 |
| detail people, all 8 tabs | FAIL main 664/375 | FAIL main 664/544 | F1 |
| detail properties, all 7 tabs | FAIL main 770/375 | FAIL main 770/544 | F1, F2 |
| detail vehicles, all 5 tabs | FAIL main 542/375 | pass (sw within main) | F1, F2 |
| /reminders x3 | pass | pass | |
| /costs, /maintenance, /insurance, /warranties, /providers, /records, /intake, /notifications, /search?q=a | pass | pass | |
| /settings 9 tabs, /settings/install | pass | pass | |
| /reports/vehicles, properties, people, equipment | FAIL doc 424, 395, 499, 378 vs 375 | pass | F4 |
| Add/Edit dialogs (33 per size) | 1 fail (Add Policy, F5) | 1 fail (F5) | all dialogs 343 wide on phone, fit the viewport; the rest of the automatic "bad" flags were sr-only inputs and form scrollbar gutter, no cut-off fields or buttons |

Document-level overflow was zero on every authenticated page (matches the earlier agent); the failures are all inside main. Tablet vehicles detail passes only because main is 544 wide there and the vehicles header row is 538.

## Findings (all U, layout)

F1 (U, phone and tablet, detail pages of equipment, people, properties, vehicles; main.scrollWidth 686, 664, 770, 542 at 375; 686, 664, 770 at 768 with sidebar open) Header action row pushes main sideways. Repro: open any detail page at 375 (e.g. /assets/properties/cmvmsiae80000b8opdvfbv4h9) and scroll main right. Expected: buttons wrap or fit. Actual: Edit / Plan replacement / Report / Download all files (people: Log observation / Edit / Medical summary ...) sit in `<div class="flex shrink-0 items-center gap-2">` (people: `flex shrink-0 flex-wrap ... justify-end`) inside `<div class="flex items-start justify-between gap-4">` next to the h1. shrink-0 plus no flex-wrap means the row keeps its full width (equipment 506 px, people 552, properties and vehicles 338) and runs past the 327 px content box, so "Download all files" and others start off screen (equipment right edge 686). Source: app/(app)/assets/{equipment,people,properties,vehicles}/[id]/page.tsx lines 105, 128, 121, 87. People's wrapper has flex-wrap but shrink-0 still stops it wrapping. Fix direction: drop shrink-0, add flex-wrap and min-w-0 on the row, or stack on small screens. Shots: layout2-phone-_assets_properties_<id>.png (viewport clip shows only top; the overflow is to the right), tab shots layout2-phone-_assets_*-tab-*.png.

F2 (U, phone, detail pages equipment, properties, vehicles) TabsList has no overflow handling. `<TabsList variant="line" className="w-full justify-start border-b">` renders as inline-flex with overflow visible, so the tab buttons (Maintenance Reminders (40) 205 px wide, Documents (0) right edge 771 on properties) extend main by themselves. People's page has `overflow-x-auto` on its TabsList and only suffers F1. Expected: tab strip scrolls inside its own box. Fix direction: add `overflow-x-auto` (as people does) to the other three. The earlier "tab strip scrolls inside its own box" claim in layout.md is true for people only.

F3 (N, phone, /assets/equipment list) main 380/375. The toolbar `div.flex.items-center.gap-2` (Large cards / Small cards / List toggle + Add Equipment, 220 wide) ends at 380, 5 px past the edge, so "Add Equipment" is clipped by 5 px and main scrolls 5 px sideways. People, properties and vehicles lists fit because their Add label is shorter. Fix direction: let the toolbar wrap or use shorter label at 375.

F4 (U, phone, all four /reports/<type>/<id> pages; document-level scroll 424 vehicles, 395 properties, 499 people medical summary, 378 equipment vs 375) Report tables and the medical-summary header are wider than the sheet. Widest: vehicles `TABLE` (DateServiceCategoryCost... right edge 424), people `DIV "HomeCenter · Medical summary"` right edge 499. Expected: table scrolls within its box, or sheet wraps. layout.md only covered vehicles. Not printed, screen layout only.

F5 (U, phone and tablet, /insurance Add Policy dialog) A `<label>` containing the QA property name "QA-places Phone House WWW ..." (a very long unbroken name in the link checkboxes) spans 32..1628 px at 375 (64..1660 at 768) in a dialog 343 (672) wide: dialog scrollWidth 1612 vs clientWidth 343. The checkbox label does not wrap or truncate, so the dialog content is cut off or scrolls sideways. Triggered by long no-space names (data from other QA agents), but any long property name will do it. Source: components/insurance/insurance-form-dialog.tsx link list (label needs `min-w-0 break-words` / truncate). Shot: layout2-dlg-phone-_insurance--Add_Policy.png, layout2-dlg-tablet-_insurance--Add_Policy.png.

Not a finding but worth knowing: on phone the properties detail page stacks the aside (image, facts) above the title, so the h1 and action row (F1) are far down the page.

## QA records left behind
None (read-only; every dialog cancelled with Escape, nothing saved).

## Not tested
- Wide and desktop sizes, dark theme, collapsed sidebar (task was phone and tablet, light, expanded).
- Print layout of /reports.
- Dialogs behind row "More actions" menus, delete confirmations, edit dialogs on list rows.
- Pages with no Add button text matching my filter (e.g. "Add 0 reminders" on equipment /reminders timed out clicking, "Add N reminders" is not a dialog opener on the other two).
- Landscape and sizes between 375 and 768 (a property detail page at 600 or so would likely still fail F1/F2).
