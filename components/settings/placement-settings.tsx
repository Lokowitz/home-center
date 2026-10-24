"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Inbox, MessageSquare } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldHelp } from "@/components/ui/field-help"
import { cn } from "@/lib/utils"
import { PLACEMENTS, savePlacement, type PlacementKey, type PlacementValue } from "@/lib/placement"

const ICONS = { assistant: MessageSquare, intake: Inbox } satisfies Record<PlacementKey, React.ElementType>
const HELP = { assistant: { help: "placement.assistant" }, intake: { help: "placement.intake" } } satisfies Record<PlacementKey, { help: string }>

/** A small sketch of a page (top bar, side menu, content) with the button where this option puts it. */
function Sketch({ prefKey, value, chosen }: { prefKey: PlacementKey; value: string; chosen: boolean }) {
  const Icon = ICONS[prefKey]
  const mark = chosen ? "bg-primary text-primary-foreground" : "bg-muted-foreground/60 text-background"
  const line = "rounded bg-muted-foreground/20"
  return (
    <div aria-hidden="true" className="pointer-events-none relative flex h-20 overflow-hidden rounded-md border bg-background">
      <div className="flex w-7 shrink-0 flex-col gap-1.5 border-r bg-card p-1.5">
        <span className={cn("h-1.5", line)} />
        {value === "sidebar" && (
          <span className={cn("flex h-2.5 items-center justify-center rounded-sm", mark)}>
            <Icon className="h-1.5 w-1.5" strokeWidth={3} />
          </span>
        )}
        <span className={cn("h-1.5", line)} />
        <span className={cn("h-1.5", line)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex h-4 items-center justify-end gap-1 border-b bg-card px-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
          {value === "header" && (
            <span className={cn("flex h-2.5 w-2.5 items-center justify-center rounded-sm", mark)}>
              <Icon className="h-1.5 w-1.5" strokeWidth={3} />
            </span>
          )}
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="space-y-1.5 p-2">
          <div className={cn("h-1.5 w-3/5", line)} />
          <div className={cn("h-1.5 w-4/5", line)} />
          <div className={cn("h-1.5 w-2/5", line)} />
        </div>
      </div>
      {value === "floating" && (
        <span className={cn("absolute right-1.5 bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full shadow", mark)}>
          <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
        </span>
      )}
    </div>
  )
}

/** Settings → Appearance: where one entry point sits. Saves on change, for this device. */
export function PlacementSettings<K extends PlacementKey>({
  prefKey, title, description, initial,
}: { prefKey: K; title: string; description: React.ReactNode; initial: PlacementValue<K> }) {
  const [value, setValue] = useState<string>(initial)
  const router = useRouter()
  const { options } = PLACEMENTS[prefKey]

  function save(next: PlacementValue<K>) {
    setValue(next)
    savePlacement(prefKey, next)
    // The layout reads the cookie, so a refresh moves the button.
    router.refresh()
    toast.success(`${title}: ${options.find((o) => o.value === next)?.label}.`)
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-1.5">{title}<FieldHelp id={HELP[prefKey].help} /></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{title}</legend>
          {options.map((o) => {
            const chosen = value === o.value
            return (
              <div
                key={o.value}
                className={cn(
                  "relative flex flex-col gap-3 rounded-xl border p-4 transition-colors duration-150",
                  "has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background",
                  chosen ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-foreground/30"
                )}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  {/* The span below stretches the label over the whole card; the radio stays a real, focusable input. */}
                  <input
                    type="radio"
                    name={`placement-${prefKey}`}
                    className="sr-only"
                    value={o.value}
                    checked={chosen}
                    onChange={() => save(o.value as PlacementValue<K>)}
                  />
                  <span className="absolute inset-0 rounded-xl" aria-hidden="true" />
                  {o.label}
                </label>
                <Sketch prefKey={prefKey} value={o.value} chosen={chosen} />
                <p className="text-xs text-muted-foreground">{o.hint}</p>
              </div>
            )
          })}
        </fieldset>
      </CardContent>
    </Card>
  )
}
