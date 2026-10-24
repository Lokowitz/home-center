// Whether equipment is part of the home or a belonging, and what each group is
// worth. Pure, and the backup engine (lib/backup/readable.ts) imports it, so it
// must stay free of runtime imports (it is also copied into the Docker image).

export type ValueClass = "FIXTURE" | "CONTENTS"

export const VALUE_CLASSES: { value: ValueClass; label: string }[] = [
  { value: "FIXTURE", label: "Part of the home" },
  { value: "CONTENTS", label: "Belongings" },
]

export function valueClassLabel(c: ValueClass): string {
  return VALUE_CLASSES.find((v) => v.value === c)!.label
}

const FIXTURE_CATEGORIES = new Set(["HVAC", "WATER", "SECURITY"])

/// What a category counts as when nobody picked. An unknown category is a belonging.
export function defaultValueClass(category: string): ValueClass {
  return FIXTURE_CATEGORIES.has(category) ? "FIXTURE" : "CONTENTS"
}

/// The picked class, or the category's default. A null class is never written as
/// the default's value, so changing the category moves the item.
export function effectiveValueClass(e: { category: string; valueClass: ValueClass | null }): ValueClass {
  return e.valueClass ?? defaultValueClass(e.category)
}

export type ValueItem = { category: string; valueClass: ValueClass | null; purchasePrice: number | null; replacementCost: number | null }

export type ClassTotals = {
  count: number
  /** Items with a purchase price, 0 included. */
  priced: number
  paid: number
  withReplacementCost: number
  toReplace: number
  /** Replacement cost, else price paid, else 0, summed. The insurance step reads this for belongings. */
  toReplaceOrPaid: number
}

export function equipmentValueTotals(items: ValueItem[]): Record<ValueClass, ClassTotals> {
  const empty = (): ClassTotals => ({ count: 0, priced: 0, paid: 0, withReplacementCost: 0, toReplace: 0, toReplaceOrPaid: 0 })
  const totals: Record<ValueClass, ClassTotals> = { FIXTURE: empty(), CONTENTS: empty() }
  for (const item of items) {
    const t = totals[effectiveValueClass(item)]
    t.count++
    if (item.purchasePrice != null) {
      t.priced++
      t.paid += item.purchasePrice
    }
    if (item.replacementCost != null) {
      t.withReplacementCost++
      t.toReplace += item.replacementCost
    }
    t.toReplaceOrPaid += item.replacementCost ?? item.purchasePrice ?? 0
  }
  return totals
}
