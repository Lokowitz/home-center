"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addTemplateSchedules } from "@/lib/actions/maintenance"
import { assetHref } from "@/lib/assets"
import { useFormat } from "@/components/regional-provider"
import type { MaintenanceTemplate } from "@/lib/maintenance-templates"
import type { AssetType, MeterUnit } from "@/app/generated/prisma/client"
import { cn } from "@/lib/utils"
import { formatDueMonths, repeatsLabel } from "@/lib/maintenance-schedule"

type Row = { checked: boolean; days: string; miles: string }

/** A blank interval field means "none" (""), not 0. */
const num = (s: string): number | "" => (s.trim() === "" ? "" : Number(s))

interface Props {
  assetType: AssetType
  assetId: string
  templates: MaintenanceTemplate[]
  /** Titles the asset already has (lowercased); those start unchecked. */
  existingTitles: string[]
  meterUnit: MeterUnit | null
}

export function TemplatePicker({ assetType, assetId, templates, existingTitles, meterUnit }: Props) {
  const router = useRouter()
  const fmt = useFormat()
  const [pending, start] = useTransition()
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      templates.map((t) => [
        t.key,
        {
          checked: !existingTitles.includes(t.title.toLowerCase()),
          days: t.intervalDays?.toString() ?? "",
          miles: t.intervalMiles?.toString() ?? "",
        },
      ])
    )
  )
  const picked = templates.filter((t) => rows[t.key].checked)
  const back = `${assetHref(assetType, assetId)}?tab=maintenance`

  const set = (key: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }))

  function submit() {
    start(async () => {
      const result = await addTemplateSchedules(
        assetType,
        assetId,
        picked.map((t) =>
          t.dueMonths
            ? { key: t.key }
            : {
                key: t.key,
                intervalDays: num(rows[t.key].days),
                ...(t.intervalMiles !== undefined ? { intervalMiles: num(rows[t.key].miles) } : {}),
              }
        )
      )
      if (result?.error) {
        toast.error(result.error === "Invalid input" ? "Check the intervals and try again." : result.error)
        return
      }
      toast.success(`Added ${result.count} reminder${result.count === 1 ? "" : "s"}.`)
      router.push(back)
    })
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-xl border bg-card">
        {templates.map((t) => {
          const row = rows[t.key]
          const exists = existingTitles.includes(t.title.toLowerCase())
          return (
            <li key={t.key} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", !row.checked && "opacity-60")}>
              <label className="flex min-w-0 flex-1 basis-56 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={row.checked}
                  onChange={(e) => set(t.key, { checked: e.target.checked })}
                />
                <span className="min-w-0">
                  <span className="block font-medium leading-snug">{t.title}</span>
                  {(t.description || exists) && (
                    <span className="block text-xs text-muted-foreground">
                      {exists ? "Already has a reminder with this name." : t.description}
                    </span>
                  )}
                </span>
              </label>
              {t.dueMonths ? (
                <div className="text-sm text-muted-foreground">{repeatsLabel({ intervalDays: null, intervalMiles: null, dueMonths: formatDueMonths(t.dueMonths), dueDay: t.dueDay }, "")}</div>
              ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Every</span>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  aria-label={`${t.title}: days between`}
                  className="h-8 w-20"
                  value={row.days}
                  disabled={!row.checked}
                  onChange={(e) => set(t.key, { days: e.target.value })}
                />
                <span>days</span>
                {t.intervalMiles !== undefined && meterUnit && (
                  <>
                    <span>or</span>
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      aria-label={`${t.title}: ${fmt.meterShort(meterUnit)} between`}
                      className="h-8 w-24"
                      value={row.miles}
                      disabled={!row.checked}
                      onChange={(e) => set(t.key, { miles: e.target.value })}
                    />
                    <span>{fmt.meterShort(meterUnit)}</span>
                  </>
                )}
              </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.push(back)} disabled={pending}>
          Skip
        </Button>
        <Button onClick={submit} disabled={pending || picked.length === 0}>
          {pending ? "Adding…" : `Add ${picked.length} reminder${picked.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  )
}
