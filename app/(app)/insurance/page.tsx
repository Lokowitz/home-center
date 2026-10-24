import { loadFeatures } from "@/lib/features-server"
import { loadInsurancePage } from "@/lib/insurance-server"
import { InsuranceList } from "@/components/insurance/insurance-list"

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>
}) {
  const { health } = await loadFeatures()
  const { open } = await searchParams
  const { policies, people, properties, vehicles } = await loadInsurancePage(health)

  return (
    <div className="space-y-6">
      <InsuranceList policies={policies} people={people} properties={properties} vehicles={vehicles} health={health} openId={open} />
    </div>
  )
}
