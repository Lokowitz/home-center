"use client"

import { useEffect } from "react"
import { CheckList } from "@/components/forms/check-list"
import { useFormat } from "@/components/regional-provider"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { createProperty, updateProperty } from "@/lib/actions/properties"
import type { Property } from "@/app/generated/prisma/client"
import { AddRemindersSubmit, remindersHref } from "@/components/maintenance/add-reminders-submit"

const TYPE_LABELS: Record<string, string> = {
  HOUSE: "House", CONDO: "Condo", TOWNHOUSE: "Townhouse", LOT: "Lot / Land", OTHER: "Other",
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["HOUSE", "CONDO", "TOWNHOUSE", "LOT", "OTHER"]),
  address: z.string().min(1, "Address is required"),
  purchaseDate: z.string().optional(),
  purchasePrice: z.string().optional(),
  yearBuilt: z.string().optional(),
  sqFt: z.string().optional(),
  notes: z.string().optional(),
  policyIds: z.array(z.string()),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  property?: Property | null
  /** Policies that may cover a property, for the Insurance list. Edit only: empty hides the list. */
  policyChoices?: { id: string; name: string }[]
  /** The policies linked to this property now. */
  policyIds?: string[]
}

const NO_CHOICES: { id: string; name: string }[] = []
const NO_IDS: string[] = []

export function PropertyFormDialog({ open, onClose, property, policyChoices = NO_CHOICES, policyIds = NO_IDS }: Props) {
  const router = useRouter()
  const fmt = useFormat()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", type: "HOUSE", address: "",
      purchaseDate: "", purchasePrice: "", yearBuilt: "", sqFt: "", notes: "", policyIds: [],
    },
  })
  const ticked = useWatch({ control: form.control, name: "policyIds" })
  // Shown only when editing and there is at least one policy that could cover a property.
  const showInsurance = !!property && policyChoices.length > 0
  const linkedKey = policyIds.join(",")

  useEffect(() => {
    if (property) {
      form.reset({
        name: property.name,
        type: property.type,
        address: property.address,
        purchaseDate: property.purchaseDate ? new Date(property.purchaseDate).toISOString().split("T")[0] : "",
        purchasePrice: property.purchasePrice?.toString() ?? "",
        yearBuilt: property.yearBuilt?.toString() ?? "",
        sqFt: property.sqFt?.toString() ?? "",
        notes: property.notes ?? "",
        policyIds: linkedKey ? linkedKey.split(",") : [],
      })
    } else {
      form.reset({ name: "", type: "HOUSE", address: "", purchaseDate: "", purchasePrice: "", yearBuilt: "", sqFt: "", notes: "", policyIds: [] })
    }
  }, [property, open, form, linkedKey])

  async function onSubmit(values: FormValues, then: "close" | "reminders" = "close") {
    const { policyIds: chosen, ...fields } = values
    const result = property
      ? await updateProperty(property.id, fields as unknown as Parameters<typeof updateProperty>[1], showInsurance ? chosen : undefined)
      : await createProperty(fields as unknown as Parameters<typeof createProperty>[0])

    if (result?.error) {
      toast.error("Please fix the errors and try again.")
      return
    }
    toast.success(property ? "Property updated." : "Property added.")
    onClose()
    if (then === "reminders" && result && "id" in result && typeof result.id === "string") router.push(remindersHref("PROPERTY", result.id))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{property ? "Edit Property" : "Add Property"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="property.name">Name *</FormLabel>
                  <FormControl><Input placeholder="Main House" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel help="property.type">Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue>{(v: string) => TYPE_LABELS[v] ?? v}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="HOUSE">House</SelectItem>
                      <SelectItem value="CONDO">Condo</SelectItem>
                      <SelectItem value="TOWNHOUSE">Townhouse</SelectItem>
                      <SelectItem value="LOT">Lot / Land</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="yearBuilt" render={({ field }) => (
                <FormItem>
                  <FormLabel help="property.year-built">Year Built</FormLabel>
                  <FormControl><Input type="number" placeholder="1995" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="property.address">Address *</FormLabel>
                  <FormControl><Input placeholder="123 Main St, City, State" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="property.purchase-date">Purchase Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchasePrice" render={({ field }) => (
                <FormItem>
                  <FormLabel help="property.purchase-price">Purchase Price</FormLabel>
                  <FormControl><Input type="number" placeholder="350000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="sqFt" render={({ field }) => (
                <FormItem>
                  <FormLabel help="property.area">{fmt.areaLabel}</FormLabel>
                  <FormControl><Input type="number" placeholder="2000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="property.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {showInsurance && (
                <CheckList
                  label="Insurance"
                  help="property.insurance"
                  options={policyChoices}
                  value={ticked}
                  onChange={(next) => form.setValue("policyIds", next, { shouldDirty: true })}
                />
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {!property && <AddRemindersSubmit pending={form.formState.isSubmitting} onClick={form.handleSubmit((v) => onSubmit(v, "reminders"))} />}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : property ? "Save Changes" : "Add Property"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
