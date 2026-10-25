import { prisma } from "@/lib/prisma"
import type { Attachment, InsurancePolicy, InsuranceCoverage, InsurancePremium, Prisma } from "@/app/generated/prisma/client"
import { assetPolicyDiff, eligibleKinds, HEALTH_INSURANCE_KINDS, policyChoiceLabel, type LinkSide } from "@/lib/insurance"

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

export async function loadInsurancePage(health: boolean): Promise<{
  policies: PolicyRow[]
  people: Named[]
  properties: Named[]
  vehicles: Named[]
}> {
  const [policies, people, properties, vehicles] = await Promise.all([
    prisma.insurancePolicy.findMany({
      where: healthKindWhere(health),
      include: {
        members: byName,
        properties: byName,
        vehicles: byName,
        premiums: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] },
        coverages: { orderBy: { sortOrder: "asc" } },
        attachments: { orderBy: { uploadedAt: "desc" } },
      },
      orderBy: [{ kind: "asc" }, { carrier: "asc" }],
    }),
    // People are health data: with Health off no name reaches the browser.
    health ? prisma.person.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.property.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
export async function loadPolicyChoices(side: LinkSide, health: boolean): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.insurancePolicy.findMany({
    where: { AND: [healthKindWhere(health), { kind: { in: eligibleKinds(side, health) } }] },
    select: { id: true, carrier: true, planName: true, kind: true },
    orderBy: [{ carrier: "asc" }, { planName: "asc" }],
  })
  return rows.map((p) => ({ id: p.id, name: policyChoiceLabel(p) }))
}

/// The connect/disconnect lists for one asset, read from the database and run through assetPolicyDiff.
/// Only this asset's side changes; the policy's other links are never touched.
export async function assetPolicyLinks(
  side: LinkSide,
  assetId: string,
  chosen: string[],
  health: boolean,
): Promise<{ connect: string[]; disconnect: string[] }> {
  // The relation to read depends on the side, so Prisma can't type it; each row carries just that one list.
  const rows = (await prisma.insurancePolicy.findMany({
    where: { AND: [healthKindWhere(health), { kind: { in: eligibleKinds(side, health) } }] },
    select: { id: true, kind: true, [side]: { where: { id: assetId }, select: { id: true } } },
  })) as unknown as ({ id: string; kind: string } & Partial<Record<LinkSide, unknown[]>>)[]
  const policies = rows.map((r) => ({ id: r.id, kind: r.kind, linked: (r[side] ?? []).length > 0 }))
  return assetPolicyDiff(side, health, policies, chosen)
}
