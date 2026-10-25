"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { groupPolicies } from "@/lib/insurance"
import type { PolicyRow } from "@/lib/insurance-server"
import { InsuranceFormDialog } from "./insurance-form-dialog"
import { PolicyCard } from "./policy-card"

export type { PolicyRow }

interface Props {
  policies: PolicyRow[]
  people: { id: string; name: string }[]
  properties: { id: string; name: string }[]
  vehicles: { id: string; name: string }[]
  health: boolean
  openId?: string
  /** Shown instead of the usual empty state when the property filter left nothing. */
  emptyText?: string | null
}

export function InsuranceList({ policies, people, properties, vehicles, health, openId, emptyText }: Props) {
  const [editing, setEditing] = useState<PolicyRow | null>(null)
  const [open, setOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? policies.find((p) => p.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  const groups = groupPolicies(policies, health)

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Insurance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {health
              ? "Home, auto, umbrella and life policies, plus medical, dental and vision."
              : "Home, auto, umbrella and life policies."}
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }}>Add Policy</Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {emptyText ? (
            <p className="font-medium">{emptyText}</p>
          ) : (
            <>
              <p className="font-medium">No policies yet</p>
              <p className="text-sm mt-1">Add a policy, then attach the declarations page or card photos on its card.</p>
            </>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.group} className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">{g.title}</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {g.policies.map((p) => (
                <PolicyCard key={p.id} policy={p} health={health} onEdit={() => { setEditing(p); setOpen(true) }} />
              ))}
            </div>
          </section>
        ))
      )}

      <InsuranceFormDialog
        open={open}
        onClose={() => setOpen(false)}
        policy={editing}
        health={health}
        people={people}
        properties={properties}
        vehicles={vehicles}
      />
    </>
  )
}
