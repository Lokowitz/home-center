"use client"

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useFormat } from "@/components/regional-provider"
import { locationLabel } from "@/lib/rooms"
import { categoryLabel } from "./categories"
import type { EquipmentWithRoom } from "./equipment-form-dialog"

/**
 * Equipment as detailed rows. Clicking a row edits it in place; the link icon opens the item's own
 * page. `showLocation` adds where the item sits, for lists that aren't already scoped to one room.
 */
export function EquipmentRows({ equipment, onEdit, showLocation = false }: { equipment: EquipmentWithRoom[]; onEdit: (equipment: EquipmentWithRoom) => void; showLocation?: boolean }) {
  const fmt = useFormat()
  return (
    <ul className="divide-y rounded-md border bg-card">
      {equipment.map((e) => {
        const make = [e.manufacturer, e.modelNumber].filter(Boolean).join(" · ")
        const facts = [
          showLocation && locationLabel(e) && `Location: ${locationLabel(e)}`,
          e.serialNumber && `Serial ${e.serialNumber}`,
          e.installDate && `Installed ${fmt.date(e.installDate, { utc: true })}`,
          e.purchasePrice != null && fmt.money(e.purchasePrice),
        ].filter(Boolean).join(" · ")
        return (
          <li key={e.id} className="flex items-center gap-2 hover:bg-muted/40">
            <button type="button" onClick={() => onEdit(e)} className="min-w-0 flex-1 space-y-0.5 px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{e.name}</span>
                <Badge variant="outline" className="shrink-0 text-xs">{categoryLabel(e.category)}</Badge>
              </span>
              {make && <span className="block truncate text-muted-foreground">{make}</span>}
              {facts && <span className="block truncate text-xs text-muted-foreground">{facts}</span>}
              {e.notes && <span className="block truncate text-xs text-muted-foreground">{e.notes}</span>}
            </button>
            <Link href={`/assets/equipment/${e.id}`} aria-label={`Open ${e.name}'s page`} className="mr-2 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
