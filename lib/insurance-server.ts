import { prisma } from "@/lib/prisma"
import type { Attachment, InsurancePolicy, InsuranceCoverage, InsurancePremium, Prisma } from "@/app/generated/prisma/client"
import { HEALTH_INSURANCE_KINDS } from "@/lib/insurance"

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
