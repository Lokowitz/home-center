import { prisma } from "@/lib/prisma"
import type { AssetType } from "@/app/generated/prisma/client"
import type { CostRow } from "@/lib/costs"
import type { ForecastSchedule } from "@/lib/forecast"
import { ownedWhere } from "@/lib/features"
import { loadFeatures } from "@/lib/features-server"

/// One query, many rollups. Grouping happens in memory in lib/costs.ts because
/// SQLite cannot group by an extracted year without raw SQL, because assetId is
/// polymorphic with no foreign key so no aggregate query can resolve asset names
/// anyway, and because the /costs page needs five different groupings of the same
/// rows. This holds while the table stays under roughly 50k costed records; past
/// that, byYear moves to raw SQL and nothing outside this module changes.
export async function loadCostRecords(filter?: {
  assetId?: string
  assetType?: AssetType
}): Promise<CostRow[]> {
  const features = await loadFeatures()
  if (!features.health && filter?.assetType === "PERSON") return []
  const rows = await prisma.serviceRecord.findMany({
    where: {
      cost: { not: null },
      ...(filter?.assetId ? { assetId: filter.assetId } : {}),
      // With Health off, people's visits drop out of every total.
      ...(filter?.assetType ? { assetType: filter.assetType } : ownedWhere(features)),
    },
    select: {
      id: true,
      assetId: true,
      assetType: true,
      date: true,
      cost: true,
      category: true,
      vendor: true,
      title: true,
      mileageAtService: true,
    },
    orderBy: { date: "asc" },
  })

  // `cost: { not: null }` narrows the rows but not their type, so this assertion
  // states what the query already guarantees.
  return rows.map((row) => ({ ...row, cost: row.cost! }))
}

/// Every reminder with an estimated cost, for the planned-spend forecast. Paused and
/// snoozed ones come back too: forecastSchedules drops the first and keeps the second.
/// With Health off no person's reminder is returned. `assets` narrows to those exact assets.
export async function loadPlannedSchedules(filter?: {
  assetType?: AssetType
  assets?: { assetType: AssetType; assetId: string }[]
}): Promise<ForecastSchedule[]> {
  const features = await loadFeatures()
  if (!features.health && filter?.assetType === "PERSON") return []
  return prisma.maintenanceSchedule.findMany({
    where: {
      estimatedCost: { not: null },
      ...(filter?.assetType ? { assetType: filter.assetType } : ownedWhere(features)),
      ...(filter?.assets ? { OR: filter.assets.map(({ assetType, assetId }) => ({ assetType, assetId })) } : {}),
    },
    select: {
      id: true,
      title: true,
      assetType: true,
      assetId: true,
      isActive: true,
      estimatedCost: true,
      intervalDays: true,
      intervalMiles: true,
      dueMonths: true,
      dueDay: true,
      nextDueDate: true,
      nextDueMileage: true,
    },
  })
}
