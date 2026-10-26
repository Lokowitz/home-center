"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { useFormat } from "@/components/regional-provider"
import { assetHref } from "@/lib/assets"
import { addInsurancePremium, deleteInsurancePolicy, deleteInsurancePremium } from "@/lib/actions/insurance"
import {
  annualPremium, currentAndPrevious, insuranceKindLabel, isHealthInsuranceKind, policyStatus,
  PREMIUM_PERIODS, premiumChange, premiumChangeLabel,
} from "@/lib/insurance"
import type { FieldConfig } from "@/lib/form-types"
import type { PolicyRow } from "@/lib/insurance-server"

const MONO_ROWS = new Set(["Member ID", "Group", "Policy"])

interface Props {
  policy: PolicyRow
  health: boolean
  onEdit: () => void
}

export function PolicyCard({ policy: p, health, onEdit }: Props) {
  const fmt = useFormat()
  const [premiumOpen, setPremiumOpen] = useState(false)
  const healthKind = isHealthInsuranceKind(p.kind)
  const status = policyStatus(p, new Date())
  const { current, previous } = currentAndPrevious(p.premiums, new Date())
  const change = premiumChangeLabel(premiumChange(current, previous))
  const periodLabel = (period: string) => PREMIUM_PERIODS.find((o) => o.value === period)?.label ?? period

  const assets = [
    ...p.properties.map((x) => ({ key: `p${x.id}`, name: x.name, href: assetHref("PROPERTY", x.id) })),
    ...p.vehicles.map((x) => ({ key: `v${x.id}`, name: x.name, href: assetHref("VEHICLE", x.id) })),
  ]
  const people = health ? p.members.map((m) => m.name) : []
  const hasLinks = assets.length > 0 || people.length > 0

  const range = p.startDate || p.endDate
    ? `${p.startDate ? fmt.date(p.startDate, { utc: true }) : "—"} – ${p.endDate ? fmt.date(p.endDate, { utc: true }) : "—"}`
    : null
  const rows: [string, string | null][] = healthKind
    ? [
        ["Member ID", p.memberId],
        ["Group", p.groupNumber],
        ["Policy", p.policyNumber],
        ["Phone", p.phone],
        ["Deductible", p.deductible != null ? fmt.money(p.deductible) : null],
        ["Out-of-pocket max", p.outOfPocketMax != null ? fmt.money(p.outOfPocketMax) : null],
        ["Coverage", range],
      ]
    : [
        ["Renews", p.endDate ? fmt.date(p.endDate, { utc: true }) : null],
        ["Policy", p.policyNumber],
        ["Phone", p.phone],
        ["Deductible", p.deductible != null ? fmt.money(p.deductible) : null],
      ]

  const premiumFields: FieldConfig[] = [
    { name: "effectiveDate", label: "Starts", kind: "date", required: true, help: "premium.starts" },
    { name: "amount", label: `Amount (${fmt.currencySymbol})`, kind: "number", required: true, help: "premium.amount" },
    { name: "period", label: "Billed", kind: "select", required: true, options: PREMIUM_PERIODS, help: "premium.billed" },
    { name: "notes", label: "Notes", kind: "text", wide: true, help: "premium.notes" },
  ]

  async function handleDelete() {
    if (!confirm(`Delete the ${p.carrier} policy and its files?`)) return
    const result = await deleteInsurancePolicy(p.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Policy deleted.")
  }

  async function handleDeletePremium(id: string, date: string) {
    if (!confirm(`Delete this premium (${date})?`)) return
    const result = await deleteInsurancePremium(id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Premium deleted.")
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{p.carrier}{p.planName ? ` · ${p.planName}` : ""}</CardTitle>
            <div className="mt-1 flex gap-1.5">
              <Badge variant="secondary">{insuranceKindLabel(p.kind)}</Badge>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${p.carrier} policy`} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${p.carrier} policy`} onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Covers</dt>
          <dd>
            {hasLinks ? (
              <>
                {assets.map((a, i) => (
                  <span key={a.key}>
                    {i > 0 && ", "}
                    <Link href={a.href} className="underline-offset-2 hover:underline">{a.name}</Link>
                  </span>
                ))}
                {assets.length > 0 && people.length > 0 && ", "}
                {people.join(", ")}
              </>
            ) : (
              healthKind || p.kind === "LIFE" ? "Nobody yet" : "Nothing linked yet"
            )}
          </dd>
          {current && (
            <>
              <dt className="text-muted-foreground">Premium</dt>
              <dd>
                {fmt.money(annualPremium(current))}/yr
                {change && <span className="ml-2 text-xs text-muted-foreground">{change}</span>}
              </dd>
            </>
          )}
          {rows.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={MONO_ROWS.has(label) ? "font-mono" : undefined}>{value}</dd>
            </div>
          ))}
        </dl>

        {p.coverages.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coverage</div>
            <ul className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 text-sm">
              {p.coverages.map((c) => (
                <li key={c.id} className="contents">
                  <span>{c.label}</span>
                  <span className="text-right tabular-nums">{c.limit != null ? fmt.money(c.limit) : "—"}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{c.deductible != null ? `${fmt.money(c.deductible)} ded.` : "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Premiums</div>
            <Button type="button" variant="outline" size="sm" onClick={() => setPremiumOpen(true)}>Add premium</Button>
          </div>
          {p.premiums.length === 0 ? (
            <p className="text-sm text-muted-foreground">No premiums recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {p.premiums.map((pr) => {
                const date = fmt.date(pr.effectiveDate, { utc: true })
                return (
                  <li key={pr.id} className="flex items-center gap-2">
                    <span className="text-muted-foreground">{date}</span>
                    <span>
                      {fmt.money(pr.amount)} {periodLabel(pr.period).toLowerCase()}
                      {pr.period !== "ANNUAL" && ` (${fmt.money(annualPremium(pr))}/yr)`}
                    </span>
                    {pr.notes && <span className="truncate text-xs text-muted-foreground">{pr.notes}</span>}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete premium from ${date}`}
                      onClick={() => handleDeletePremium(pr.id, date)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <AttachmentList recordId={p.id} recordType="INSURANCE" attachments={p.attachments} />
      </CardContent>

      <EntityFormDialog
        open={premiumOpen}
        onClose={() => setPremiumOpen(false)}
        title="Add Premium"
        submitLabel="Add Premium"
        successMessage="Premium added."
        fields={premiumFields}
        initial={{ effectiveDate: "", amount: "", period: "ANNUAL", notes: "" }}
        onSubmit={(values) => addInsurancePremium(p.id, values)}
      />
    </Card>
  )
}
