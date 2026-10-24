"use client"

import { useEffect, useId } from "react"
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
import { createEquipment, updateEquipment } from "@/lib/actions/equipment"
import { EQUIPMENT_CATEGORIES, categoryLabel } from "./categories"
import type { Equipment, EquipmentCategory } from "@/app/generated/prisma/client"
import { AddRemindersSubmit, remindersHref } from "@/components/maintenance/add-reminders-submit"
import { locationLabel, resolveRoomId } from "@/lib/rooms"
import { VALUE_CLASSES, defaultValueClass, valueClassLabel, type ValueClass } from "@/lib/equipment-value"
import type { PropertyWithRooms } from "@/lib/rooms-server"

// Base UI Select has no empty-string option, so "unassigned" needs a sentinel.
const NO_PROPERTY = "__none__"
// Same for "Counts as": Default means the category decides, and is saved as no value.
const DEFAULT_CLASS = "__default__"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(["APPLIANCE", "HVAC", "WATER", "ELECTRONICS", "TOOL", "OUTDOOR", "SECURITY", "OTHER"]),
  manufacturer: z.string().optional(),
  modelNumber: z.string().optional(),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  propertyId: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.string().optional(),
  installDate: z.string().optional(),
  valueClass: z.string().optional(),
  expectedLifeYears: z.string().optional(),
  replacementCost: z.string().optional(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

export type EquipmentWithRoom = Equipment & { room?: { name: string } | null }

interface Props {
  open: boolean
  onClose: () => void
  equipment?: EquipmentWithRoom | null
  /** Rooms are the location suggestions for each property; empty when Rooms is off. */
  properties: PropertyWithRooms[]
  /** A new item's starting property and location text (the room dialog passes its own). */
  defaultPropertyId?: string
  defaultLocation?: string
}

function fmt(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().split("T")[0] : ""
}

const EMPTY: FormValues = {
  name: "", category: "APPLIANCE", manufacturer: "", modelNumber: "", serialNumber: "",
  location: "", propertyId: NO_PROPERTY, purchaseDate: "", purchasePrice: "", installDate: "", valueClass: DEFAULT_CLASS, expectedLifeYears: "", replacementCost: "", notes: "",
}

export function EquipmentFormDialog({ open, onClose, equipment, properties, defaultPropertyId, defaultLocation }: Props) {
  const router = useRouter()
  const roomListId = useId()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  })

  useEffect(() => {
    form.reset(
      equipment
        ? {
            name: equipment.name,
            category: equipment.category,
            manufacturer: equipment.manufacturer ?? "",
            modelNumber: equipment.modelNumber ?? "",
            serialNumber: equipment.serialNumber ?? "",
            location: locationLabel(equipment) ?? "",
            propertyId: equipment.propertyId ?? NO_PROPERTY,
            purchaseDate: fmt(equipment.purchaseDate),
            purchasePrice: equipment.purchasePrice?.toString() ?? "",
            installDate: fmt(equipment.installDate),
            valueClass: equipment.valueClass ?? DEFAULT_CLASS,
            expectedLifeYears: equipment.expectedLifeYears?.toString() ?? "",
            replacementCost: equipment.replacementCost?.toString() ?? "",
            notes: equipment.notes ?? "",
          }
        : { ...EMPTY, propertyId: defaultPropertyId ?? EMPTY.propertyId, location: defaultLocation ?? EMPTY.location }
    )
  }, [equipment, open, form, defaultPropertyId, defaultLocation])

  const selectedPropertyId = useWatch({ control: form.control, name: "propertyId" })
  const selectedCategory = useWatch({ control: form.control, name: "category" })
  const selectedRooms = properties.find((p) => p.id === selectedPropertyId)?.rooms ?? []

  async function onSubmit(values: FormValues, then: "close" | "reminders" = "close") {
    const propertyId = values.propertyId === NO_PROPERTY ? "" : values.propertyId
    const roomId = resolveRoomId(values.location, propertyId, selectedRooms, equipment)
    const payload = {
      ...values,
      propertyId,
      roomId,
      valueClass: values.valueClass === DEFAULT_CLASS ? "" : values.valueClass,
    } as unknown as Parameters<typeof createEquipment>[0]

    const result = equipment
      ? await updateEquipment(equipment.id, payload)
      : await createEquipment(payload)

    if (result?.error) {
      toast.error("Please fix the errors and try again.")
      return
    }
    toast.success(equipment ? "Equipment updated." : "Equipment added.")
    onClose()
    // Pages that list this item (a room's Equipment tab) re-read it without a navigation.
    router.refresh()
    if (then === "reminders" && result && "id" in result && typeof result.id === "string") router.push(remindersHref("EQUIPMENT", result.id))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{equipment ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="equipment.name">Name *</FormLabel>
                  <FormControl><Input placeholder="Kitchen Refrigerator" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.category">Category *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="w-full"><SelectValue>{(v: EquipmentCategory) => categoryLabel(v)}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>
                      {EQUIPMENT_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="propertyId" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.property">Property</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="w-full"><SelectValue>{(v: string) => properties.find((p) => p.id === v)?.name ?? "Not assigned"}</SelectValue></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NO_PROPERTY}>Not assigned</SelectItem>
                      {properties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="manufacturer" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.manufacturer">Manufacturer</FormLabel>
                  <FormControl><Input placeholder="LG" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="modelNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.model-number">Model Number</FormLabel>
                  <FormControl><Input placeholder="LRFVS3006S" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="serialNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.serial-number">Serial Number</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.location">Location</FormLabel>
                  <FormControl><Input placeholder="Kitchen" list={selectedRooms.length ? roomListId : undefined} autoComplete="off" {...field} /></FormControl>
                  {selectedRooms.length > 0 && (
                    <datalist id={roomListId}>
                      {selectedRooms.map((r) => <option key={r.id} value={r.name} />)}
                    </datalist>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.purchase-date">Purchase Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="installDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.install-date">Install Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchasePrice" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.purchase-price">Purchase Price</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="2499" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="replacementCost" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.replacement-cost">Replacement Cost</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" placeholder="2800" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="expectedLifeYears" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.expected-life">Expected Life (years)</FormLabel>
                  <FormControl><Input type="number" step="1" min="1" max="100" placeholder="15" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="valueClass" render={({ field }) => (
                <FormItem>
                  <FormLabel help="equipment.counts-as">Counts As</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(v: string) => (v === DEFAULT_CLASS ? `Default (${valueClassLabel(defaultValueClass(selectedCategory))})` : valueClassLabel(v as ValueClass))}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={DEFAULT_CLASS}>{`Default (${valueClassLabel(defaultValueClass(selectedCategory))})`}</SelectItem>
                      {VALUE_CLASSES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="equipment.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {!equipment && <AddRemindersSubmit pending={form.formState.isSubmitting} onClick={form.handleSubmit((v) => onSubmit(v, "reminders"))} />}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : equipment ? "Save Changes" : "Add Equipment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
