import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { VehicleList } from "@/components/vehicles/vehicle-list"
import { loadPropertyScope, loadPropertyFilterChoices } from "@/lib/property-filter-server"
import { assetViewCookieName, parseAssetView } from "@/lib/asset-view"
import { filteredEmptyText, newItemPropertyId, vehicleScopeWhere } from "@/lib/property-filter"

export default async function VehiclesPage() {
  const scope = await loadPropertyScope()
  const [vehicles, cookieStore, propertyChoices] = await Promise.all([
    prisma.vehicle.findMany({ where: vehicleScopeWhere(scope), orderBy: { name: "asc" } }),
    cookies(),
    loadPropertyFilterChoices(scope),
  ])

  const initialView = parseAssetView(cookieStore.get(assetViewCookieName("vehicles"))?.value)

  return (
    <div className="space-y-6">
      <VehicleList vehicles={vehicles} initialView={initialView} propertyChoices={propertyChoices ?? undefined} emptyText={filteredEmptyText(scope)} newPropertyId={newItemPropertyId(scope, vehicles)} />
    </div>
  )
}
