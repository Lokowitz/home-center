"use client"

import { useFormat } from "@/components/regional-provider"
import { VALUE_CLASSES, equipmentValueTotals } from "@/lib/equipment-value"
import type { Equipment } from "@/app/generated/prisma/client"

/** What a property's equipment cost and would cost to replace, split into part of the home and belongings. Hidden until something has a price. */
export function EquipmentValueSummary({ equipment }: { equipment: Equipment[] }) {
  const fmt = useFormat()
  const totals = equipmentValueTotals(equipment)
  const anyPrice = equipment.some((e) => e.purchasePrice != null || e.replacementCost != null)
  if (!anyPrice) return null

  const noPrice = VALUE_CLASSES.reduce((n, c) => n + totals[c.value].count - totals[c.value].priced, 0)

  return (
    <div className="mb-4 space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {VALUE_CLASSES.filter((c) => totals[c.value].priced > 0 || totals[c.value].withReplacementCost > 0).map((c) => {
          const t = totals[c.value]
          return (
            <div key={c.value} className="rounded-lg border bg-card px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
              {t.priced > 0 && <p className="text-sm">Paid <span className="font-semibold">{fmt.moneyWhole(t.paid)}</span></p>}
              {t.withReplacementCost > 0 && (
                <p className="text-sm">
                  To replace <span className="font-semibold">{fmt.moneyWhole(t.toReplace)}</span>
                  {t.withReplacementCost < t.count && (
                    <span className="text-xs text-muted-foreground"> ({t.withReplacementCost} of {t.count} items)</span>
                  )}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {noPrice > 0 && <p className="text-xs text-muted-foreground">{noPrice} {noPrice === 1 ? "item has" : "items have"} no purchase price</p>}
    </div>
  )
}
