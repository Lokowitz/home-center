import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { EquipmentList } from "@/components/equipment/equipment-list"
import { propertiesWithRooms } from "@/lib/rooms-server"
import { assetViewCookieName, parseAssetView } from "@/lib/asset-view"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { equipmentScopeWhere, filteredEmptyText, newItemPropertyId } from "@/lib/property-filter"

export default async function EquipmentPage() {
  const scope = await loadPropertyScope()
  const [equipment, properties, cookieStore] = await Promise.all([
    prisma.equipment.findMany({ where: equipmentScopeWhere(scope), include: { room: { select: { name: true } } }, orderBy: { name: "asc" } }),
    propertiesWithRooms(scope),
    cookies(),
  ])

  const initialView = parseAssetView(cookieStore.get(assetViewCookieName("equipment"))?.value)

  return (
    <div className="space-y-6">
      <EquipmentList equipment={equipment} properties={properties} initialView={initialView} emptyText={filteredEmptyText(scope)} newPropertyId={newItemPropertyId(scope, equipment)} />
    </div>
  )
}
