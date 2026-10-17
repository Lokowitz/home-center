"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ClipboardList, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createObservation } from "@/lib/actions/health"
import type { ActionResult } from "@/lib/form-types"
import type { CardPatch } from "@/lib/observation-cards"
import { severityLabel, toFormValues, type DraftCard } from "@/lib/observation-draft"
import { cn } from "@/lib/utils"

function errorText(r: ActionResult): string {
  if (typeof r.error === "string") return r.error
  const all = Object.values(r.error ?? {}).flat().filter(Boolean)
  return all.length ? all.join(" ") : "Couldn't save it. Try again."
}

/// One drafted observation in the chat. Nothing is written until Save, which
/// goes through the same server action as the Observations form.
export function ObservationDraftCard({
  card, onChange, live = false,
}: {
  card: DraftCard
  onChange?: (patch: CardPatch) => void
  /// Still streaming: shown, but Save waits for the answer to finish.
  live?: boolean
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const d = card.draft

  if (card.state === "discarded") {
    return <p className="text-xs text-muted-foreground">Discarded draft · {d.personName} · {d.type} · {d.date}</p>
  }

  async function save() {
    if (saving || !onChange) return
    setSaving(true)
    try {
      const r = await createObservation(d.personId, toFormValues(d))
      if (r.success && r.id) {
        onChange({ state: "saved", savedId: r.id, error: undefined })
        router.refresh()
      } else onChange({ error: errorText(r) })
    } catch {
      onChange({ error: "Couldn't reach the server. Try again." })
    } finally {
      setSaving(false)
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  )

  return (
    <div className={cn("max-w-md rounded-lg border bg-card text-sm shadow-sm", card.state === "saved" && "border-[var(--chart-4)]/50")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{card.state === "saved" ? "Observation saved" : "Draft observation"}</span>
        {card.state !== "saved" && <span className="ml-auto text-xs text-muted-foreground">Not saved yet</span>}
      </div>
      <dl className="space-y-1 px-3 py-2 text-xs">
        {row("Person", d.personName)}
        {row("When", `${d.date}${d.time ? ` · ${d.time}` : ""}`)}
        {row("What", d.type)}
        {row("Severity", (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {severityLabel(d.severity)}
            {d.severitySource === "estimated" && (
              <span className="rounded border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">estimated</span>
            )}
          </span>
        ))}
        {d.durationMinutes != null && row("Duration", `${d.durationMinutes} min`)}
        {d.notes && row("Notes", <span className="whitespace-pre-wrap">{d.notes}</span>)}
        {d.tags.length > 0 && row("Tags", d.tags.join(", "))}
      </dl>
      {card.error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{card.error}</p>}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {card.state === "saved" ? (
          <>
            <Check className="h-4 w-4 text-[var(--chart-4)]" aria-hidden="true" />
            <span className="text-xs">Saved</span>
            <Link className="ml-auto text-xs font-medium underline-offset-2 hover:underline" href={`/assets/people/${d.personId}?tab=observations&open=${card.savedId}`}>
              Open entry
            </Link>
          </>
        ) : (
          <>
            <Button size="sm" onClick={save} disabled={saving || live || !onChange}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange?.({ state: "discarded", error: undefined })} disabled={saving || live || !onChange}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
            <span className="ml-auto text-[11px] text-muted-foreground">{live ? "Finishing…" : "Or tell me what to change"}</span>
          </>
        )}
      </div>
    </div>
  )
}
