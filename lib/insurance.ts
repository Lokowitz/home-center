// Imported by the backup engine (lib/backup/readable.ts): runtime imports aren't allowed here, only `import type`.
import type { FieldOption } from "@/lib/form-types"

export type InsuranceKindValue = "MEDICAL" | "DENTAL" | "VISION" | "OTHER" | "HOME" | "RENTERS" | "AUTO" | "UMBRELLA" | "LIFE" | "PROPERTY_OTHER"

export const HEALTH_INSURANCE_KINDS = ["MEDICAL", "DENTAL", "VISION", "OTHER"] as const
/// Same as HEALTH_WINDOWS.insuranceDays in lib/health.ts; a test keeps them equal.
export const HEALTH_POLICY_DAYS = 60
export const POLICY_RENEWAL_DAYS = 30

export const INSURANCE_KINDS: FieldOption[] = [
  { value: "HOME", label: "Home" },
  { value: "RENTERS", label: "Renters" },
  { value: "AUTO", label: "Auto" },
  { value: "UMBRELLA", label: "Umbrella" },
  { value: "LIFE", label: "Life" },
  { value: "PROPERTY_OTHER", label: "Other" },
  { value: "MEDICAL", label: "Medical" },
  { value: "DENTAL", label: "Dental" },
  { value: "VISION", label: "Vision" },
  { value: "OTHER", label: "Other (health)" },
]

export function isHealthInsuranceKind(kind: string): boolean {
  return (HEALTH_INSURANCE_KINDS as readonly string[]).includes(kind)
}

export function insuranceKindLabel(kind: string): string {
  return INSURANCE_KINDS.find((k) => k.value === kind)?.label ?? kind
}

export function kindOptions(health: boolean): FieldOption[] {
  return health ? INSURANCE_KINDS : INSURANCE_KINDS.filter((k) => !isHealthInsuranceKind(k.value))
}

export type PolicyGroup = "PROPERTY" | "LIFE" | "HEALTH"

const GROUP_TITLES: Record<PolicyGroup, string> = { PROPERTY: "Property and auto", LIFE: "Life", HEALTH: "Health" }

function policyGroup(kind: string): PolicyGroup {
  if (kind === "LIFE") return "LIFE"
  return isHealthInsuranceKind(kind) ? "HEALTH" : "PROPERTY"
}

export function groupPolicies<T extends { kind: string }>(
  policies: T[],
  health: boolean,
): { group: PolicyGroup; title: string; policies: T[] }[] {
  const order: PolicyGroup[] = health ? ["PROPERTY", "LIFE", "HEALTH"] : ["PROPERTY", "LIFE"]
  return order
    .map((group) => ({ group, title: GROUP_TITLES[group], policies: policies.filter((p) => policyGroup(p.kind) === group) }))
    .filter((g) => g.policies.length > 0)
}

/// Health kinds link people. LIFE links people too, but people are health data, so only with Health on.
/// Everything else links properties and vehicles.
export function allowedLinks(kind: string, health: boolean): { members: boolean; assets: boolean } {
  if (kind === "LIFE") return { members: health, assets: false }
  if (isHealthInsuranceKind(kind)) return { members: health, assets: false }
  return { members: false, assets: true }
}

export type LinkIds = { memberIds: string[]; propertyIds: string[]; vehicleIds: string[] }

/// What to write for a policy's links. With Health off `members` is left out, so editing a life
/// policy never wipes who it covers; a kind that can't carry people at all clears them instead.
export function linkWrites(
  kind: string,
  health: boolean,
  ids: LinkIds,
):
  | { ok: true; members?: string[]; properties: string[]; vehicles: string[] }
  | { ok: false; field: "kind" | "memberIds"; error: string } {
  if (!health && isHealthInsuranceKind(kind)) return { ok: false, field: "kind", error: "Health is turned off in Settings." }
  const allowed = allowedLinks(kind, health)
  const properties = allowed.assets ? ids.propertyIds : []
  const vehicles = allowed.assets ? ids.vehicleIds : []
  if (!health) {
    if (ids.memberIds.length > 0) return { ok: false, field: "memberIds", error: "Turn on Health in Settings to link people." }
    return allowedLinks(kind, true).members ? { ok: true, properties, vehicles } : { ok: true, members: [], properties, vehicles }
  }
  return { ok: true, members: allowed.members ? ids.memberIds : [], properties, vehicles }
}

export function renewalWindowDays(kind: string): number {
  return isHealthInsuranceKind(kind) ? HEALTH_POLICY_DAYS : POLICY_RENEWAL_DAYS
}

/// Same formula as daysUntil in lib/health.ts, written out so this file needs no runtime import.
function daysUntil(date: Date, now: Date): number {
  return Math.ceil((new Date(date).getTime() - now.getTime()) / 86_400_000) || 0
}

export function policyStatus(
  p: { kind: string; endDate: Date | null },
  now: Date,
): { label: string; variant: "outline" | "secondary" | "destructive" } {
  if (!p.endDate) return { label: "Active", variant: "outline" }
  const days = daysUntil(p.endDate, now)
  if (days < 0) return { label: "Ended", variant: "secondary" }
  if (days > renewalWindowDays(p.kind)) return { label: "Active", variant: "outline" }
  const verb = isHealthInsuranceKind(p.kind) ? "Ends" : "Renews"
  return { label: days === 0 ? `${verb} today` : `${verb} in ${days}d`, variant: "destructive" }
}

export function renewalNotice(
  p: { carrier: string; planName: string | null; kind: string; endDate: Date | null },
  now: Date,
): { title: string; message: string; stage: "REACHED" | "DUE" } | null {
  if (isHealthInsuranceKind(p.kind) || !p.endDate) return null
  const days = daysUntil(p.endDate, now)
  if (days < 0 || days > POLICY_RENEWAL_DAYS) return null
  const name = [p.carrier, p.planName].filter(Boolean).join(" ")
  return {
    title: `Renewal coming up: ${name}`,
    message: days === 0 ? `"${name}" renews today.` : `"${name}" renews in ${days} day${days === 1 ? "" : "s"}.`,
    stage: days === 0 ? "DUE" : "REACHED",
  }
}

export type PremiumPeriodValue = "MONTHLY" | "SEMIANNUAL" | "ANNUAL"

export const PREMIUM_PERIODS: FieldOption[] = [
  { value: "ANNUAL", label: "Yearly" },
  { value: "SEMIANNUAL", label: "Every 6 months" },
  { value: "MONTHLY", label: "Monthly" },
]

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, SEMIANNUAL: 2, ANNUAL: 1 }

export function annualPremium(p: { amount: number; period: string }): number {
  return Math.round(p.amount * (PERIODS_PER_YEAR[p.period] ?? 1) * 100) / 100
}

export type PremiumLike = { effectiveDate: Date; amount: number; period: string; createdAt?: Date }

/// Current = the newest premium already in effect, or the earliest one when all are in the future.
/// Ties on the same date go to the later createdAt.
export function currentAndPrevious<T extends PremiumLike>(premiums: T[], now: Date): { current: T | null; previous: T | null } {
  if (premiums.length === 0) return { current: null, previous: null }
  const sorted = [...premiums].sort(
    (x, y) =>
      new Date(x.effectiveDate).getTime() - new Date(y.effectiveDate).getTime() ||
      (x.createdAt ? new Date(x.createdAt).getTime() : 0) - (y.createdAt ? new Date(y.createdAt).getTime() : 0),
  )
  let index = 0
  sorted.forEach((p, i) => {
    if (new Date(p.effectiveDate).getTime() <= now.getTime()) index = i
  })
  return { current: sorted[index], previous: index > 0 ? sorted[index - 1] : null }
}

/// Change in yearly cost from the previous premium, as a fraction (0.12 = up 12%).
export function premiumChange(current: PremiumLike | null, previous: PremiumLike | null): number | null {
  if (!current || !previous) return null
  const before = annualPremium(previous)
  if (before === 0) return null
  return (annualPremium(current) - before) / before
}

export function premiumChangeLabel(change: number | null): string | null {
  if (change == null) return null
  const pct = Math.round(change * 100)
  if (pct === 0) return "Same as last term"
  return `${pct > 0 ? "+" : ""}${pct}% vs last term`
}

const COVERAGE_SUGGESTIONS: Record<string, string[]> = {
  HOME: ["Dwelling", "Other structures", "Personal property", "Loss of use", "Liability", "Medical payments"],
  RENTERS: ["Personal property", "Loss of use", "Liability", "Medical payments"],
  AUTO: ["Bodily injury", "Property damage", "Collision", "Comprehensive", "Uninsured motorist"],
  UMBRELLA: ["Liability"],
  LIFE: ["Death benefit"],
}

export function coverageSuggestions(kind: string): string[] {
  return COVERAGE_SUGGESTIONS[kind] ?? []
}

export type CoverageRow = { label: string; limit: number | null; deductible: number | null; sortOrder: number }

/// Keeps lines that have a name, in the order given.
export function coverageRows(rows: { label: string | null; limit: number | null; deductible: number | null }[]): CoverageRow[] {
  return rows
    .map((r) => ({ label: (r.label ?? "").trim(), limit: r.limit, deductible: r.deductible }))
    .filter((r) => r.label !== "")
    .map((r, i) => ({ ...r, sortOrder: i }))
}

type PolicyCoverage = { kind: string; coverages: { label: string; limit: number | null }[] }

/// Sum of the "Personal property" limits on non-health policies; null when none has a limit.
export function personalPropertyCoverage(policies: PolicyCoverage[]): number | null {
  let total: number | null = null
  for (const p of policies) {
    if (isHealthInsuranceKind(p.kind)) continue
    for (const c of p.coverages) {
      if (c.label.trim().toLowerCase() === "personal property" && c.limit != null) total = (total ?? 0) + c.limit
    }
  }
  return total
}

/// Belongings against personal property coverage; null unless both are known.
export function belongingsComparison(
  contents: { priced: number; withReplacementCost: number; toReplaceOrPaid: number },
  policies: PolicyCoverage[],
): { belongings: number; coverage: number } | null {
  if (contents.priced === 0 && contents.withReplacementCost === 0) return null
  const coverage = personalPropertyCoverage(policies)
  return coverage == null ? null : { belongings: contents.toReplaceOrPaid, coverage }
}

// ─── Linking from an asset's own edit dialog ─────────────────────────────────

export type LinkSide = "members" | "properties" | "vehicles"

/// Whether a policy of this kind may link to this side. People are "members"; properties and vehicles are assets.
export function linksSide(kind: string, health: boolean, side: LinkSide): boolean {
  const allowed = allowedLinks(kind, health)
  return side === "members" ? allowed.members : allowed.assets
}

/// Kinds that may link to this side, in INSURANCE_KINDS order.
export function eligibleKinds(side: LinkSide, health: boolean): InsuranceKindValue[] {
  return INSURANCE_KINDS.map((k) => k.value as InsuranceKindValue).filter((kind) => linksSide(kind, health, side))
}

/// "State Farm · Homeowners HO-3 · Home": the kind is there because one carrier often writes both home and auto.
export function policyChoiceLabel(p: { carrier: string; planName: string | null; kind: string }): string {
  return [p.carrier, p.planName, insuranceKindLabel(p.kind)].filter(Boolean).join(" · ")
}

/// Connects and disconnects for one asset. Only eligible policies are touched; ids not in `policies`
/// or not eligible are ignored. Output order follows `policies`.
export function assetPolicyDiff(
  side: LinkSide,
  health: boolean,
  policies: { id: string; kind: string; linked: boolean }[],
  chosen: string[],
): { connect: string[]; disconnect: string[] } {
  const wanted = new Set(chosen)
  const connect: string[] = []
  const disconnect: string[] = []
  for (const p of policies) {
    if (!linksSide(p.kind, health, side)) continue
    if (wanted.has(p.id) && !p.linked) connect.push(p.id)
    else if (!wanted.has(p.id) && p.linked) disconnect.push(p.id)
  }
  return { connect, disconnect }
}
