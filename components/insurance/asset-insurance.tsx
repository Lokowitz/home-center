import Link from "next/link"
import { ShieldPlus } from "lucide-react"
import { getFormat } from "@/lib/regional-server"
import { insuranceKindLabel } from "@/lib/insurance"

/// The policies linked to a property, vehicle or person, on its detail page. Nothing when there are none.
export async function AssetInsurance({
  policies,
  belongings,
}: {
  policies: { id: string; carrier: string; planName: string | null; kind: string; detail?: string | null }[]
  /// Property pages: belongings to replace against personal property coverage. Both figures, no verdict.
  belongings?: { belongings: number; coverage: number } | null
}) {
  if (policies.length === 0) return null
  const fmt = await getFormat()
  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center gap-1.5 font-semibold">
        <ShieldPlus className="h-4 w-4" aria-hidden="true" /> Insurance
      </div>
      <ul className="mt-1.5 space-y-1">
        {policies.map((p) => (
          <li key={p.id} className="flex items-baseline justify-between gap-2">
            <Link href={`/insurance?open=${p.id}`} className="hover:underline">
              {p.carrier}{p.planName ? ` · ${p.planName}` : ""}
            </Link>
            <span className="text-right text-xs text-muted-foreground">
              {insuranceKindLabel(p.kind)}{p.detail ? ` · ${p.detail}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {belongings && (
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div>Belongings to replace: {fmt.moneyWhole(belongings.belongings)}</div>
          <div>Personal property coverage: {fmt.money(belongings.coverage)}</div>
        </div>
      )}
    </div>
  )
}
