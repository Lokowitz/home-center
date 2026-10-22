import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { EquipmentList } from "@/components/equipment/equipment-list"
import { propertiesWithRooms } from "@/lib/rooms-server"
import { assetViewCookieName, parseAssetView } from "@/lib/asset-view"

export default async function EquipmentPage() {
  const [equipment, properties, cookieStore] = await Promise.all([
    prisma.equipment.findMany({ include: { room: { select: { name: true } } }, orderBy: { name: "asc" } }),
    propertiesWithRooms(),
    cookies(),
  ])

  const initialView = parseAssetView(cookieStore.get(assetViewCookieName("equipment"))?.value)

  return (
    <div className="space-y-6">
      <EquipmentList equipment={equipment} properties={properties} initialView={initialView} />
    </div>
  )
}
