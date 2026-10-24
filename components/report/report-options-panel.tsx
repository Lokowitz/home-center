"use client"

import { useRouter, usePathname } from "next/navigation"
import { useTransition } from "react"
import { FieldHelp } from "@/components/ui/field-help"
import {
  HISTORY_RANGES, MED_NOTES, OBS_RANGES, OBS_VIEWS, VISIT_MODES, reportOptionsQuery,
  type ReportOptions,
} from "@/lib/report-options"

// The medical summary's customisation, in a rail beside the sheet. Every change
// rewrites the query string and the server re-renders the document.

const BOOLEANS: { key: keyof ReportOptions; label: string; help: string }[] = [
  { key: "allergies", label: "Allergies", help: "report.allergies" },
  { key: "conditions", label: "Conditions", help: "report.conditions" },
  { key: "medications", label: "Medications", help: "report.medications" },
  { key: "immunizations", label: "Immunizations", help: "report.immunizations" },
  { key: "insurance", label: "Insurance", help: "report.insurance" },
  { key: "careTeam", label: "Care team", help: "report.care-team" },
  { key: "review", label: "Medication & behavior review", help: "report.review" },
  { key: "changes", label: "Medication change observations", help: "report.changes" },
]

export function ReportOptionsPanel({ options }: { options: ReportOptions }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()

  function set<K extends keyof ReportOptions>(key: K, value: ReportOptions[K]) {
    start(() => router.replace(`${pathname}?${reportOptionsQuery({ ...options, [key]: value })}`, { scroll: false }))
  }

  // `help` is a lib/field-help id; the "?" sits beside the label, outside it.
  const check = (key: keyof ReportOptions, label: string, { help }: { help: string }) => (
    <div key={key} className="flex items-center gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={options[key] as boolean}
          onChange={(e) => set(key, e.target.checked as never)}
        />
        {label}
      </label>
      <FieldHelp id={help} />
    </div>
  )

  const select = <T extends string>(
    key: keyof ReportOptions,
    label: string,
    choices: readonly { value: T; label: string }[],
    { help }: { help: string }
  ) => (
    <div className="py-1 text-sm">
      <span className="mb-1 flex items-center gap-1.5">
        <label htmlFor={`report-${key}`}>{label}</label>
        <FieldHelp id={help} />
      </span>
      <select
        id={`report-${key}`}
        className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        value={options[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </div>
  )

  return (
    <aside
      className={`no-print sticky top-4 w-60 shrink-0 self-start rounded-lg border bg-background p-4 ${pending ? "opacity-70" : ""}`}
      aria-label="Report contents"
    >
      <h2 className="mb-2 text-sm font-semibold">Include in report</h2>
      <div>
        {BOOLEANS.slice(0, 6).map((b) => check(b.key, b.label, b))}
        <hr className="my-2" />
        {BOOLEANS.slice(6, 7).map((b) => check(b.key, b.label, b))}
        {check("history", "Medication history chart", { help: "report.history" })}
        {check("medList", "Medication history", { help: "report.med-list" })}
        {options.medList && <div className="ml-2 border-l pl-3">{select("medListNotes", "Include notes", MED_NOTES, { help: "report.med-list-notes" })}</div>}
        {(options.history || options.medList) && (
          <div className="ml-2 border-l pl-3">{select("historyRange", "Medication history range", HISTORY_RANGES, { help: "report.history-range" })}</div>
        )}
        {BOOLEANS.slice(7).map((b) => check(b.key, b.label, b))}
        <hr className="my-2" />
        {select("obs", "Observations", OBS_RANGES, { help: "report.obs" })}
        {options.obs !== "off" && (
          <div className="ml-2 border-l pl-3">
            {select("obsView", "Chart", OBS_VIEWS, { help: "report.obs-view" })}
            {check("obsList", "Entry list", { help: "report.obs-list" })}
            {options.obsList && <div className="ml-2 border-l pl-3">{check("obsNotes", "Include notes", { help: "report.obs-notes" })}</div>}
          </div>
        )}
        <hr className="my-2" />
        {check("expense", "Medical expense", { help: "report.expense" })}
        {select("visits", "Visits & expenses", VISIT_MODES, { help: "report.visits" })}
        {check("reminders", "Health reminders", { help: "report.reminders" })}
      </div>
    </aside>
  )
}
