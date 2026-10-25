"use client"

import { useEffect } from "react"
import { CheckList } from "@/components/forms/check-list"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createVehicle, updateVehicle } from "@/lib/actions/vehicles"
import { AddRemindersSubmit, remindersHref } from "@/components/maintenance/add-reminders-submit"
import type { Vehicle } from "@/app/generated/prisma/client"
import { useFormat } from "@/components/regional-provider"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.string().min(1, "Year is required"),
  vin: z.string().optional(),
  color: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.string().optional(),
  currentMileage: z.string().optional(),
  meterUnit: z.enum(["MILES", "HOURS"]),
  notes: z.string().optional(),
  policyIds: z.array(z.string()),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  vehicle?: Vehicle | null
  /** Policies that may cover a vehicle, for the Insurance list. Edit only: empty hides the list. */
  policyChoices?: { id: string; name: string }[]
  /** The policies linked to this vehicle now. */
  policyIds?: string[]
}

const NO_CHOICES: { id: string; name: string }[] = []
const NO_IDS: string[] = []

export function VehicleFormDialog({ open, onClose, vehicle, policyChoices = NO_CHOICES, policyIds = NO_IDS }: Props) {
  const router = useRouter()
  const fmt = useFormat()
  const milesLabel = fmt.distanceWords.charAt(0).toUpperCase() + fmt.distanceWords.slice(1)
  const meterUnitLabels: Record<string, string> = { MILES: milesLabel, HOURS: "Hours" }
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", make: "", model: "", year: new Date().getFullYear().toString(),
      vin: "", color: "", purchaseDate: "", purchasePrice: "", currentMileage: "", meterUnit: "MILES", notes: "", policyIds: [],
    },
  })
  const ticked = useWatch({ control: form.control, name: "policyIds" })
  // Shown only when editing and there is at least one policy that could cover a vehicle.
  const showInsurance = !!vehicle && policyChoices.length > 0
  const linkedKey = policyIds.join(",")

  useEffect(() => {
    if (vehicle) {
      form.reset({
        name: vehicle.name,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year.toString(),
        vin: vehicle.vin ?? "",
        color: vehicle.color ?? "",
        purchaseDate: vehicle.purchaseDate ? new Date(vehicle.purchaseDate).toISOString().split("T")[0] : "",
        purchasePrice: vehicle.purchasePrice?.toString() ?? "",
        currentMileage: vehicle.currentMileage?.toString() ?? "",
        meterUnit: vehicle.meterUnit,
        notes: vehicle.notes ?? "",
        policyIds: linkedKey ? linkedKey.split(",") : [],
      })
    } else {
      form.reset({
        name: "", make: "", model: "", year: new Date().getFullYear().toString(),
        vin: "", color: "", purchaseDate: "", purchasePrice: "", currentMileage: "", meterUnit: "MILES", notes: "", policyIds: [],
      })
    }
  }, [vehicle, open, form, linkedKey])

  async function onSubmit(values: FormValues, then: "close" | "reminders" = "close") {
    const { policyIds: chosen, ...fields } = values
    const result = vehicle
      ? await updateVehicle(vehicle.id, fields as unknown as Parameters<typeof updateVehicle>[1], showInsurance ? chosen : undefined)
      : await createVehicle(fields as unknown as Parameters<typeof createVehicle>[0])

    if (result?.error) {
      toast.error("Please fix the errors and try again.")
      return
    }
    toast.success(vehicle ? "Vehicle updated." : "Vehicle added.")
    onClose()
    if (then === "reminders" && result && "id" in result && typeof result.id === "string") router.push(remindersHref("VEHICLE", result.id))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="vehicle.name">Nickname *</FormLabel>
                  <FormControl><Input placeholder="Family SUV" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="year" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.year">Year *</FormLabel>
                  <FormControl><Input type="number" placeholder="2022" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="make" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.make">Make *</FormLabel>
                  <FormControl><Input placeholder="Toyota" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="model" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.model">Model *</FormLabel>
                  <FormControl><Input placeholder="RAV4" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="color" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.color">Color</FormLabel>
                  <FormControl><Input placeholder="Silver" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.purchase-date">Purchase Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchasePrice" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.purchase-price">{`Purchase Price (${fmt.currencySymbol})`}</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="28500" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="currentMileage" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.current-mileage">Current {fmt.meterNoun(form.watch("meterUnit"))}</FormLabel>
                  <FormControl><Input type="number" placeholder={form.watch("meterUnit") === "HOURS" ? "1250" : "45000"} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="meterUnit" render={({ field }) => (
                <FormItem>
                  <FormLabel help="vehicle.tracked-in">Tracked In</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="w-full"><SelectValue>{(v: string) => meterUnitLabels[v] ?? v}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="MILES">{milesLabel}</SelectItem>
                      <SelectItem value="HOURS">Hours</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="vin" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="vehicle.vin">VIN</FormLabel>
                  <FormControl><Input placeholder="1HGCM82633A123456" className="font-mono text-sm" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="vehicle.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {showInsurance && (
                <CheckList
                  label="Insurance"
                  help="vehicle.insurance"
                  options={policyChoices}
                  value={ticked}
                  onChange={(next) => form.setValue("policyIds", next, { shouldDirty: true })}
                />
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {!vehicle && <AddRemindersSubmit pending={form.formState.isSubmitting} onClick={form.handleSubmit((v) => onSubmit(v, "reminders"))} />}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : vehicle ? "Save Changes" : "Add Vehicle"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
