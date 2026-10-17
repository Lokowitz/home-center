"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, Loader2, PencilLine, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { applyObservationEdit, deleteObservationIfUnchanged } from "@/lib/actions/health"
import type { ActionResult } from "@/lib/form-types"
import { changedFields, FIELD_LABELS, formatValue, valuesToForm, type CardPatch, type ChangeCard } from "@/lib/observation-cards"
import { cn } from "@/lib/utils"

const CONFIRM_MS = 5000

function errorText(r: ActionResult): string {
  if (typeof r.error === "string") return r.error
  const all = Object.values(r.error ?? {}).flat().filter(Boolean)
  return all.length ? all.join(" ") : "Couldn't do that. Try again."
}

/// A proposed edit or delete of an existing observation. Nothing changes until
/// Apply, or Delete then Confirm delete; the server refuses if the entry changed
/// after the card was made.
export function ObservationChangeCard({
  card, onChange, live = false,
}: { card: ChangeCard; onChange?: (patch: CardPatch) => void; live?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t = card.target
  const href = `/assets/people/${t.personId}?tab=observations&open=${t.observationId}`
  const isEdit = card.kind === "edit"
  const fields = isEdit ? changedFields(t.before, card.after) : []
  const disabled = busy || live || !onChange

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function disarm() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setConfirming(false)
  }

  async function run(action: () => Promise<ActionResult>) {
    if (busy || !onChange) return
    setBusy(true)
    try {
      const r = await action()
      if (r.success) {
        onChange({ state: "saved", error: undefined })
        router.refresh()
      } else onChange({ error: errorText(r) })
    } catch {
      onChange({ error: "Couldn't reach the server. Try again." })
    } finally {
      setBusy(false)
      disarm()
    }
  }

  function onDelete() {
    if (disabled) return
    if (!confirming) {
      setConfirming(true)
      timer.current = setTimeout(() => setConfirming(false), CONFIRM_MS)
      return
    }
    void run(() => deleteObservationIfUnchanged(t.observationId, t.updatedAt))
  }

  if (card.state === "discarded") {
    return <p className="text-xs text-muted-foreground">Discarded {isEdit ? "change" : "deletion"} · {t.personName} · {t.before.type} · {t.before.date}</p>
  }

  const done = card.state === "saved"
  const title = isEdit ? (done ? "Change applied" : "Proposed change") : done ? "Observation deleted" : "Delete this observation?"

  return (
    <div className={cn("max-w-md rounded-lg border bg-card text-sm shadow-sm", !isEdit && !done && "border-destructive/40")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {isEdit ? <PencilLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        <span className="font-medium">{title}</span>
        {!done && <span className="ml-auto text-xs text-muted-foreground">Nothing changed yet</span>}
      </div>
      <div className="px-3 pt-2 text-xs text-muted-foreground">{t.personName} · {t.before.date} · {t.before.type}</div>
      {isEdit ? (
        <dl className="space-y-1 px-3 py-2 text-xs">
          {fields.map((f) => (
            <div key={f} className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted-foreground">{FIELD_LABELS[f]}</dt>
              <dd className="min-w-0 flex-1 break-words">
                <span className="text-muted-foreground line-through">{formatValue(f, t.before)}</span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changes to </span>
                <span className="font-medium">{formatValue(f, card.after)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="space-y-1 px-3 py-2 text-xs">
          {(["severity", "time", "durationMinutes", "notes", "tags"] as const).map((f) => (
            <div key={f} className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted-foreground">{FIELD_LABELS[f]}</dt>
              <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">{formatValue(f, t.before)}</dd>
            </div>
          ))}
          {t.attachments > 0 && <p className="pt-1 text-destructive">Its {t.attachments} attachment{t.attachments === 1 ? "" : "s"} will be deleted too.</p>}
          {!done && <p className="pt-1 text-muted-foreground">This can&apos;t be undone.</p>}
        </dl>
      )}
      {card.error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{card.error}</p>}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {done ? (
          <>
            <Check className="h-4 w-4 text-[var(--chart-4)]" aria-hidden="true" />
            <span className="text-xs">{isEdit ? "Applied" : "Deleted"}</span>
            {isEdit && <Link className="ml-auto text-xs font-medium underline-offset-2 hover:underline" href={href}>Open entry</Link>}
          </>
        ) : (
          <>
            {isEdit ? (
              <Button size="sm" onClick={() => run(() => applyObservationEdit(t.observationId, valuesToForm(card.after), t.updatedAt))} disabled={disabled}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                Apply
              </Button>
            ) : (
              <>
                <Button size="sm" variant="destructive" onClick={onDelete} onBlur={disarm} disabled={disabled}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  {confirming ? "Confirm delete" : "Delete"}
                </Button>
                <span className="sr-only" aria-live="polite">{confirming ? "Press again to confirm delete" : ""}</span>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => { disarm(); onChange?.({ state: "discarded", error: undefined }) }} disabled={disabled}>
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
