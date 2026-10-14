# Regional settings (currency, units, date format) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pick the household currency, distance unit (mi/km), area unit (ft²/m²), date format preset and 12h/24h clock, and have every surface — UI, reports, notifications, assistant, receipt capture, search — follow it (issue #13).

**Architecture:** A singleton `RegionalSettings` row (defaults = today's behaviour). A pure `createFormatter(regional)` in `lib/regional.ts` is the only place that formats money, units and dates. Server code gets it via cached `getFormat()`; client components via `useFormat()` from a `<RegionalProvider>` mounted in the app layout and the report page. Label-only: stored numbers are never converted.

**Tech Stack:** Next.js (non-standard version — read `node_modules/next/dist/docs/` before touching routing/server actions), React, Prisma 7 on SQLite, zod, Vitest (node env, `lib/**/*.test.ts` only), ESLint flat config.

**Spec:** `docs/superpowers/specs/2026-10-14-regional-units-currency-design.md`

## Global Constraints

- Defaults: `currency "USD"`, `distanceUnit MILES`, `areaUnit SQFT`, `dateFormat MDY_SHORT`, `hour12 true`. With defaults, output must equal today's strings.
- No renames of existing schema fields/enums: `MeterUnit.MILES`, `intervalMiles`, `lastCompletedMileage`, `nextDueMileage`, `reminderMilesBefore`, `mileageAtService`, `currentMileage`, `Property.sqFt` stay.
- No conversion of stored values, ever.
- Number grouping stays on the runtime default locale (`undefined`).
- Each migrated date call keeps its current timezone: UTC where the old code passed `timeZone: "UTC"` or used `formatDay`, local otherwise.
- Settings are admin-only to change; everyone sees them.
- Tests: `npm test` (vitest), lint: `npm run lint`, types: `npx tsc --noEmit`. All three must pass at the end of every task.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UBcabZ2saeRpR6mG6TYe9r
  ```

## Review Focus

1. **Day shift at midnight** — a date-only value stored at UTC midnight shown with a local formatter in UTC-5 shows the previous day. Every `formatDay` / `timeZone:"UTC"` site must become `fmt.date(d, { utc: true })`. Test pinned in Task 2 (`utc vs local`).
2. **Zero-decimal and three-decimal currencies** — JPY must render `¥1,235` not `¥1,234.56`; KWD three decimals. `formatMoney` today forces 2 decimals. Test in Task 2.
3. **European receipt totals** — `Total 1.234,56 €` must parse to 1234.56, and `12,50` to 12.5, without breaking existing US receipts (`lib/capture/accuracy.test.ts` must still pass). Tests in Task 9.
4. **Pages outside the `(app)` layout** — `app/reports/[type]/[id]/page.tsx` renders `asset-report.tsx` without the app layout; without its own provider it would silently show defaults. `useFormat()` throws outside a provider. Test of the throw is impractical in node vitest, so Task 3 makes the hook throw and Task 6 mounts the provider on the report page; manual check in Task 11.
5. **Unknown currency code** — a code `Intl` rejects at format time must not crash a page. Formatter falls back to `"<CODE> 1,234.56"`. Test in Task 2; save action rejects it up front (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/<ts>_add_regional_settings/` | Model + enums |
| `lib/regional.ts` (new) | Types, defaults, `createFormatter`, `isValidCurrency`, `COMMON_CURRENCIES`. Pure. |
| `lib/regional.test.ts` (new) | Formatter tests |
| `lib/regional-server.ts` (new) | `REGIONAL_SETTINGS_ID`, `loadRegionalSettings` (cached), `getFormat` |
| `components/regional-provider.tsx` (new) | `"use client"` context, `RegionalProvider`, `useFormat` |
| `lib/actions/regional-settings.ts` (new) | `saveRegionalSettings` server action |
| `components/settings/regional-settings.tsx` (new) | Settings form |
| `lib/settings-sections.ts`, `app/(app)/settings/page.tsx` | Register the Regional tab |
| `lib/capture/amount.ts` (+ test, new) | `parseAmount`, `AMOUNT_RE` |
| Existing call-site files | Switch to formatter (Tasks 5–10) |
| `eslint.config.mjs` | Regression guard (Task 11) |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (after `FeatureSettings`, ~line 691)
- Create: `prisma/migrations/<generated>_add_regional_settings/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma client types `DistanceUnit`, `AreaUnit`, `DateFormat`, model `prisma.regionalSettings`.

- [ ] **Step 1: Add the model** below `FeatureSettings`:

```prisma
/// How money, distances, areas and dates are written for this household.
/// Label only: switching a unit relabels stored numbers, it never converts them.
model RegionalSettings {
  id           String       @id @default("singleton")
  /// ISO 4217 code.
  currency     String       @default("USD")
  distanceUnit DistanceUnit @default(MILES)
  areaUnit     AreaUnit     @default(SQFT)
  dateFormat   DateFormat   @default(MDY_SHORT)
  hour12       Boolean      @default(true)
  updatedAt    DateTime     @updatedAt
}

enum DistanceUnit {
  MILES
  KM
}

enum AreaUnit {
  SQFT
  SQM
}

/// MDY_SHORT "Jan 5, 2026", DMY_SHORT "5 Jan 2026", MDY_NUM "01/05/2026", DMY_NUM "05/01/2026", ISO "2026-01-05".
enum DateFormat {
  MDY_SHORT
  DMY_SHORT
  MDY_NUM
  DMY_NUM
  ISO
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_regional_settings`
Expected: new folder `prisma/migrations/*_add_regional_settings/` with `CREATE TABLE "RegionalSettings"`; client regenerated.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(regional): add RegionalSettings model"
```

---

### Task 2: Pure formatter

**Files:**
- Create: `lib/regional.ts`
- Test: `lib/regional.test.ts`

**Interfaces:**
- Consumes: enum types from `@/app/generated/prisma/client` (Task 1).
- Produces:
  ```ts
  export type Regional = { currency: string; distanceUnit: DistanceUnit; areaUnit: AreaUnit; dateFormat: DateFormat; hour12: boolean }
  export const DEFAULT_REGIONAL: Regional
  export const COMMON_CURRENCIES: string[]
  export function isValidCurrency(code: string): boolean
  export function createFormatter(r: Regional): Formatter
  export type Formatter = ReturnType<typeof createFormatter>
  export const DEFAULT_FORMAT: Formatter
  // Formatter members:
  money(n: number): string; moneyCompact(n: number): string; moneyWhole(n: number): string
  currencySymbol: string; currency: string
  distanceShort: "mi" | "km"; distanceWord: "mile" | "kilometre"; distanceWords: "miles" | "kilometres"; distanceNoun: "Mileage" | "Distance"
  meterShort(u: MeterUnit): string; meterWord(u: MeterUnit): string; meterNoun(u: MeterUnit): string
  areaShort: "ft²" | "m²"; areaWords: "square feet" | "square metres"; areaLabel: "Square footage" | "Floor area (m²)"
  area(n: number): string
  date(d: Date | string | number, opts?: { utc?: boolean; long?: boolean }): string
  dayMonth(d: Date | string | number, opts?: { utc?: boolean }): string
  time(d: Date | string | number): string
  clock(hhmm: string | null | undefined): string   // "14:30" → "2:30 PM" / "14:30"
  dateTime(d: Date | string | number): string
  ```

- [ ] **Step 1: Write the failing tests** — `lib/regional.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createFormatter, DEFAULT_REGIONAL, isValidCurrency, type Regional } from "./regional"

const fmt = (o: Partial<Regional> = {}) => createFormatter({ ...DEFAULT_REGIONAL, ...o })
const DAY = new Date("2026-01-05T00:00:00Z") // a stored day (UTC midnight)

describe("defaults reproduce today's output", () => {
  const f = fmt()
  it("money", () => {
    expect(f.money(1234.5)).toBe((1234.5).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  })
  it("compact money", () => {
    expect(f.moneyCompact(12480)).toBe("$12.5k")
    expect(f.moneyCompact(12000)).toBe("$12k")
    expect(f.moneyCompact(980.4)).toBe("$980")
  })
  it("whole money", () => {
    expect(f.moneyWhole(1234.56)).toBe((1234.56).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }))
  })
  it("units", () => {
    expect(f.meterShort("MILES")).toBe("mi")
    expect(f.meterShort("HOURS")).toBe("hrs")
    expect(f.meterNoun("MILES")).toBe("Mileage")
    expect(f.meterNoun("HOURS")).toBe("Hours")
    expect(f.meterWord("MILES")).toBe("mile")
    expect(f.meterWord("HOURS")).toBe("hour")
    expect(f.areaShort).toBe("ft²")
  })
  it("date (UTC day)", () => {
    expect(f.date(DAY, { utc: true })).toBe("Jan 5, 2026")
    expect(f.date(DAY, { utc: true, long: true })).toBe("January 5, 2026")
  })
  it("clock", () => {
    expect(f.clock("14:30")).toBe("2:30 PM")
    expect(f.clock("00:05")).toBe("12:05 AM")
    expect(f.clock(null)).toBe("")
  })
})

describe("date presets", () => {
  it.each([
    ["MDY_SHORT", "Jan 5, 2026", "Jan 5"],
    ["DMY_SHORT", "5 Jan 2026", "5 Jan"],
    ["MDY_NUM", "01/05/2026", "01/05"],
    ["DMY_NUM", "05/01/2026", "05/01"],
    ["ISO", "2026-01-05", "01-05"],
  ] as const)("%s", (dateFormat, full, short) => {
    const f = fmt({ dateFormat })
    expect(f.date(DAY, { utc: true })).toBe(full)
    expect(f.dayMonth(DAY, { utc: true })).toBe(short)
  })
  it("long only changes the word presets", () => {
    expect(fmt({ dateFormat: "DMY_SHORT" }).date(DAY, { utc: true, long: true })).toBe("5 January 2026")
    expect(fmt({ dateFormat: "ISO" }).date(DAY, { utc: true, long: true })).toBe("2026-01-05")
  })
  it("accepts ISO strings and numbers", () => {
    expect(fmt().date("2026-01-05T00:00:00Z", { utc: true })).toBe("Jan 5, 2026")
    expect(fmt().date(DAY.getTime(), { utc: true })).toBe("Jan 5, 2026")
  })
})

describe("utc vs local", () => {
  it("utc reads UTC fields; default reads local fields", () => {
    const d = new Date("2026-01-05T03:30:00Z")
    const f = fmt({ dateFormat: "ISO" })
    expect(f.date(d, { utc: true })).toBe("2026-01-05")
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    expect(f.date(d)).toBe(local)
  })
})

describe("time", () => {
  const d = new Date(2026, 0, 5, 14, 7)
  it("12h", () => expect(fmt().time(d)).toBe("2:07 PM"))
  it("24h", () => expect(fmt({ hour12: false }).time(d)).toBe("14:07"))
  it("24h clock", () => expect(fmt({ hour12: false }).clock("09:05")).toBe("09:05"))
  it("dateTime", () => expect(fmt({ dateFormat: "ISO", hour12: false }).dateTime(d)).toBe("2026-01-05 14:07"))
})

describe("currencies", () => {
  it("uses the currency's own decimals", () => {
    expect(fmt({ currency: "JPY" }).money(1234.56)).toBe((1235).toLocaleString(undefined, { style: "currency", currency: "JPY" }))
    expect(fmt({ currency: "KWD" }).money(1.5)).toBe((1.5).toLocaleString(undefined, { style: "currency", currency: "KWD" }))
    expect(fmt({ currency: "EUR" }).money(2)).toBe((2).toLocaleString(undefined, { style: "currency", currency: "EUR" }))
  })
  it("compact uses the symbol", () => {
    const f = fmt({ currency: "EUR" })
    expect(f.moneyCompact(12480)).toBe(`${f.currencySymbol}12.5k`)
    expect(f.currencySymbol).toBe("€")
  })
  it("falls back for a code Intl rejects", () => {
    expect(fmt({ currency: "ZZ" }).money(1234.5)).toBe(`ZZ ${(1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    expect(fmt({ currency: "ZZ" }).currencySymbol).toBe("ZZ")
  })
  it("validates codes", () => {
    expect(isValidCurrency("EUR")).toBe(true)
    expect(isValidCurrency("eur")).toBe(false)
    expect(isValidCurrency("ZZZ")).toBe(false)
    expect(isValidCurrency("")).toBe(false)
  })
})

describe("metric units", () => {
  const f = fmt({ distanceUnit: "KM", areaUnit: "SQM" })
  it("distance", () => {
    expect(f.meterShort("MILES")).toBe("km")
    expect(f.meterNoun("MILES")).toBe("Distance")
    expect(f.meterWord("MILES")).toBe("kilometre")
    expect(f.distanceWords).toBe("kilometres")
    expect(f.meterShort("HOURS")).toBe("hrs")
  })
  it("area", () => {
    expect(f.areaShort).toBe("m²")
    expect(f.area(1200)).toBe(`${(1200).toLocaleString()} m²`)
    expect(f.areaWords).toBe("square metres")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/regional.test.ts`
Expected: FAIL — `Cannot find module './regional'`.

- [ ] **Step 3: Implement** — `lib/regional.ts`:

```ts
import type { AreaUnit, DateFormat, DistanceUnit, MeterUnit } from "@/app/generated/prisma/client"

// The one place money, distances, areas and dates are written. Pure, so the
// server (getFormat) and the client (useFormat) share it. Label only: a unit
// setting says what stored numbers mean, it never converts them.

export type Regional = { currency: string; distanceUnit: DistanceUnit; areaUnit: AreaUnit; dateFormat: DateFormat; hour12: boolean }

export const DEFAULT_REGIONAL: Regional = { currency: "USD", distanceUnit: "MILES", areaUnit: "SQFT", dateFormat: "MDY_SHORT", hour12: true }

/** Shown first in the currency picker. */
export const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"]

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code)
}

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const pad = (n: number) => String(n).padStart(2, "0")

type When = Date | string | number
const toDate = (d: When) => (d instanceof Date ? d : new Date(d))

function ymd(d: Date, utc: boolean) {
  return utc
    ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() }
    : { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() }
}

function currencyFormat(currency: string, opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, ...opts })
  } catch {
    return null
  }
}

export function createFormatter(r: Regional) {
  const full = currencyFormat(r.currency)
  const whole = currencyFormat(r.currency, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
  const currencySymbol = full?.formatToParts(0).find((p) => p.type === "currency")?.value ?? r.currency
  const km = r.distanceUnit === "KM"
  const sqm = r.areaUnit === "SQM"

  const money = (n: number) =>
    full ? full.format(n) : `${r.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const date = (d: When, opts: { utc?: boolean; long?: boolean } = {}) => {
    const { y, m, day } = ymd(toDate(d), !!opts.utc)
    const mon = (opts.long ? LONG : SHORT)[m]
    switch (r.dateFormat) {
      case "DMY_SHORT": return `${day} ${mon} ${y}`
      case "MDY_NUM": return `${pad(m + 1)}/${pad(day)}/${y}`
      case "DMY_NUM": return `${pad(day)}/${pad(m + 1)}/${y}`
      case "ISO": return `${y}-${pad(m + 1)}-${pad(day)}`
      default: return `${mon} ${day}, ${y}`
    }
  }

  const dayMonth = (d: When, opts: { utc?: boolean } = {}) => {
    const { m, day } = ymd(toDate(d), !!opts.utc)
    switch (r.dateFormat) {
      case "DMY_SHORT": return `${day} ${SHORT[m]}`
      case "MDY_NUM": return `${pad(m + 1)}/${pad(day)}`
      case "DMY_NUM": return `${pad(day)}/${pad(m + 1)}`
      case "ISO": return `${pad(m + 1)}-${pad(day)}`
      default: return `${SHORT[m]} ${day}`
    }
  }

  const hm = (h: number, min: number) =>
    r.hour12 ? `${h % 12 || 12}:${pad(min)} ${h < 12 ? "AM" : "PM"}` : `${pad(h)}:${pad(min)}`

  const time = (d: When) => {
    const t = toDate(d)
    return hm(t.getHours(), t.getMinutes())
  }

  return {
    currency: r.currency,
    currencySymbol,
    money,
    moneyWhole: (n: number) => (whole ? whole.format(n) : `${r.currency} ${Math.round(n).toLocaleString()}`),
    /** Axis ticks and captions: "$12.5k", "€980". */
    moneyCompact: (n: number) =>
      Math.abs(n) >= 1000 ? `${currencySymbol}${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${currencySymbol}${Math.round(n)}`,
    distanceShort: km ? "km" : "mi",
    distanceWord: km ? "kilometre" : "mile",
    distanceWords: km ? "kilometres" : "miles",
    distanceNoun: km ? "Distance" : "Mileage",
    meterShort: (u: MeterUnit) => (u === "HOURS" ? "hrs" : km ? "km" : "mi"),
    meterWord: (u: MeterUnit) => (u === "HOURS" ? "hour" : km ? "kilometre" : "mile"),
    meterNoun: (u: MeterUnit) => (u === "HOURS" ? "Hours" : km ? "Distance" : "Mileage"),
    areaShort: sqm ? "m²" : "ft²",
    areaWords: sqm ? "square metres" : "square feet",
    areaLabel: sqm ? "Floor area (m²)" : "Square footage",
    area: (n: number) => `${n.toLocaleString()} ${sqm ? "m²" : "ft²"}`,
    date,
    dayMonth,
    time,
    /** A stored "HH:MM" wall-clock time. */
    clock: (hhmm: string | null | undefined) => {
      if (!hhmm) return ""
      const [h, min] = hhmm.split(":").map(Number)
      return hm(h, min)
    },
    dateTime: (d: When) => `${date(d)} ${time(d)}`,
  }
}

export type Formatter = ReturnType<typeof createFormatter>

export const DEFAULT_FORMAT: Formatter = createFormatter(DEFAULT_REGIONAL)
```

Note on the default `money` assertion: today's `formatMoney` forces exactly 2 decimals with USD; USD's own decimals are 2, so `full.format` matches. The test pins it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/regional.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/regional.ts lib/regional.test.ts
git commit -m "feat(regional): add pure formatter for money, units and dates"
```

---

### Task 3: Server loader and client provider

**Files:**
- Create: `lib/regional-server.ts`
- Create: `components/regional-provider.tsx`
- Modify: `app/(app)/layout.tsx:24-55`

**Interfaces:**
- Consumes: `Regional`, `DEFAULT_REGIONAL`, `createFormatter`, `Formatter` (Task 2).
- Produces:
  ```ts
  // lib/regional-server.ts
  export const REGIONAL_SETTINGS_ID = "singleton"
  export const loadRegionalSettings: () => Promise<Regional>   // React cache
  export async function getFormat(): Promise<Formatter>
  // components/regional-provider.tsx
  export function RegionalProvider(props: { value: Regional; children: React.ReactNode }): JSX.Element
  export function useFormat(): Formatter   // throws outside a provider
  ```

- [ ] **Step 1: Read the Next docs** for this version on `cache`, server components and client context: `node_modules/next/dist/docs/` (search for "use client" and "cache"). Follow any deprecation notices.

- [ ] **Step 2: Create `lib/regional-server.ts`**

```ts
import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { createFormatter, DEFAULT_REGIONAL, type Formatter, type Regional } from "@/lib/regional"

export const REGIONAL_SETTINGS_ID = "singleton"

let warned = false

/** The household's regional settings, or the defaults when nobody has saved them. Once per request. */
export const loadRegionalSettings = cache(async (): Promise<Regional> => {
  try {
    const row = await prisma.regionalSettings.findUnique({ where: { id: REGIONAL_SETTINGS_ID } })
    if (!row) return DEFAULT_REGIONAL
    const { currency, distanceUnit, areaUnit, dateFormat, hour12 } = row
    return { currency, distanceUnit, areaUnit, dateFormat, hour12 }
  } catch (error) {
    if (!warned) console.error("[regional] settings unreadable, using defaults:", error instanceof Error ? error.name : typeof error)
    warned = true
    return DEFAULT_REGIONAL
  }
})

export async function getFormat(): Promise<Formatter> {
  return createFormatter(await loadRegionalSettings())
}
```

- [ ] **Step 3: Create `components/regional-provider.tsx`**

```tsx
"use client"

import { createContext, useContext, useMemo } from "react"
import { createFormatter, type Formatter, type Regional } from "@/lib/regional"

const RegionalContext = createContext<Formatter | null>(null)

export function RegionalProvider({ value, children }: { value: Regional; children: React.ReactNode }) {
  const fmt = useMemo(() => createFormatter(value), [value])
  return <RegionalContext.Provider value={fmt}>{children}</RegionalContext.Provider>
}

/** The household formatter. Throws outside a RegionalProvider so a page can't silently show defaults. */
export function useFormat(): Formatter {
  const fmt = useContext(RegionalContext)
  if (!fmt) throw new Error("useFormat() needs a <RegionalProvider> above it")
  return fmt
}
```

`value` is a plain object from a server component; it's referentially stable per render, which is all `useMemo` needs.

- [ ] **Step 4: Mount in `app/(app)/layout.tsx`**

Add imports:
```ts
import { loadRegionalSettings } from "@/lib/regional-server"
import { RegionalProvider } from "@/components/regional-provider"
```
Change line 30 to load both:
```ts
const [features, regional] = await Promise.all([loadFeatures(), loadRegionalSettings()])
```
Wrap the returned tree — outermost, so chat and drop UIs can format too:
```tsx
return (
  <RegionalProvider value={regional}>
    <ChatProvider ...>
      ...
    </ChatProvider>
  </RegionalProvider>
)
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/regional-server.ts components/regional-provider.tsx "app/(app)/layout.tsx"
git commit -m "feat(regional): load settings on the server and provide a formatter to client components"
```

---

### Task 4: Settings tab and save action

**Files:**
- Create: `lib/actions/regional-settings.ts`
- Create: `components/settings/regional-settings.tsx`
- Modify: `lib/settings-sections.ts:1-25`
- Modify: `app/(app)/settings/page.tsx` (render the new section; follow how `features` is rendered there)

**Interfaces:**
- Consumes: `REGIONAL_SETTINGS_ID`, `loadRegionalSettings` (Task 3); `isValidCurrency`, `COMMON_CURRENCIES`, `createFormatter`, `Regional` (Task 2); `syncEntities` from `@/lib/search/entities/sync-server`.
- Produces: `saveRegionalSettings(data: Regional): Promise<{ error: string } | { success: true }>`; `RegionalSettingsForm({ initial }: { initial: Regional })`.

- [ ] **Step 1: Server action** — `lib/actions/regional-settings.ts` (mirror `lib/actions/feature-settings.ts`):

```ts
"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { REGIONAL_SETTINGS_ID } from "@/lib/regional-server"
import { isValidCurrency } from "@/lib/regional"
import { syncEntities } from "@/lib/search/entities/sync-server"

const schema = z.object({
  currency: z.string().refine(isValidCurrency, "Unknown currency code."),
  distanceUnit: z.enum(["MILES", "KM"]),
  areaUnit: z.enum(["SQFT", "SQM"]),
  dateFormat: z.enum(["MDY_SHORT", "DMY_SHORT", "MDY_NUM", "DMY_NUM", "ISO"]),
  hour12: z.boolean(),
})

export async function saveRegionalSettings(data: z.infer<typeof schema>): Promise<{ error: string } | { success: true }> {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  await prisma.regionalSettings.upsert({
    where: { id: REGIONAL_SETTINGS_ID },
    create: { id: REGIONAL_SETTINGS_ID, ...parsed.data },
    update: parsed.data,
  })
  // Every page writes money, units or dates.
  revalidatePath("/", "layout")
  // Search text carries money and unit words; only records whose text changed re-embed.
  void syncEntities().catch(() => {})
  return { success: true }
}
```

- [ ] **Step 2: Register the section** — in `lib/settings-sections.ts` add `Globe` to the lucide import, `"regional"` to `SettingsSectionId`, and after `features`:

```ts
  { id: "regional", label: "Regional", description: "Currency, units and date format", icon: Globe, adminOnly: true },
```

- [ ] **Step 3: Form component** — `components/settings/regional-settings.tsx`. Read `components/settings/feature-settings.tsx` first and reuse its card, label, `Select`/`Switch` UI components, toast and `useTransition` pattern exactly. Content:

```tsx
"use client"

import { useMemo, useState, useTransition } from "react"
import { saveRegionalSettings } from "@/lib/actions/regional-settings"
import { COMMON_CURRENCIES, createFormatter, type Regional } from "@/lib/regional"
// + the same UI imports feature-settings.tsx uses (Card, Label, Select, Switch, Button, toast)

const DATE_FORMATS = ["MDY_SHORT", "DMY_SHORT", "MDY_NUM", "DMY_NUM", "ISO"] as const

function currencyOptions(): string[] {
  const all = Intl.supportedValuesOf("currency")
  return [...COMMON_CURRENCIES, ...all.filter((c) => !COMMON_CURRENCIES.includes(c))]
}

export function RegionalSettingsForm({ initial }: { initial: Regional }) {
  const [value, setValue] = useState<Regional>(initial)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const preview = useMemo(() => createFormatter(value), [value])
  const now = useMemo(() => new Date(), [])
  const currencies = useMemo(currencyOptions, [])
  const set = <K extends keyof Regional>(k: K, v: Regional[K]) => setValue((p) => ({ ...p, [k]: v }))

  const save = () =>
    start(async () => {
      const r = await saveRegionalSettings(value)
      setError("error" in r ? r.error : null)
      // success: same toast as feature-settings.tsx
    })

  // Fields (one row each, labels left as in feature-settings):
  // - Currency: Select over `currencies`, option text `${code} (${createFormatter({ ...value, currency: code }).currencySymbol})`
  // - Distance: Select MILES "Miles (mi)" / KM "Kilometres (km)"
  // - Area: Select SQFT "Square feet (ft²)" / SQM "Square metres (m²)"
  //   Help text under both unit selects: "Changing units relabels existing values; it does not convert them."
  // - Date format: Select over DATE_FORMATS, option text = createFormatter({ ...value, dateFormat: f }).date(now)
  // - 24-hour clock: Switch, checked = !value.hour12, onCheckedChange = (on) => set("hour12", !on)
  // - Preview line: `${preview.money(1234.56)} · ${(12345).toLocaleString()} ${preview.distanceShort} · ${preview.area(1200)} · ${preview.dateTime(now)}`
  // - Error text (if any), Save button disabled while pending.
}
```

Write the JSX using the exact components found in `feature-settings.tsx`; every field listed in the comment block must be present.

- [ ] **Step 4: Render the section** — in `app/(app)/settings/page.tsx`, where other sections are switched on `section.id`, add:

```tsx
{section.id === "regional" && <RegionalSettingsForm initial={await loadRegionalSettings()} />}
```
(adapt to the page's existing switch style; import both symbols.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: pass. Also `lib/settings-sections` tests (if any reference the section count) still pass — update the expected list if a test enumerates sections.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/regional-settings.ts components/settings/regional-settings.tsx lib/settings-sections.ts "app/(app)/settings/page.tsx"
git commit -m "feat(regional): admin Regional settings tab"
```

---

### Task 5: Money everywhere in the UI

**Files (modify):** `lib/costs.ts:117-131` (delete `formatMoney`, `formatMoneyCompact`), and every importer of them, plus hand-built `$`:
`app/(app)/costs/page.tsx`, `app/(app)/page.tsx`, `app/(app)/records/page.tsx:91,166`, `app/(app)/assets/equipment/[id]/page.tsx:66`, `app/(app)/assets/properties/[id]/page.tsx:77`, `app/(app)/assets/vehicles/[id]/page.tsx`, `app/(app)/assets/people/[id]/page.tsx`, `components/costs/asset-cost-panel.tsx`, `components/charts/trend-chart.tsx`, `components/charts/spend-area.tsx`, `components/charts/ranked-bars.tsx`, `components/charts/composition-bar.tsx`, `components/dashboard/summary-card.tsx`, `components/dashboard/intake-card.tsx`, `components/inbox/inbox-item-card.tsx`, `components/inbox/attach-record-dialog.tsx`, `components/insurance/insurance-list.tsx`, `components/providers/providers-table.tsx`, `components/properties/property-list.tsx:38,51`, `components/service-records/service-record-list.tsx:179`, `components/report/asset-report.tsx`, `components/report/health-summary.tsx`, `lib/search/global-server.ts`.
Form labels "($)": `components/inbox/file-inbox-dialog.tsx:180`, `components/service-records/service-record-form-dialog.tsx:338`, `components/maintenance/complete-dialog.tsx:92`, `components/vehicles/vehicle-form-dialog.tsx:151`, `components/insurance/insurance-list.tsx:72-73`.

Get the authoritative list with:
`git grep -nE "formatMoney|\\(\\\$\\)|\\\$\\\$\\{|\"\\\$\"" -- app components lib`

**Interfaces:**
- Consumes: `useFormat()` (client), `getFormat()` (server), `Formatter.money / moneyCompact / currencySymbol`.

Transform rules (apply at each hit):

| Before | Client component (`"use client"`) | Server component / lib server code |
|---|---|---|
| `formatMoney(x)` | `const fmt = useFormat()` at top of component, then `fmt.money(x)` | `const fmt = await getFormat()` then `fmt.money(x)` |
| `formatMoneyCompact(x)` | `fmt.moneyCompact(x)` | same |
| `` `$${x.toLocaleString(...)}` `` | `fmt.money(x)` | same |
| label `"Cost ($)"` | `` `Cost (${fmt.currencySymbol})` `` | same |

Pure helpers that take no React context (e.g. a chart's tick formatter defined at module scope) get a `fmt: Formatter` parameter, passed from the component that calls `useFormat()`. Do not call `useFormat()` outside a component body.

- [ ] **Step 1: Pin the deleted helper's behavior.** Check `lib/costs.test.ts` for tests of `formatMoney`/`formatMoneyCompact`; move any such assertions into `lib/regional.test.ts` (as `fmt().money(...)` / `fmt().moneyCompact(...)`), then run `npx vitest run lib/regional.test.ts lib/costs.test.ts` — expected PASS.
- [ ] **Step 2: Delete** `formatMoney` and `formatMoneyCompact` from `lib/costs.ts`. Run `npx tsc --noEmit` — expected: errors listing every caller. This is the work list.
- [ ] **Step 3: Fix each caller** with the transform table until `npx tsc --noEmit` is clean.
- [ ] **Step 4: Hand-built `$` and "($)" labels** — fix every hit from the `git grep` above (they don't fail typecheck).
- [ ] **Step 5: Verify**

Run: `git grep -nE "formatMoney|\\(\\\$\\)" -- app components lib` → expected: no output.
Run: `npx tsc --noEmit; npm run lint; npm test` → pass.

- [ ] **Step 6: Commit**

```bash
git add -A app components lib
git commit -m "feat(regional): format money with the household currency"
```

---

### Task 6: Distance and area units in the UI, and the report page provider

**Files (modify):** `lib/maintenance-due.ts:3-13` (delete `meterUnitShort/Noun/Word`) and every importer (17 files — `npx tsc --noEmit` after deleting lists them, incl. `components/maintenance/*`, `components/vehicles/*`, `components/service-records/*`, `app/(app)/maintenance/page.tsx`, `app/(app)/assets/vehicles/[id]/page.tsx`, `lib/notifications/checker.ts`), and area sites: `app/(app)/assets/properties/[id]/page.tsx:76`, `components/properties/property-form-dialog.tsx:152`, `components/properties/property-list.tsx:36,49`, `lib/search/global-server.ts:335`. Plus `app/reports/[type]/[id]/page.tsx` (provider).

**Interfaces:**
- Consumes: `Formatter.meterShort / meterNoun / meterWord / areaShort / areaLabel / area`.

| Before | After |
|---|---|
| `meterUnitShort(u)` | `fmt.meterShort(u)` |
| `meterUnitNoun(u)` | `fmt.meterNoun(u)` |
| `meterUnitWord(u)` | `fmt.meterWord(u)` |
| `` `${n.toLocaleString()} ft²` `` / `sq ft` | `fmt.area(n)` |
| `"Square Footage"` label | `fmt.areaLabel` |
| a field label `"Interval (miles)"`, `"Remind … miles before"` etc. in maintenance forms | use `fmt.distanceWords` / `fmt.meterShort(unit)` |

`lib/notifications/checker.ts` is server code: call `const fmt = await getFormat()` once in the exported checker function and pass `fmt` into `dueMessage(title, due, fmt)`; replace `meterUnitWord(...)` with `fmt.meterWord(...)`.

- [ ] **Step 1: Delete the three helpers** from `lib/maintenance-due.ts`. Move any tests of them in `lib/maintenance-due.test.ts` to `lib/regional.test.ts` (already covered by "units" tests — delete duplicates). Run `npx tsc --noEmit` to list callers.
- [ ] **Step 2: Fix each caller** with the table.
- [ ] **Step 3: Area sites** — fix with `git grep -nE "ft²|sq ft|Square Footage|square feet" -- app components lib` (leave `lib/search/entities/text.ts` for Task 10 and `lib/report-server.ts`/`lib/backup/readable.ts` for Task 7).
- [ ] **Step 4: Report page provider** — in `app/reports/[type]/[id]/page.tsx` load `const regional = await loadRegionalSettings()` and wrap the rendered report in `<RegionalProvider value={regional}>…</RegionalProvider>`.
- [ ] **Step 5: Verify** — `npx tsc --noEmit; npm run lint; npm test` pass; `git grep -n "meterUnit\(Short\|Noun\|Word\)" -- app components lib` → no output.
- [ ] **Step 6: Commit**

```bash
git add -A app components lib
git commit -m "feat(regional): label distance and area with the household units"
```

---

### Task 7: Dates and times in the UI

**Files (modify):** `lib/health.ts:47-53` (delete `formatDay`), `lib/observations.ts:52-57` (delete `formatTime`), their callers (~14 files for `formatDay`; `tsc` lists them), and every `toLocaleDateString` / `toLocaleTimeString` / date-`toLocaleString` site:
`components/maintenance/snooze-menu.tsx:78`, `components/service-records/service-record-list.tsx:146`, `components/health/observation-pattern.tsx:6`, `components/report/asset-report.tsx:152,195,375,380,474,483`, `components/settings/data/format.ts:14`, `components/inbox/inbox-item-card.tsx:247`, `app/(app)/records/page.tsx:144`, `app/(app)/notifications/page.tsx:102`, `components/notification-bell.tsx:144`, `app/(app)/warranties/page.tsx`, `app/(app)/maintenance/page.tsx`, asset detail pages, and the rest found by:
`git grep -nE "toLocaleDateString|toLocaleTimeString|formatDay|formatTime" -- app components lib`

Leave alone: `lib/costs.ts:333-334` (month-name axis labels, not dates), `components/ui/calendar.tsx` (library), `lib/report-server.ts` (Task 8), `lib/backup/*` (machine/backup file names, not user display — check each hit; if it is shown to a user in the UI, migrate it).

**Interfaces:**
- Consumes: `Formatter.date / dayMonth / time / clock / dateTime`.

| Before | After |
|---|---|
| `formatDay(d)` (returns "—" for null) | `d ? fmt.date(d, { utc: true }) : "—"` |
| `toLocaleDateString(undefined, { timeZone: "UTC", ... })` with year | `fmt.date(d, { utc: true })` |
| `{ timeZone:"UTC", dateStyle:"long" }` / `month:"long"` | `fmt.date(d, { utc: true, long: true })` |
| `toLocaleDateString()` / no timeZone, with year | `fmt.date(d)` |
| `{ dateStyle: "long" }` no timeZone | `fmt.date(d, { long: true })` |
| `{ month:"short", day:"numeric" }` (no year), UTC | `fmt.dayMonth(d, { utc: true })` |
| `{ month:"short", day:"numeric", hour, minute }` | `` `${fmt.dayMonth(d)} ${fmt.time(d)}` `` |
| `toLocaleString()` / `{dateStyle, timeStyle}` on a Date | `fmt.dateTime(d)` (long dateStyle → `` `${fmt.date(d,{long:true})} ${fmt.time(d)}` ``) |
| `formatTime("14:30")` | `fmt.clock("14:30")` |

Keep each call site's `utc` exactly as the old code had it (Global Constraints).

- [ ] **Step 1: Move tests** of `formatDay` (`lib/health.test.ts`) and `formatTime` (`lib/observations.test.ts`) into `lib/regional.test.ts` as `fmt().date(...,{utc:true})` / `fmt().clock(...)` assertions with the same expected strings; delete the originals. Run `npx vitest run lib/regional.test.ts` → PASS.
- [ ] **Step 2: Delete** `formatDay` and `formatTime`; `npx tsc --noEmit` lists callers; fix each with the table.
- [ ] **Step 3: Fix the `toLocale*` sites** from the grep with the table.
- [ ] **Step 4: Verify** — `git grep -nE "toLocaleDateString|toLocaleTimeString|formatDay|formatTime\(" -- app components lib` → only `lib/regional.ts`, `lib/report-server.ts` (Task 8) and justified backup hits. `npx tsc --noEmit; npm run lint; npm test` pass.
- [ ] **Step 5: Commit**

```bash
git add -A app components lib
git commit -m "feat(regional): write dates and times in the household format"
```

---

### Task 8: Reports, notifications, digest, backup readable export

**Files (modify):** `lib/report-server.ts:81-85,210,225` (delete local `formatMoneyPlain` and date helper), `lib/notifications/digest.ts`, `lib/notifications/checker.ts` (dates if any remain), `lib/backup/readable.ts:120` (area label in readable export), `lib/backup/viewer.ts` hits from the Task 5–7 greps.

**Interfaces:**
- Consumes: `getFormat()`; `Formatter.moneyWhole / date / meterWord / distanceWords / area / areaWords`.

- [ ] **Step 1: Write a failing test** if `lib/report-server.ts` has pure helpers with tests (`lib/report-server.test.ts`); otherwise skip to Step 2. For each pure function that formats money/units/dates, add a `fmt: Formatter` parameter and a test asserting KM/EUR output, e.g.:

```ts
import { createFormatter, DEFAULT_REGIONAL } from "@/lib/regional"
const eur = createFormatter({ ...DEFAULT_REGIONAL, currency: "EUR", distanceUnit: "KM", areaUnit: "SQM" })
// expect(<helper>(..., eur)).toContain("km")
```
- [ ] **Step 2: Replace** `formatMoneyPlain(x)` → `fmt.moneyWhole(x)`; its UTC long date → `fmt.date(d, { utc: true, long: true })`; hardcoded `"miles"` (line 225) → `fmt.meterWord(unit)`/`fmt.distanceWords`; `sq ft` (line 210) → `fmt.area(n)`. Obtain `fmt` once per exported async function with `await getFormat()` and pass it down.
- [ ] **Step 3: `lib/backup/readable.ts:120`** — the readable export column header for `sqFt`: keep the column key `sqFt` (data stays raw) but label it with `fmt.areaShort` if it has a human label. Readable export runs server-side: `await getFormat()`.
- [ ] **Step 4: Digest** — `lib/notifications/digest.ts`: replace any money/date formatting with `fmt` from `await getFormat()`.
- [ ] **Step 5: Verify** — `git grep -nE "USD|miles|sq ft|toLocaleDateString" -- lib/report-server.ts lib/notifications lib/backup/readable.ts` → no output (except comments). `npx tsc --noEmit; npm run lint; npm test` pass.
- [ ] **Step 6: Commit**

```bash
git add -A lib
git commit -m "feat(regional): reports, notifications and digests follow regional settings"
```

---

### Task 9: Receipt capture amounts

**Files:**
- Create: `lib/capture/amount.ts`, `lib/capture/amount.test.ts`
- Modify: `lib/capture/parse.ts:84-85,124-125`, `lib/capture/llm-parse.ts:9-13,36-42,111-148`, `lib/capture-server.ts:94-104`

**Interfaces:**
- Produces:
  ```ts
  export function parseAmount(raw: string): number | null
  export const AMOUNT_RE: RegExp   // global, unicode; group 1 = the numeric text
  export function receiptPrompt(currency: string): string
  // readReceiptByLlm(text, makeChat, signal?, currency = "USD")
  ```
- Consumes: `loadRegionalSettings()` (Task 3) in `capture-server.ts`.

- [ ] **Step 1: Write failing tests** — `lib/capture/amount.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { AMOUNT_RE, parseAmount } from "./amount"

describe("parseAmount", () => {
  it.each([
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["12,50", 12.5],
    ["12.50", 12.5],
    ["$12.50", 12.5],
    ["12,50 €", 12.5],
    ["€ 1.234,56", 1234.56],
    ["EUR 99,00", 99],
    ["£7.05", 7.05],
    ["-12.50", -12.5],
    ["1,234", 1234],
    ["1.234", 1234],
    ["12", 12],
    ["1,234,567.89", 1234567.89],
    ["1.234.567,89", 1234567.89],
  ])("%s → %s", (raw, n) => expect(parseAmount(raw)).toBe(n))

  it.each(["", "   ", "abc", "€", "-", "1.2.3,4,5x"])("%j → null", (raw) => expect(parseAmount(raw)).toBeNull())
})

describe("AMOUNT_RE", () => {
  const found = (s: string) => [...s.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0]))
  it("finds US and European amounts with two decimals", () => {
    expect(found("Total $1,234.56")).toEqual([1234.56])
    expect(found("Gesamt 1.234,56 €")).toEqual([1234.56])
    expect(found("Total: 12,50")).toEqual([12.5])
  })
  it("ignores integers and phone-ish numbers", () => {
    expect(found("Qty 3, call 555 1234")).toEqual([])
  })
  it("does not glue a quantity onto a US price", () => {
    expect(found("Qty 2 450.00")).toEqual([450])
  })
  it("reads space-grouped European amounts", () => {
    expect(found("Total 1 234,56 €")).toEqual([1234.56])
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/capture/amount.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/capture/amount.ts`:

```ts
// Money in receipt text, written either way round: "1,234.56" or "1.234,56".
// Pure. The last separator followed by exactly two digits is the decimal mark;
// otherwise a lone separator followed by exactly three digits is grouping.

/**
 * An amount with two decimals, optionally led or followed by a currency symbol
 * or code. Space-grouped thousands ("1 234,56") only with a comma decimal, so a
 * US line "Qty 2 450.00" is not read as 2,450.
 */
export const AMOUNT_RE =
  /(?:\p{Sc}\s?|\b[A-Z]{3}\s)?-?(?:\d{1,3}(?:[\s  ]\d{3})+,\d{2}|(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2})\b(?:\s?\p{Sc})?/gu

export function parseAmount(raw: string): number | null {
  const s = raw.replace(/\p{Sc}|\b[A-Z]{3}\b/gu, "").trim()
  if (!/^-?[\d.,\s  ]+$/.test(s) || !/\d/.test(s)) return null
  const neg = s.startsWith("-")
  const body = s.replace(/^-/, "").replace(/[\s  ]/g, "")
  const lastSep = Math.max(body.lastIndexOf("."), body.lastIndexOf(","))
  let intPart = body
  let frac = ""
  if (lastSep >= 0) {
    const tail = body.slice(lastSep + 1)
    const mixed = new Set(body.match(/[.,]/g)).size > 1
    // Both marks present: the last is the decimal. One mark: three digits after it means grouping.
    const decimal = mixed || tail.length !== 3
    if (decimal) {
      intPart = body.slice(0, lastSep)
      frac = tail
    }
  }
  const digits = intPart.replace(/[.,]/g, "")
  // Grouping must be regular: groups of three after the first.
  if (intPart !== digits && !/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return null
  if (!/^\d+$/.test(digits) || (frac && !/^\d+$/.test(frac))) return null
  const n = Number(frac ? `${digits}.${frac}` : digits)
  return neg ? -n : n
}
```

- [ ] **Step 4: Run** `npx vitest run lib/capture/amount.test.ts` → PASS. If a case fails, fix `parseAmount`, not the test.

- [ ] **Step 5: Use it in `lib/capture/parse.ts`** — replace lines 84-85:

```ts
import { AMOUNT_RE, parseAmount } from "./amount"
const amounts = (s: string) => [...s.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0])).filter((n): n is number => n != null)
```
and line 125:
```ts
// A price, with or without a currency sign: an item line, not a name.
const MONEY = /\p{Sc}\s?\d|\b\d+[.,]\d{2}\b/u
```

- [ ] **Step 6: Regression** — `npx vitest run lib/capture` → all existing tests (incl. `accuracy.test.ts`, `parse.test.ts`) PASS. If accuracy drops, the new regex is too loose: tighten it and add the failing line as an `amount.test.ts` case.

- [ ] **Step 7: LLM prompt** — in `lib/capture/llm-parse.ts`:

```ts
export function receiptPrompt(currency: string): string {
  return `You read one household document (receipt, invoice, estimate or similar).
Reply with JSON only: {"date": "YYYY-MM-DD" or null, "total": number or null, "vendor": string or null}
date: the date the purchase, service, visit or test happened (not a due date, print date or date of birth).
total: the final amount charged as a plain number with a dot for decimals (grand total incl. tax; negative for a refund). The household's currency is ${currency}. null if the document shows no charge.
vendor: the business, clinic or provider that issued it.`
}
export const PROMPT = receiptPrompt("USD")
```
`validTotal` string branch: `return typeof v === "string" ? parseAmount(v) : null` after the number branch. Thread `currency` through: `ask(chat, text, signal, currency)` uses `receiptPrompt(currency)`; `readReceiptByLlm(text, makeChat, signal = …, currency = "USD")`. Add to `lib/capture/llm-parse.test.ts`:

```ts
it("names the household currency", () => {
  expect(receiptPrompt("EUR")).toContain("currency is EUR")
})
it("accepts a European total string", () => {
  expect(parseLlmReply('{"date":null,"total":"1.234,56","vendor":null}')?.total).toBe(1234.56)
})
```
(Existing PROMPT assertions keep passing since `PROMPT` = USD variant.)

- [ ] **Step 8: Pass currency from the server** — `lib/capture-server.ts` `readWithLlm`: `const { currency } = await loadRegionalSettings()` and pass it as the 4th argument to `readReceiptByLlm`.

- [ ] **Step 9: Verify** — `npx tsc --noEmit; npm run lint; npm test` pass.
- [ ] **Step 10: Commit**

```bash
git add lib/capture lib/capture-server.ts
git commit -m "feat(regional): read receipt totals in any currency and decimal style"
```

---

### Task 10: Assistant and search text

**Files (modify):** `lib/llm/prompt.ts:37,58`, `app/api/chat/route.ts:78`, `app/api/assistant-test/route.ts:51` (leave on defaults), `lib/llm/tools/shortcuts.ts:227`, `lib/llm/ontology.ts:95,103,107,168` (descriptions), `lib/llm/prompt.test.ts`; `lib/search/entities/text.ts:56-57,111-265`, `lib/search/entities/text.test.ts`, `lib/search/entities/sync-server.ts:24+`.

**Interfaces:**
- Consumes: `Formatter`, `DEFAULT_FORMAT`, `getFormat()`, `loadRegionalSettings()`.
- Produces: `buildSystemPrompt({ ..., fmt?: Formatter })` (default `DEFAULT_FORMAT`); every `*Doc(input, now, fmt = DEFAULT_FORMAT)` in `text.ts`; `intervalWords(days, miles, unit, fmt = DEFAULT_FORMAT)`.

- [ ] **Step 1: Failing prompt test** — add to `lib/llm/prompt.test.ts`:

```ts
import { createFormatter, DEFAULT_REGIONAL } from "@/lib/regional"

it("writes money and units the household way", () => {
  const fmt = createFormatter({ ...DEFAULT_REGIONAL, currency: "EUR", distanceUnit: "KM", areaUnit: "SQM" })
  const p = buildSystemPrompt({ now, fmt })
  expect(p).toContain(`Money as ${fmt.money(1234.56)}`)
  expect(p).toContain("Distances on odometers are in kilometres")
  expect(p).toContain("Areas are in square metres")
  expect(p).not.toContain("$1,234.56")
})
it("defaults keep dollars and miles", () => {
  expect(buildSystemPrompt({ now })).toContain(`Money as ${createFormatter(DEFAULT_REGIONAL).money(1234.56)}`)
})
```
Run `npx vitest run lib/llm/prompt.test.ts` → FAIL.

- [ ] **Step 2: Implement** — `buildSystemPrompt` gains `fmt = DEFAULT_FORMAT`; replace line 58 with:

```ts
    `- Money as ${fmt.money(1234.56)} (${fmt.currency}). Distances on odometers are in ${fmt.distanceWords}. Areas are in ${fmt.areaWords}. Stored numbers are already in these units: never convert them.`,
```
In `app/api/chat/route.ts` pass `fmt: await getFormat()`. Run the test → PASS. Note: the default line now reads `Money as $1,234.56 (USD). …` — update any existing prompt test that matches the exact old line.

- [ ] **Step 3: Tool output** — `lib/llm/tools/shortcuts.ts:227`: `currency: (await loadRegionalSettings()).currency,`.
- [ ] **Step 4: Ontology** — `lib/llm/ontology.ts`: make the odometer descriptions unit-neutral ("Current odometer (household distance unit) or hour-meter reading"; `sqFt`: add a description `"Floor area in the household area unit (field name is historical)"`). Unit names stay out of ontology so it stays static; the prompt line from Step 2 states the units. Run `npx vitest run lib/llm/ontology.test.ts` and update snapshot-style expectations if they assert exact text.
- [ ] **Step 5: Search text failing tests** — add to `lib/search/entities/text.test.ts`:

```ts
import { createFormatter, DEFAULT_REGIONAL } from "@/lib/regional"
const metric = createFormatter({ ...DEFAULT_REGIONAL, currency: "EUR", distanceUnit: "KM", areaUnit: "SQM" })

it("writes metric units and the household currency", () => {
  expect(intervalWords(90, 5000, "MILES", metric)).toBe("Repeats every 3 months or every 5,000 kilometres")
  // reuse the vehicle fixture from the existing "Commuter" test:
  // expect(vehicleDoc(commuter, now, metric).chunks[0]).toContain("About 28,900 kilometres on it")
})
```
(Fill the vehicle assertion using the fixture object already defined in that file.) Existing tests stay unchanged and must keep passing on the default.

- [ ] **Step 6: Implement** — in `text.ts` delete `dollars`; keep `num`. Add `fmt: Formatter = DEFAULT_FORMAT` as the last parameter of `propertyDoc`, `vehicleDoc`, `equipmentDoc`, `serviceDoc`, `maintenanceDoc`, `insuranceDoc`, `intervalWords` (and any other doc using money/units). Replace:
  - `` `${num(p.sqFt)} square feet` `` → `` `${num(p.sqFt)} ${fmt.areaWords}` ``
  - `dollars(x)` → `fmt.moneyWhole(x)`
  - `"miles"` in vehicle/service/interval/maintenance → `fmt.distanceWords`
  - Leave `"engine hours"` as is.
  In `sync-server.ts` `buildEntityDocs`: `const fmt = await getFormat()` and pass `fmt` to each doc builder call.
- [ ] **Step 7: Verify** — `npx vitest run lib/search lib/llm` PASS; `npx tsc --noEmit; npm run lint; npm test` pass.
- [ ] **Step 8: Commit**

```bash
git add -A lib app/api
git commit -m "feat(regional): assistant and search text use the household currency and units"
```

---

### Task 11: Regression guard and final verification

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Add the rule** to `eslint.config.mjs` after `...nextTs,`:

```js
  {
    // Money, units and dates go through lib/regional.ts so they follow Settings → Regional.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["lib/regional.ts", "**/*.test.ts", "lib/llm/model-test/**", "components/ui/**", "app/generated/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]", message: "Use fmt.date/fmt.time from lib/regional.ts." },
        { selector: "Literal[value='USD']", message: "Use the household currency (getFormat/useFormat)." },
      ],
    },
  },
```

- [ ] **Step 2: Run lint** — `npm run lint`. Expected: clean. Any hit is a missed call site: fix it with the Task 5/7 tables (not with a disable comment) — except `lib/backup/*` hits that format machine-facing timestamps, which get `// eslint-disable-next-line no-restricted-syntax -- file name, not display` only if they are truly not shown to users.

- [ ] **Step 3: Full verification**

Run: `npm ci; npx prisma generate; npx tsc --noEmit; npm run lint; npm test`
Expected: all succeed; report the test count line.

- [ ] **Step 4: Manual check in the app** (use the `run` skill to start it). As admin, Settings → Regional: set EUR / km / m² / "5 Jan 2026" / 24h, save. Visit and confirm no `$`, `mi`, `ft²`, `Jan 5,`, `AM/PM` on: dashboard, Costs, Records, a vehicle, a property, Maintenance, Warranties, Notifications bell, a report (`/reports/...`), Intake card, and ask the assistant "how much did we spend on the Civic?". Then set back to defaults and confirm the dashboard looks as before.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(regional): lint guard against hardcoded USD and locale date calls"
```
