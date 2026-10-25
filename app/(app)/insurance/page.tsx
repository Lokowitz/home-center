import { loadFeatures } from "@/lib/features-server"
import { loadInsurancePage } from "@/lib/insurance-server"
import { InsuranceList } from "@/components/insurance/insurance-list"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { filteredEmptyText } from "@/lib/property-filter"

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>
}) {
  const scope = await loadPropertyScope()
  const { health } = await loadFeatures()
  const { open } = await searchParams
  const { policies, people, properties, vehicles } = await loadInsurancePage(health, scope)

  return (
    <div className="space-y-6">
      <InsuranceList policies={policies} people={people} properties={properties} vehicles={vehicles} health={health} openId={open} emptyText={filteredEmptyText(scope)} />
    </div>
  )
}
