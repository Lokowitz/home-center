"use client"

import * as React from "react"

import { FieldHelp } from "@/components/ui/field-help"
import { cn } from "@/lib/utils"

/** `help` is a lib/field-help id: it adds the "?" popover just after the label, outside it. */
function Label({ className, help, ...props }: React.ComponentProps<"label"> & { help?: string }) {
  const label = (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
  if (!help) return label
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <FieldHelp id={help} />
    </span>
  )
}

export { Label }
