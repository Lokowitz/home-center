"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { PropertyFormDialog } from "./property-form-dialog"
import type { Property } from "@/app/generated/prisma/client"

export function PropertyEditButton({ property, policyChoices, policyIds }: { property: Property; policyChoices?: { id: string; name: string }[]; policyIds?: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      <PropertyFormDialog open={open} onClose={() => setOpen(false)} property={property} policyChoices={policyChoices} policyIds={policyIds} />
    </>
  )
}
