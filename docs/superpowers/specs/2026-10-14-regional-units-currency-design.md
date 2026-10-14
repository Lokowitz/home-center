# Regional settings: currency, units, date format (issue #13) — design

Date: 2026-10-14. Status: approved in brainstorming; implementation plan next.

## Goal
A non-US household picks its currency, distance unit, area unit and date format once and never
sees `$`, `mi`, `ft²` or US-style dates again — on screens, reports, notifications, the
assistant, receipt capture and search. Requested in issue #13 (miles/km, sq ft/m², currency,
date format).

Success: with EUR / km / m² / "5 Jan 2026" / 24h selected, no surface shows USD, miles, sq ft
or 12h times. With defaults, every surface renders exactly as today.

## Decisions
- **Label only, no conversion.** Numbers are entered, stored and shown in the chosen unit.
  Switching a unit changes labels only; stored values are never rewritten. (A one-time
  "convert existing data" action is out of scope.)
- **Household-wide, admin-set.** One singleton row. Because stored numbers mean one unit, all
  users must see the same unit; dates follow the same setting for simplicity.
- **Date format is a preset list** plus a 12h/24h toggle. No locale picker.
- **Number grouping/decimal separators** keep following the runtime default locale
  (`undefined`), as today. Only the currency code changes.
- **All surfaces in v1:** UI, reports, notifications, assistant (LLM), receipt capture, search
  text.
- **No renames.** `MeterUnit.MILES`, `intervalMiles`, `lastCompletedMileage`, `nextDueMileage`,
  `reminderMilesBefore`, `mileageAtService`, `currentMileage`, `Property.sqFt` keep their names
  and values. `MILES` means "the household distance unit".

Out of scope: unit conversion of stored data, per-user preferences, locale-based number
separators, translation of UI text, non-English month names.

## Data model
```prisma
enum DistanceUnit { MILES KM }
enum AreaUnit     { SQFT SQM }
enum DateFormat   { MDY_SHORT DMY_SHORT MDY_NUM DMY_NUM ISO }

model RegionalSettings {
  id           String       @id @default("singleton")
  currency     String       @default("USD")      // ISO 4217 code
  distanceUnit DistanceUnit @default(MILES)
  areaUnit     AreaUnit     @default(SQFT)
  dateFormat   DateFormat   @default(MDY_SHORT)
  hour12       Boolean      @default(true)
  updatedAt    DateTime     @updatedAt
}
```
Date presets (example 2026-01-05):

| Preset | Date | 
|---|---|
| `MDY_SHORT` (default) | Jan 5, 2026 |
| `DMY_SHORT` | 5 Jan 2026 |
| `MDY_NUM` | 01/05/2026 |
| `DMY_NUM` | 05/01/2026 |
| `ISO` | 2026-01-05 |

Migration adds the enums and table only. No row is required: a missing row means defaults.
Backups already capture the whole DB (`VACUUM INTO`); the readable export is unchanged.

## Formatter (`lib/regional.ts`, pure)
```ts
type Regional = { currency: string; distanceUnit: DistanceUnit; areaUnit: AreaUnit;
                  dateFormat: DateFormat; hour12: boolean }
const DEFAULT_REGIONAL: Regional

createFormatter(r: Regional): {
  money(n: number): string            // Intl currency = r.currency, the currency's standard decimals
  moneyCompact(n: number): string     // replaces hardcoded "$…k"; uses currency symbol
  moneyPlain(n: number): string       // 0 decimals (replaces report-server formatMoneyPlain)
  currencySymbol: string              // for labels: "Cost (€)"
  distanceShort: string               // "mi" | "km"
  distanceWord: string                // "miles" | "kilometres"
  distanceNoun: string                // "Mileage" | "Distance"
  meterShort(u: MeterUnit): string    // MILES → distanceShort, HOURS → "hrs"
  meterWord(u: MeterUnit): string
  meterNoun(u: MeterUnit): string     // MILES → distanceNoun, HOURS → "Hours"
  areaShort: string                   // "ft²" | "m²"
  areaLabel: string                   // "Square footage" | "Floor area (m²)"
  area(n: number): string             // "1,200 ft²"
  date(d: Date | string, opts?: { utc?: boolean }): string
  time(d: Date | string): string      // honours hour12
  dateTime(d: Date | string): string  // date(d) + " " + time(d)
}
```
- `date` presets are built from `Intl.DateTimeFormat("en-US", …).formatToParts` so output is
  independent of the viewer's locale. Short presets use English short month names (as today).
- `utc` flag: each migrated call site keeps its current timezone behaviour. `formatDay`
  (lib/health.ts) is UTC; `toLocaleDateString` callers are local. Changing this silently would
  shift day-only dates across midnight.
- Defaults must reproduce today's strings exactly (tests pin this).
- `isValidCurrency(code)` uses `Intl.supportedValuesOf("currency")`.

Access:
- Server: `loadRegionalSettings()` in `lib/regional-server.ts` (React `cache`, returns
  `DEFAULT_REGIONAL` when no row) and `getFormat()` = `createFormatter(await load…())`.
- Client: `<RegionalProvider value={regional}>` (`components/regional-provider.tsx`) mounted in
  `app/(app)/layout.tsx`; `useFormat()` hook returns a memoised formatter.

Existing helpers (`formatMoney`, `formatMoneyCompact` in lib/costs.ts, `formatMoneyPlain` in
lib/report-server.ts, `formatDay` in lib/health.ts, `formatTime` in lib/observations.ts,
`meterUnitShort/Noun/Word` in lib/maintenance-due.ts, `dollars`/`num` in
lib/search/entities/text.ts) are removed; callers move to the formatter.

## Settings UI
- New admin-only section `regional` ("Regional") in `lib/settings-sections.ts`; component
  `components/settings/regional-settings.tsx`.
- Fields: currency (select from `Intl.supportedValuesOf("currency")`, common ones — USD, EUR,
  GBP, CAD, AUD, CHF, JPY — listed first, showing code + symbol), distance unit, area unit, date
  preset (each option shows today's date in that format), 12h/24h toggle. Live preview line
  showing money, distance, area, date-time.
- Note under unit selects: "Changing units relabels existing values; it does not convert them."
- Save: server action `saveRegionalSettings` in `lib/actions/regional-settings.ts` — admin check,
  validate enums and currency, upsert singleton, `revalidatePath("/", "layout")`, then
  `void syncEntities()` so search text re-embeds (hash-based, only changed entities).

## Migration by surface
1. **UI** (~40 files): replace `formatMoney*`, hand-built `$` (equipment/[id], properties/[id],
   records/page, property-list, service-record-list), "($)" form labels (file-inbox-dialog,
   service-record-form-dialog, complete-dialog, vehicle-form-dialog, insurance-list), "ft²" and
   "Square Footage", `meterUnit*`, `formatDay`, `formatTime`, `toLocaleDateString`/
   `toLocaleString` dates (notifications page, notification-bell, inbox-item-card, warranties,
   maintenance, asset pages, asset-report). Server components use `getFormat()`; client
   components `useFormat()`.
2. **Reports & notifications:** `lib/report-server.ts`, `lib/notifications/checker.ts` and email
   digest text use `getFormat()`.
3. **Assistant:** `lib/llm/prompt.ts` money/units line generated from settings, e.g. "Money as
   €1,234.56. Distances in km. Areas in m²." `lib/llm/tools/shortcuts.ts` uses `r.currency`.
   `lib/llm/ontology.ts` odometer/area descriptions use unit words. `lib/llm/model-test/cases.ts`
   keeps USD/miles (runs on defaults).
4. **Receipt capture:** `lib/capture/parse.ts` `MONEY` regex accepts any currency symbol
   (`\p{Sc}`) or ISO code before/after the number. New `parseAmount(text)` in
   `lib/capture/amount.ts`: handles `1,234.56`, `1.234,56`, `1 234,56`, `12,50`, `12.50`;
   when both `.` and `,` appear the last one is the decimal mark; a single separator followed by
   exactly 3 digits is grouping, otherwise decimal. `lib/capture/llm-parse.ts` prompt names the
   household currency and stops stripping only `$`.
5. **Search text:** `lib/search/entities/text.ts` takes a formatter (passed from
   `buildEntityDocs`) for money, distance and area words; `lib/search/global-server.ts` sqft
   label likewise.
6. **Regression guard:** ESLint `no-restricted-syntax` banning `toLocaleDateString`,
   `toLocaleTimeString`, and the literal `"USD"` outside `lib/regional.ts` and tests/model-test
   cases.

## Error handling
- Invalid currency or enum in save action → rejected with a form error; nothing written.
- Missing row / DB read failure in loader → `DEFAULT_REGIONAL` (log once).
- `Intl` throwing for an exotic currency at format time → fall back to `"<CODE> 1,234.56"`.

## Testing
- `lib/regional.test.ts`: every date preset; 12h vs 24h; UTC vs local day boundary
  (23:30 UTC-5); currencies with 0/2/3 decimals (JPY, EUR, KWD); compact money; meter/area
  labels for both units; defaults reproduce current strings for a fixed sample set.
- `lib/capture/amount.test.ts`: the formats above plus edge inputs (empty, spaces, symbol
  before/after, negative, no digits).
- Prompt builder test: money line reflects EUR/km/m².
- Then `npm run lint`, `npx tsc --noEmit`, `npm test`, and a manual pass in the running app
  with EUR / km / m² / DMY_SHORT / 24h across dashboard, costs, a vehicle, a property,
  maintenance, a report, and the assistant.
