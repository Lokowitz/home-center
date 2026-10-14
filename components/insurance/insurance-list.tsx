"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Pencil, Trash2 } from "lucide-react"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { createInsurancePolicy, deleteInsurancePolicy, updateInsurancePolicy } from "@/lib/actions/insurance"
import { daysUntil, formatDay, HEALTH_WINDOWS, INSURANCE_KINDS, labelFor, toDateInput } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Attachment, InsurancePolicy } from "@/app/generated/prisma/client"
import { useFormat } from "@/components/regional-provider"

export type PolicyRow = InsurancePolicy & { members: { id: string; name: string }[]; attachments: Attachment[] }

function coverageStatus(p: PolicyRow) {
  if (!p.endDate) return { label: "Active", variant: "outline" as const }
  const days = daysUntil(p.endDate, new Date())
  if (days < 0) return { label: "Ended", variant: "secondary" as const }
  if (days <= HEALTH_WINDOWS.insuranceDays) return { label: days === 0 ? "Ends today" : `Ends in ${days}d`, variant: "destructive" as const }
  return { label: "Active", variant: "outline" as const }
}

function initialFor(p: PolicyRow | null): FormValues {
  return {
    carrier: p?.carrier ?? "",
    planName: p?.planName ?? "",
    kind: p?.kind ?? "MEDICAL",
    memberId: p?.memberId ?? "",
    groupNumber: p?.groupNumber ?? "",
    policyNumber: p?.policyNumber ?? "",
    phone: p?.phone ?? "",
    startDate: toDateInput(p?.startDate),
    endDate: toDateInput(p?.endDate),
    deductible: p?.deductible?.toString() ?? "",
    outOfPocketMax: p?.outOfPocketMax?.toString() ?? "",
    memberIds: p?.members.map((m) => m.id).join(",") ?? "",
    notes: p?.notes ?? "",
  }
}

interface Props {
  policies: PolicyRow[]
  people: { id: string; name: string }[]
  openId?: string
}

export function InsuranceList({ policies, people, openId }: Props) {
  const fmt = useFormat()
  const [editing, setEditing] = useState<PolicyRow | null>(null)
  const [open, setOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? policies.find((p) => p.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  const fields: FieldConfig[] = [
    { name: "carrier", label: "Carrier", kind: "text", required: true, placeholder: "Blue Cross" },
    { name: "planName", label: "Plan", kind: "text", placeholder: "PPO Family" },
    { name: "kind", label: "Type", kind: "select", required: true, options: INSURANCE_KINDS },
    { name: "memberId", label: "Member ID", kind: "text" },
    { name: "groupNumber", label: "Group number", kind: "text" },
    { name: "policyNumber", label: "Policy number", kind: "text" },
    { name: "phone", label: "Member services phone", kind: "tel" },
    { name: "startDate", label: "Coverage starts", kind: "date" },
    { name: "endDate", label: "Coverage ends", kind: "date" },
    { name: "deductible", label: `Deductible (${fmt.currencySymbol})`, kind: "number" },
    { name: "outOfPocketMax", label: `Out-of-pocket max (${fmt.currencySymbol})`, kind: "number" },
    { name: "memberIds", label: "Covers", kind: "checkboxes", options: people.map((p) => ({ value: p.id, label: p.name })), wide: true },
    { name: "notes", label: "Notes", kind: "textarea", wide: true },
  ]

  async function handleDelete(p: PolicyRow) {
    if (!confirm(`Delete the ${p.carrier} policy and its files?`)) return
    const result = await deleteInsurancePolicy(p.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Policy deleted.")
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Insurance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Medical, dental and vision coverage, with card images.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }}>Add Policy</Button>
      </div>

      {policies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="font-medium">No policies yet</p>
          <p className="text-sm mt-1">Add a policy, then attach photos of the front and back of the card.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {policies.map((p) => {
            const status = coverageStatus(p)
            const rows: [string, string | null][] = [
              ["Member ID", p.memberId],
              ["Group", p.groupNumber],
              ["Policy", p.policyNumber],
              ["Phone", p.phone],
              ["Deductible", p.deductible != null ? fmt.money(p.deductible) : null],
              ["Out-of-pocket max", p.outOfPocketMax != null ? fmt.money(p.outOfPocketMax) : null],
              ["Coverage", p.startDate || p.endDate ? `${formatDay(p.startDate)} – ${formatDay(p.endDate)}` : null],
              ["Covers", p.members.length > 0 ? p.members.map((m) => m.name).join(", ") : "Nobody yet"],
            ]
            return (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{p.carrier}{p.planName ? ` · ${p.planName}` : ""}</CardTitle>
                      <div className="mt-1 flex gap-1.5">
                        <Badge variant="secondary">{labelFor(INSURANCE_KINDS, p.kind)}</Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${p.carrier} policy`} onClick={() => { setEditing(p); setOpen(true) }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${p.carrier} policy`} onClick={() => handleDelete(p)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {rows.filter(([, v]) => v).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className={label === "Member ID" || label === "Group" || label === "Policy" ? "font-mono" : undefined}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <AttachmentList recordId={p.id} recordType="INSURANCE" attachments={p.attachments} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Policy" : "Add Policy"}
        submitLabel={editing ? "Save Changes" : "Add Policy"}
        successMessage={editing ? "Policy updated." : "Policy added. Attach card images on its card."}
        fields={fields}
        initial={initialFor(editing)}
        onSubmit={(values) => (editing ? updateInsurancePolicy(editing.id, values) : createInsurancePolicy(values))}
      />
    </>
  )
}
