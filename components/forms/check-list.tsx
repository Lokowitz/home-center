"use client"

import { useId } from "react"
import { Label } from "@/components/ui/label"

/** A labelled row of checkboxes with a "?" help popover. `value` is the ticked ids. Spans both columns of a two-column form grid. */
export function CheckList({
  label,
  help,
  options,
  value,
  onChange,
}: {
  label: string
  help: string
  options: { id: string; name: string }[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const labelId = useId()
  return (
    <div className="col-span-2 space-y-1.5">
      <Label id={labelId} help={help}>{label}</Label>
      {/* The group takes its name from the label, so a screen reader announces "Insurance" before the boxes. */}
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
        {options.map((o) => (
          <label key={o.id} className="flex min-w-0 max-w-full items-center gap-2 text-sm [overflow-wrap:anywhere] max-sm:min-h-10">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={value.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))}
            />
            {o.name}
          </label>
        ))}
      </div>
    </div>
  )
}
