import { prisma } from "@/lib/prisma"
import type { Attachment, InsurancePolicy, InsuranceCoverage, InsurancePremium, Prisma } from "@/app/generated/prisma/client"
import { assetPolicyDiff, eligibleKinds, HEALTH_INSURANCE_KINDS, policyChoiceLabel, type LinkSide } from "@/lib/insurance"
import {
  personScopeWhere,
  policyScopeWhere,
  propertyScopeWhere,
  vehicleScopeWhere,
  type PropertyScope,
} from "@/lib/property-filter"

type Named = { id: string; name: string }

/// A policy as the Insurance page shows it. Defined here, not in the list component, so the
/// form, card and loader share one type without importing a client file into server code.
export type PolicyRow = InsurancePolicy & {
  members: Named[]
  properties: Named[]
  vehicles: Named[]
  premiums: InsurancePremium[]
  coverages: InsuranceCoverage[]
  attachments: Attachment[]
}

/// With Health off, health kinds are out of every query.
export function healthKindWhere(health: boolean): Prisma.InsurancePolicyWhereInput {
  return health ? {} : { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } }
}

const byName = { select: { id: true, name: true }, orderBy: { name: "asc" as const } }

/// The people, properties and vehicles a policy form offers. The insurance action reads the same
/// lists to tell which current links the user couldn't see.
export async function loadPolicyLinkChoices(
  health: boolean,
  scope: PropertyScope | null = null,
): Promise<{ people: Named[]; properties: Named[]; vehicles: Named[] }> {
  const [people, properties, vehicles] = await Promise.all([
    // People are health data: with Health off no name reaches the browser.
    health
      ? prisma.person.findMany({ where: personScopeWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    prisma.property.findMany({ where: propertyScopeWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ where: vehicleScopeWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ])
  return { people, properties, vehicles }
}

export async function loadInsurancePage(health: boolean, scope: PropertyScope | null = null): Promise<{
  policies: PolicyRow[]
  people: Named[]
  properties: Named[]
  vehicles: Named[]
}> {
  const [policies, { people, properties, vehicles }] = await Promise.all([
    prisma.insurancePolicy.findMany({
      where: scope ? { AND: [healthKindWhere(health), policyScopeWhere(scope)] } : healthKindWhere(health),
      include: {
        // Under a scope a card names only in-scope links; the action adds hidden ones back on save.
        members: { ...byName, where: personScopeWhere(scope) },
        properties: { ...byName, where: propertyScopeWhere(scope) },
        vehicles: { ...byName, where: vehicleScopeWhere(scope) },
        premiums: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] },
        coverages: { orderBy: { sortOrder: "asc" } },
        attachments: { orderBy: { uploadedAt: "desc" } },
      },
      orderBy: [{ kind: "asc" }, { carrier: "asc" }],
    }),
    loadPolicyLinkChoices(health, scope),
  ])
  return {
    policies: health ? policies : policies.map((p) => ({ ...p, members: [] })),
    people,
    properties,
    vehicles,
  }
}

/// Non-health policies linked to a property or vehicle, for its detail page.
export async function loadAssetPolicies(assetType: "PROPERTY" | "VEHICLE", id: string) {
  return prisma.insurancePolicy.findMany({
    where: {
      AND: [healthKindWhere(false), assetType === "PROPERTY" ? { properties: { some: { id } } } : { vehicles: { some: { id } } }],
    },
    select: {
      id: true,
      carrier: true,
      planName: true,
      kind: true,
      coverages: { select: { label: true, limit: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { carrier: "asc" },
  })
}

/// Policies that may link to this side, as checkbox choices, sorted by carrier then plan.
export async function loadPolicyChoices(
  side: LinkSide,
  health: boolean,
  scope: PropertyScope | null = null,
): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.insurancePolicy.findMany({
    where: { AND: [healthKindWhere(health), { kind: { in: eligibleKinds(side, health) } }, ...(scope ? [policyScopeWhere(scope)] : [])] },
    select: { id: true, carrier: true, planName: true, kind: true },
    orderBy: [{ carrier: "asc" }, { planName: "asc" }],
  })
  return rows.map((p) => ({ id: p.id, name: policyChoiceLabel(p) }))
}

/// The connect/disconnect lists for one asset, read from the database and run through assetPolicyDiff.
/// Only this asset's side changes; the policy's other links are never touched. Under a scope only
/// in-scope policies are diffed, so a link to a policy the user couldn't see is never dropped.
export async function assetPolicyLinks(
  side: LinkSide,
  assetId: string,
  chosen: string[],
  health: boolean,
  scope: PropertyScope | null = null,
): Promise<{ connect: string[]; disconnect: string[] }> {
  // The relation to read depends on the side, so Prisma can't type it; each row carries just that one list.
  const rows = (await prisma.insurancePolicy.findMany({
    where: { AND: [healthKindWhere(health), { kind: { in: eligibleKinds(side, health) } }, ...(scope ? [policyScopeWhere(scope)] : [])] },
    select: { id: true, kind: true, [side]: { where: { id: assetId }, select: { id: true } } },
  })) as unknown as ({ id: string; kind: string } & Partial<Record<LinkSide, unknown[]>>)[]
  const policies = rows.map((r) => ({ id: r.id, kind: r.kind, linked: (r[side] ?? []).length > 0 }))
  return assetPolicyDiff(side, health, policies, chosen)
}
