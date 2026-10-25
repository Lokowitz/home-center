import { describe, expect, it } from "vitest"
import { HEALTH_WINDOWS } from "./health"
import {
  allowedLinks,
  annualPremium,
  assetPolicyDiff,
  belongingsComparison,
  coverageRows,
  coverageSuggestions,
  currentAndPrevious,
  eligibleKinds,
  groupPolicies,
  HEALTH_POLICY_DAYS,
  insuranceKindLabel,
  isHealthInsuranceKind,
  kindOptions,
  linksSide,
  linkWrites,
  personalPropertyCoverage,
  policyChoiceLabel,
  policyStatus,
  premiumChange,
  premiumChangeLabel,
  renewalNotice,
} from "./insurance"

const now = new Date("2026-10-24T00:00:00Z")
const d = (s: string) => new Date(s)

describe("insurance kinds and links", () => {
  it("tells health kinds from the rest", () => {
    for (const k of ["MEDICAL", "DENTAL", "VISION", "OTHER"]) expect(isHealthInsuranceKind(k)).toBe(true)
    for (const k of ["HOME", "RENTERS", "AUTO", "UMBRELLA", "LIFE", "PROPERTY_OTHER"]) expect(isHealthInsuranceKind(k)).toBe(false)
    expect(HEALTH_POLICY_DAYS).toBe(HEALTH_WINDOWS.insuranceDays)
  })

  it("labels kinds", () => {
    expect(insuranceKindLabel("OTHER")).toBe("Other (health)")
    expect(insuranceKindLabel("PROPERTY_OTHER")).toBe("Other")
    expect(insuranceKindLabel("UMBRELLA")).toBe("Umbrella")
    expect(insuranceKindLabel("XYZ")).toBe("XYZ")
  })

  it("offers health kinds only while Health is on", () => {
    const six = ["HOME", "RENTERS", "AUTO", "UMBRELLA", "LIFE", "PROPERTY_OTHER"]
    expect(kindOptions(false).map((o) => o.value)).toEqual(six)
    expect(kindOptions(true).map((o) => o.value)).toEqual([...six, "MEDICAL", "DENTAL", "VISION", "OTHER"])
  })

  it("groups policies: property and auto, life, then health", () => {
    const input = ["MEDICAL", "LIFE", "AUTO", "HOME"].map((kind, i) => ({ id: `p${i}`, kind }))
    const on = groupPolicies(input, true)
    expect(on.map((g) => g.title)).toEqual(["Property and auto", "Life", "Health"])
    expect(on[0].policies.map((p) => p.kind)).toEqual(["AUTO", "HOME"])
    expect(groupPolicies(input, false).map((g) => g.title)).toEqual(["Property and auto", "Life"])
    expect(groupPolicies([{ id: "m", kind: "MEDICAL" }], true).map((g) => g.title)).toEqual(["Health"])
    expect(groupPolicies([], true)).toEqual([])
  })

  it("decides which links a kind may carry", () => {
    expect(allowedLinks("HOME", true)).toEqual({ members: false, assets: true })
    expect(allowedLinks("LIFE", true)).toEqual({ members: true, assets: false })
    expect(allowedLinks("LIFE", false)).toEqual({ members: false, assets: false })
    expect(allowedLinks("MEDICAL", true)).toEqual({ members: true, assets: false })
    expect(allowedLinks("UMBRELLA", false)).toEqual({ members: false, assets: true })
  })

  it("drops links the kind can't carry", () => {
    const ids = { memberIds: ["h1"], propertyIds: ["p1"], vehicleIds: ["v1"] }
    expect(linkWrites("HOME", true, ids)).toEqual({ ok: true, members: [], properties: ["p1"], vehicles: ["v1"] })
    expect(linkWrites("LIFE", true, ids)).toEqual({ ok: true, members: ["h1"], properties: [], vehicles: [] })
    expect(linkWrites("MEDICAL", true, ids)).toEqual({ ok: true, members: ["h1"], properties: [], vehicles: [] })
  })

  it("refuses health data while Health is off and leaves people alone", () => {
    const ids = { memberIds: ["h1"], propertyIds: ["p1"], vehicleIds: ["v1"] }
    expect(linkWrites("MEDICAL", false, ids)).toEqual({ ok: false, field: "kind", error: "Health is turned off in Settings." })
    expect(linkWrites("LIFE", false, ids)).toEqual({ ok: false, field: "memberIds", error: "Turn on Health in Settings to link people." })
    const life = linkWrites("LIFE", false, { memberIds: [], propertyIds: ["p1"], vehicleIds: [] })
    expect(life).toMatchObject({ ok: true, properties: [], vehicles: [] })
    expect(life).not.toHaveProperty("members")
    expect(linkWrites("AUTO", false, { memberIds: [], propertyIds: [], vehicleIds: ["v1", "v2"] })).toMatchObject({ ok: true, vehicles: ["v1", "v2"] })
  })

  it("clears people when a kind that can't carry them is saved with Health off", () => {
    // LIFE -> HOME while Health is off: the policy must not keep covering people under a property kind.
    expect(linkWrites("HOME", false, { memberIds: [], propertyIds: ["p1"], vehicleIds: [] })).toEqual({ ok: true, members: [], properties: ["p1"], vehicles: [] })
    expect(linkWrites("AUTO", false, { memberIds: [], propertyIds: [], vehicleIds: ["v1"] })).toMatchObject({ members: [] })
  })

  it("shows status with the window for the kind", () => {
    expect(policyStatus({ kind: "HOME", endDate: null }, now)).toEqual({ label: "Active", variant: "outline" })
    expect(policyStatus({ kind: "HOME", endDate: d("2026-11-10") }, now)).toEqual({ label: "Renews in 17d", variant: "destructive" })
    expect(policyStatus({ kind: "HOME", endDate: d("2026-10-24") }, now).label).toBe("Renews today")
    expect(policyStatus({ kind: "HOME", endDate: d("2026-12-20") }, now).label).toBe("Active")
    expect(policyStatus({ kind: "HOME", endDate: d("2026-10-01") }, now)).toEqual({ label: "Ended", variant: "secondary" })
    expect(policyStatus({ kind: "MEDICAL", endDate: d("2026-12-20") }, now)).toEqual({ label: "Ends in 57d", variant: "destructive" })
    expect(policyStatus({ kind: "MEDICAL", endDate: d("2026-10-24") }, now).label).toBe("Ends today")
  })

  it("raises a renewal notice 30 days out for non-health kinds only", () => {
    const p = { carrier: "State Farm", planName: "Homeowners", kind: "HOME" }
    expect(renewalNotice({ ...p, endDate: d("2026-11-23") }, now)).toEqual({
      title: "Renewal coming up: State Farm Homeowners",
      message: '"State Farm Homeowners" renews in 30 days.',
      stage: "REACHED",
    })
    expect(renewalNotice({ ...p, endDate: d("2026-11-24") }, now)).toBeNull()
    expect(renewalNotice({ ...p, endDate: d("2026-10-25") }, now)?.message).toBe('"State Farm Homeowners" renews in 1 day.')
    const today = renewalNotice({ ...p, endDate: d("2026-10-24") }, now)
    expect(today?.message).toBe('"State Farm Homeowners" renews today.')
    expect(today?.stage).toBe("DUE")
    expect(renewalNotice({ ...p, endDate: d("2026-10-23") }, now)).toBeNull()
    expect(renewalNotice({ ...p, endDate: null }, now)).toBeNull()
    expect(renewalNotice({ ...p, kind: "MEDICAL", endDate: d("2026-11-10") }, now)).toBeNull()
    expect(renewalNotice({ ...p, planName: null, endDate: d("2026-11-10") }, now)?.message).toBe('"State Farm" renews in 17 days.')
  })
})

describe("premiums and coverage", () => {
  const a = { effectiveDate: d("2024-11-01"), amount: 1500, period: "ANNUAL" }
  const b = { effectiveDate: d("2025-11-01"), amount: 1680, period: "ANNUAL" }
  const c = { effectiveDate: d("2026-11-01"), amount: 1900, period: "ANNUAL" }

  it("annualises premiums", () => {
    expect(annualPremium({ amount: 100, period: "MONTHLY" })).toBe(1200)
    expect(annualPremium({ amount: 612.5, period: "SEMIANNUAL" })).toBe(1225)
    expect(annualPremium({ amount: 1840, period: "ANNUAL" })).toBe(1840)
    expect(annualPremium({ amount: 33.33, period: "MONTHLY" })).toBe(399.96)
  })

  it("picks the current and previous premium", () => {
    const shuffled = [c, a, b]
    expect(currentAndPrevious(shuffled, d("2026-10-24"))).toEqual({ current: b, previous: a })
    expect(currentAndPrevious(shuffled, d("2026-11-01"))).toEqual({ current: c, previous: b })
    expect(currentAndPrevious([c], d("2026-10-24"))).toEqual({ current: c, previous: null })
    expect(currentAndPrevious([], d("2026-10-24"))).toEqual({ current: null, previous: null })
    const early = { ...b, createdAt: d("2025-11-01T09:00:00Z") }
    const late = { ...b, amount: 1700, createdAt: d("2025-11-01T10:00:00Z") }
    expect(currentAndPrevious([late, early], d("2026-10-24"))).toEqual({ current: late, previous: early })
  })

  it("compares premiums by their yearly cost", () => {
    expect(premiumChange(b, a)).toBeCloseTo(0.12)
    expect(premiumChange({ effectiveDate: d("2026-01-01"), amount: 150, period: "MONTHLY" }, a)).toBeCloseTo(0.2)
    expect(premiumChange(b, null)).toBeNull()
    expect(premiumChange(b, { ...a, amount: 0 })).toBeNull()
  })

  it("words the change", () => {
    expect(premiumChangeLabel(0.12)).toBe("+12% vs last term")
    expect(premiumChangeLabel(-0.054)).toBe("-5% vs last term")
    expect(premiumChangeLabel(0.004)).toBe("Same as last term")
    expect(premiumChangeLabel(null)).toBeNull()
  })

  it("suggests coverage names by kind", () => {
    expect(coverageSuggestions("HOME")).toEqual(["Dwelling", "Other structures", "Personal property", "Loss of use", "Liability", "Medical payments"])
    expect(coverageSuggestions("AUTO")).toEqual(["Bodily injury", "Property damage", "Collision", "Comprehensive", "Uninsured motorist"])
    expect(coverageSuggestions("UMBRELLA")).toEqual(["Liability"])
    expect(coverageSuggestions("LIFE")).toEqual(["Death benefit"])
    expect(coverageSuggestions("RENTERS")).toEqual(["Personal property", "Loss of use", "Liability", "Medical payments"])
    expect(coverageSuggestions("MEDICAL")).toEqual([])
    expect(coverageSuggestions("PROPERTY_OTHER")).toEqual([])
  })

  it("keeps named coverage lines in order", () => {
    expect(
      coverageRows([
        { label: " Dwelling ", limit: 450000, deductible: 2500 },
        { label: null, limit: null, deductible: null },
        { label: "Personal property", limit: 225000, deductible: null },
      ]),
    ).toEqual([
      { label: "Dwelling", limit: 450000, deductible: 2500, sortOrder: 0 },
      { label: "Personal property", limit: 225000, deductible: null, sortOrder: 1 },
    ])
    expect(coverageRows([{ label: "  ", limit: 1000, deductible: null }])).toEqual([])
  })

  it("adds up personal property coverage across non-health policies", () => {
    const line = (label: string, limit: number | null) => ({ label, limit })
    expect(
      personalPropertyCoverage([
        { kind: "HOME", coverages: [line("Dwelling", 450000), line(" personal PROPERTY ", 225000)] },
        { kind: "UMBRELLA", coverages: [line("Personal property", null)] },
        { kind: "RENTERS", coverages: [line("Personal property", 20000)] },
        { kind: "MEDICAL", coverages: [line("Personal property", 5000)] },
        { kind: "HOME", coverages: [line("Personal property (scheduled items)", 9000)] },
      ]),
    ).toBe(245000)
    expect(personalPropertyCoverage([{ kind: "HOME", coverages: [line("Dwelling", 450000)] }])).toBeNull()
    expect(personalPropertyCoverage([{ kind: "HOME", coverages: [line("Personal property", null)] }])).toBeNull()
  })

  it("compares belongings with personal property coverage only when both exist", () => {
    const home = [{ kind: "HOME", coverages: [{ label: "Personal property", limit: 225000 }] }]
    expect(belongingsComparison({ priced: 3, withReplacementCost: 2, toReplaceOrPaid: 18450 }, home)).toEqual({ belongings: 18450, coverage: 225000 })
    expect(belongingsComparison({ priced: 0, withReplacementCost: 0, toReplaceOrPaid: 0 }, home)).toBeNull()
    expect(belongingsComparison({ priced: 3, withReplacementCost: 2, toReplaceOrPaid: 18450 }, [{ kind: "HOME", coverages: [] }])).toBeNull()
    expect(belongingsComparison({ priced: 1, withReplacementCost: 0, toReplaceOrPaid: 0 }, home)).toEqual({ belongings: 0, coverage: 225000 })
  })
})

describe("linking policies from an asset", () => {
  it("lists the kinds each side can link", () => {
    const assetKinds = ["HOME", "RENTERS", "AUTO", "UMBRELLA", "PROPERTY_OTHER"]
    expect(eligibleKinds("properties", false)).toEqual(assetKinds)
    expect(eligibleKinds("vehicles", false)).toEqual(assetKinds)
    expect(eligibleKinds("properties", true)).toEqual(eligibleKinds("properties", false))
    expect(eligibleKinds("members", true)).toEqual(["LIFE", "MEDICAL", "DENTAL", "VISION", "OTHER"])
    expect(eligibleKinds("members", false)).toEqual([])
    expect(linksSide("LIFE", true, "vehicles")).toBe(false)
    expect(linksSide("UMBRELLA", true, "members")).toBe(false)
    expect(linksSide("AUTO", false, "properties")).toBe(true)
  })

  it("labels a policy choice", () => {
    expect(policyChoiceLabel({ carrier: "State Farm", planName: "Homeowners HO-3", kind: "HOME" })).toBe("State Farm · Homeowners HO-3 · Home")
    expect(policyChoiceLabel({ carrier: "Delta Dental", planName: null, kind: "DENTAL" })).toBe("Delta Dental · Dental")
    expect(policyChoiceLabel({ carrier: "Aflac", planName: "", kind: "OTHER" })).toBe("Aflac · Other (health)")
  })

  it("connects and disconnects only this asset's eligible policies", () => {
    const policies = [
      { id: "home", kind: "HOME", linked: true },
      { id: "umb", kind: "UMBRELLA", linked: false },
      { id: "auto", kind: "AUTO", linked: true },
    ]
    expect(assetPolicyDiff("properties", false, policies, ["home", "umb"])).toEqual({ connect: ["umb"], disconnect: ["auto"] })
    expect(assetPolicyDiff("properties", false, policies, ["home", "auto"])).toEqual({ connect: [], disconnect: [] })
    expect(assetPolicyDiff("properties", false, policies, [])).toEqual({ connect: [], disconnect: ["home", "auto"] })
    expect(assetPolicyDiff("properties", false, policies, ["umb", "umb"])).toEqual({ connect: ["umb"], disconnect: ["home", "auto"] })
  })

  it("ignores ids it may not link", () => {
    expect(
      assetPolicyDiff("properties", false, [{ id: "life", kind: "LIFE", linked: false }, { id: "med", kind: "MEDICAL", linked: false }], ["life", "med", "nope"]),
    ).toEqual({ connect: [], disconnect: [] })
    expect(assetPolicyDiff("properties", false, [{ id: "life", kind: "LIFE", linked: true }], [])).toEqual({ connect: [], disconnect: [] })
    expect(
      assetPolicyDiff("members", false, [{ id: "life", kind: "LIFE", linked: true }, { id: "med", kind: "MEDICAL", linked: false }], ["med"]),
    ).toEqual({ connect: [], disconnect: [] })
    expect(
      assetPolicyDiff(
        "members",
        true,
        [{ id: "life", kind: "LIFE", linked: false }, { id: "med", kind: "MEDICAL", linked: true }, { id: "home", kind: "HOME", linked: false }],
        ["life", "home"],
      ),
    ).toEqual({ connect: ["life"], disconnect: ["med"] })
  })
})
