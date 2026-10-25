"use client"

import { FormLabel } from "@/components/ui/form"

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
  return (
    <div className="col-span-2 space-y-1.5">
      <FormLabel help={help}>{label}</FormLabel>
      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
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
