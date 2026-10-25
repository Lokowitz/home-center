import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { PropertyList } from "@/components/properties/property-list"
import { assetViewCookieName, parseAssetView } from "@/lib/asset-view"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { propertyScopeWhere } from "@/lib/property-filter"

export default async function PropertiesPage() {
  const scope = await loadPropertyScope()
  const [properties, cookieStore] = await Promise.all([
    prisma.property.findMany({ where: propertyScopeWhere(scope), orderBy: { name: "asc" } }),
    cookies(),
  ])

  const initialView = parseAssetView(cookieStore.get(assetViewCookieName("properties"))?.value)

  return (
    <div className="space-y-6">
      <PropertyList properties={properties} initialView={initialView} />
    </div>
  )
}
