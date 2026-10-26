"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckList } from "@/components/forms/check-list"
import { showServerError } from "@/components/forms/server-errors"
import { useFormat } from "@/components/regional-provider"
import { createInsurancePolicy, updateInsurancePolicy } from "@/lib/actions/insurance"
import { allowedLinks, coverageSuggestions, insuranceKindLabel, isHealthInsuranceKind, kindOptions } from "@/lib/insurance"
import { toDateInput } from "@/lib/health"
import type { PolicyInput } from "@/lib/health-schemas"
import type { PolicyRow } from "@/lib/insurance-server"
import { MAX_NAME_LENGTH, NAME_MESSAGE, fieldIssue, moneyAmount, optionalDateText } from "@/lib/input-limits"

const schema = z.object({
  carrier: z.string().trim().min(1, "Carrier is required").max(MAX_NAME_LENGTH, NAME_MESSAGE),
  planName: z.string().trim().max(MAX_NAME_LENGTH, NAME_MESSAGE),
  kind: z.string(),
  policyNumber: z.string(),
  phone: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  deductible: z.string(),
  groupNumber: z.string(),
  memberId: z.string(),
  outOfPocketMax: z.string(),
  notes: z.string(),
  memberIds: z.array(z.string()),
  propertyIds: z.array(z.string()),
  vehicleIds: z.array(z.string()),
  coverages: z.array(z.object({ label: z.string(), limit: z.string(), deductible: z.string() })),
}).superRefine((v, ctx) => {
  // Same limits as the server. Out-of-pocket max only shows, and is only sent, for health kinds.
  const check = (path: (string | number)[], schema: z.ZodTypeAny, text: string) => {
    const message = fieldIssue(schema, text)
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  }
  check(["startDate"], optionalDateText, v.startDate)
  check(["endDate"], optionalDateText, v.endDate)
  check(["deductible"], moneyAmount(), v.deductible)
  if (isHealthInsuranceKind(v.kind)) check(["outOfPocketMax"], moneyAmount(), v.outOfPocketMax)
  // A coverage line's error shows under the list, where the server's does.
  for (const c of v.coverages) {
    check(["coverages"], moneyAmount(), c.limit)
    check(["coverages"], moneyAmount(), c.deductible)
  }
})

type FormValues = z.infer<typeof schema>
type Named = { id: string; name: string }

// The fields that show their own message; an error on the kind or the linked people is toasted.
const SHOWN_FIELDS = ["carrier", "planName", "policyNumber", "phone", "startDate", "endDate", "deductible", "groupNumber", "memberId", "outOfPocketMax", "notes", "coverages"]

function toValues(policy: PolicyRow | null): FormValues {
  return {
    carrier: policy?.carrier ?? "",
    planName: policy?.planName ?? "",
    kind: policy?.kind ?? "HOME",
    policyNumber: policy?.policyNumber ?? "",
    phone: policy?.phone ?? "",
    startDate: toDateInput(policy?.startDate),
    endDate: toDateInput(policy?.endDate),
    deductible: policy?.deductible?.toString() ?? "",
    groupNumber: policy?.groupNumber ?? "",
    memberId: policy?.memberId ?? "",
    outOfPocketMax: policy?.outOfPocketMax?.toString() ?? "",
    notes: policy?.notes ?? "",
    memberIds: policy?.members.map((m) => m.id) ?? [],
    propertyIds: policy?.properties.map((p) => p.id) ?? [],
    vehicleIds: policy?.vehicles.map((v) => v.id) ?? [],
    coverages: (policy?.coverages ?? []).map((c) => ({ label: c.label, limit: c.limit?.toString() ?? "", deductible: c.deductible?.toString() ?? "" })),
  }
}

interface Props {
  open: boolean
  onClose: () => void
  /** null adds a policy. */
  policy: PolicyRow | null
  health: boolean
  people: Named[]
  properties: Named[]
  vehicles: Named[]
}

export function InsuranceFormDialog({ open, onClose, policy, health, people, properties, vehicles }: Props) {
  const fmt = useFormat()
  const router = useRouter()

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(policy) })
  const coverages = useFieldArray({ control: form.control, name: "coverages" })
  const [kind, memberIds, propertyIds, vehicleIds] = useWatch({ control: form.control, name: ["kind", "memberIds", "propertyIds", "vehicleIds"] })

  useEffect(() => {
    form.reset(toValues(policy))
  }, [policy, open, form])

  const healthKind = isHealthInsuranceKind(kind)
  const coverageError = form.formState.errors.coverages?.message ?? form.formState.errors.coverages?.root?.message
  const allowed = allowedLinks(kind, health)
  const suggestions = coverageSuggestions(kind)

  function addCoverage() {
    const used = new Set(form.getValues("coverages").map((c) => c.label.trim().toLowerCase()))
    coverages.append({ label: suggestions.find((s) => !used.has(s.toLowerCase())) ?? "", limit: "", deductible: "" })
  }

  async function onSubmit(values: FormValues) {
    const payload: PolicyInput = {
      ...values,
      kind: values.kind as PolicyInput["kind"],
      // A picker that isn't shown sends nothing, so the server drops those links.
      memberIds: allowed.members ? values.memberIds.join(",") : "",
      propertyIds: allowed.assets ? values.propertyIds.join(",") : "",
      vehicleIds: allowed.assets ? values.vehicleIds.join(",") : "",
      ...(healthKind ? {} : { groupNumber: "", memberId: "", outOfPocketMax: "" }),
    }
    const result = policy ? await updateInsurancePolicy(policy.id, payload) : await createInsurancePolicy(payload)

    if (result.error) {
      showServerError(form, result.error, SHOWN_FIELDS)
      return
    }

    toast.success(policy ? "Policy updated." : "Policy added.")
    router.refresh()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{policy ? "Edit Policy" : "Add Policy"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="carrier" render={({ field }) => (
                <FormItem>
                  <FormLabel help="policy.carrier">Carrier *</FormLabel>
                  <FormControl><Input placeholder="State Farm" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="planName" render={({ field }) => (
                <FormItem>
                  <FormLabel help="policy.plan">Plan</FormLabel>
                  <FormControl><Input placeholder="Homeowners HO-3" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="space-y-2">
                <FormLabel help="policy.type">Type</FormLabel>
                <Select value={kind} onValueChange={(v) => v && form.setValue("kind", v, { shouldDirty: true })}>
                  <SelectTrigger className="w-full" aria-label="Type">
                    <SelectValue>{(v: string) => insuranceKindLabel(v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions(health).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FormField control={form.control} name="policyNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel help="policy.number">Policy number</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  {healthKind ? <FormLabel help="policy.member-phone">Member services phone</FormLabel> : <FormLabel help="policy.phone">Phone</FormLabel>}
                  <FormControl><Input type="tel" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="deductible" render={({ field }) => (
                <FormItem>
                  <FormLabel help="policy.deductible">{`Deductible (${fmt.currencySymbol})`}</FormLabel>
                  <FormControl><Input type="number" step="any" min="0" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem>
                  {healthKind ? <FormLabel help="policy.coverage-start">Coverage starts</FormLabel> : <FormLabel help="policy.term-start">Term starts</FormLabel>}
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem>
                  {healthKind ? <FormLabel help="policy.coverage-end">Coverage ends</FormLabel> : <FormLabel help="policy.renewal">Renewal date</FormLabel>}
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {healthKind && (
                <>
                  <FormField control={form.control} name="memberId" render={({ field }) => (
                    <FormItem>
                      <FormLabel help="policy.member-id">Member ID</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="groupNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel help="policy.group">Group number</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="outOfPocketMax" render={({ field }) => (
                    <FormItem>
                      <FormLabel help="policy.oop-max">{`Out-of-pocket max (${fmt.currencySymbol})`}</FormLabel>
                      <FormControl><Input type="number" step="any" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}

              {allowed.members && people.length > 0 && (
                <CheckList label="Covers people" help="policy.covers-people" options={people} value={memberIds} onChange={(next) => form.setValue("memberIds", next, { shouldDirty: true })} />
              )}
              {allowed.assets && properties.length > 0 && (
                <CheckList label="Covers properties" help="policy.covers-properties" options={properties} value={propertyIds} onChange={(next) => form.setValue("propertyIds", next, { shouldDirty: true })} />
              )}
              {allowed.assets && vehicles.length > 0 && (
                <CheckList label="Covers vehicles" help="policy.covers-vehicles" options={vehicles} value={vehicleIds} onChange={(next) => form.setValue("vehicleIds", next, { shouldDirty: true })} />
              )}

              <div className="col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <FormLabel help="policy.coverage">Coverage</FormLabel>
                  <Button type="button" variant="outline" size="sm" onClick={addCoverage}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add coverage
                  </Button>
                </div>
                <datalist id="coverage-label-suggestions">
                  {suggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
                {coverages.fields.length === 0 && <p className="text-sm text-muted-foreground">No coverage lines yet.</p>}
                {coverages.fields.map((row, i) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <Input
                      list="coverage-label-suggestions"
                      autoComplete="off"
                      placeholder="Dwelling"
                      aria-label="Coverage name"
                      className="min-w-0 flex-1"
                      {...form.register(`coverages.${i}.label`)}
                    />
                    <Input type="number" step="any" min="0" placeholder="Limit" aria-label="Limit" className="w-28" {...form.register(`coverages.${i}.limit`)} />
                    <Input type="number" step="any" min="0" placeholder="Deductible" aria-label="Deductible" className="w-28" {...form.register(`coverages.${i}.deductible`)} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Move up" disabled={i === 0} onClick={() => coverages.move(i, i - 1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Move down" disabled={i === coverages.fields.length - 1} onClick={() => coverages.move(i, i + 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Remove coverage" onClick={() => coverages.remove(i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {coverageError && <p className="text-sm text-destructive">{coverageError}</p>}
              </div>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="policy.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : policy ? "Save Changes" : "Add Policy"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
