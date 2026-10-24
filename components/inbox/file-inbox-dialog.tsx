"use client"

import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AssetSelect, type InboxAssetOption, type InboxReminderOption } from "@/components/inbox/asset-select"
import { fileInboxItem } from "@/lib/actions/inbox"
import { SERVICE_CATEGORIES, categoriesFor } from "@/lib/costs"
import { BellRing } from "lucide-react"
import { matchingReminder } from "@/lib/maintenance-match"
import { NO_CATEGORY, fieldErrorTarget, fileFormPayload, parseAssetKey, type FileFormValues } from "@/lib/inbox-form"
// Type only: service-record-server reaches Prisma.
import type { ServiceRecordInput } from "@/lib/service-record-server"
import { useFormat } from "@/components/regional-provider"

const NO_LINK = "__none__"

const schema = z.object({
  assetKey: z.string().min(1, "Choose what this is for"),
  date: z.string().min(1, "Date is required"),
  title: z.string().min(1, "Title is required"),
  vendor: z.string(),
  cost: z.string(),
  category: z.string(),
  mileageAtService: z.string(),
  scheduleId: z.string(),
  description: z.string(),
}) satisfies z.ZodType<FileFormValues>

/** "File it": turns an inbox item into a service record, prefilled from what was read. Mounted only while open. */
export function FileInboxDialog({
  itemId,
  fileName,
  defaults,
  assets,
  reminders,
  reminderMatches = {},
  onClose,
}: {
  itemId: string
  fileName: string
  defaults: FileFormValues
  assets: InboxAssetOption[]
  reminders: InboxReminderOption[]
  /** Per asset key, the reminder the receipt's text reads as. */
  reminderMatches?: Record<string, string>
  onClose: () => void
}) {
  const router = useRouter()
  const fmt = useFormat()
  const form = useForm<FileFormValues>({ resolver: zodResolver(schema), defaultValues: defaults })

  const key = useWatch({ control: form.control, name: "assetKey" })
  const asset = parseAssetKey(key)
  const chosen = asset ? assets.find((a) => a.type === asset.assetType && a.id === asset.assetId) : undefined
  const assetReminders = asset ? reminders.filter((r) => r.assetType === asset.assetType && r.assetId === asset.assetId) : []
  // What the title says wins over what the receipt says; either is only offered, never picked.
  const title = useWatch({ control: form.control, name: "title" })
  const scheduleId = useWatch({ control: form.control, name: "scheduleId" })
  const suggested = scheduleId
    ? null
    : matchingReminder(title ?? "", assetReminders) ?? assetReminders.find((r) => r.id === reminderMatches[key]) ?? null
  const isPerson = asset?.assetType === "PERSON"

  async function onSubmit(values: FileFormValues) {
    // Strings throughout: the server's schema coerces cost and mileage, as for the record form.
    const result = await fileInboxItem(itemId, fileFormPayload(values) as unknown as ServiceRecordInput)
    if ("error" in result) {
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        const target = fieldErrorTarget(field)
        if (target && messages?.[0]) form.setError(target, { message: messages[0] })
      }
      toast.error(result.error)
      return
    }
    const completed = values.scheduleId ? assetReminders.find((r) => r.id === values.scheduleId) : undefined
    toast.success(completed ? `Filed. "${completed.title}" marked complete.` : `Filed "${values.title}".`, {
      action: { label: "View", onClick: () => router.push(result.href) },
    })
    onClose()
    router.refresh()
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isPerson ? "File as a visit" : "File as a service record"}</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="assetKey" render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel help="inbox.asset">For *</FormLabel>
                <AssetSelect
                  assets={assets}
                  value={field.value}
                  invalid={!!fieldState.error}
                  onChange={(key) => {
                    field.onChange(key)
                    // A reminder and a category belong to the old asset's kind.
                    form.setValue("scheduleId", "")
                    form.setValue("category", NO_CATEGORY)
                  }}
                />
                <FormMessage />
              </FormItem>
            )} />

            {assetReminders.length > 0 && (
              <FormField control={form.control} name="scheduleId" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.completes-reminder">Completes reminder</FormLabel>
                  <Select
                    value={field.value || NO_LINK}
                    onValueChange={(v) => {
                      const id = !v || v === NO_LINK ? "" : v
                      field.onChange(id)
                      const reminder = assetReminders.find((r) => r.id === id)
                      if (reminder && !form.getValues("title")) form.setValue("title", reminder.title)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v: string) => assetReminders.find((r) => r.id === v)?.title ?? "None"}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>None</SelectItem>
                      {assetReminders.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {suggested && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
                      <BellRing className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span>Looks like the reminder &ldquo;{suggested.title}&rdquo;.</span>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => form.setValue("scheduleId", suggested.id, { shouldDirty: true })}
                      >
                        Mark it complete
                      </Button>
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel help="service.title">Title *</FormLabel>
                  <FormControl><Input placeholder={isPerson ? "Annual physical" : "Oil Change"} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.date">Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="cost" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.cost">{`Cost (${fmt.currencySymbol})`}</FormLabel>
                  <FormControl><Input type="number" step="0.01" inputMode="decimal" placeholder="89.99" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="vendor" render={({ field }) => (
                <FormItem>
                  {isPerson ? <FormLabel help="service.facility">Facility</FormLabel> : <FormLabel help="service.vendor">Vendor / Shop</FormLabel>}
                  <FormControl><Input placeholder={isPerson ? "City Medical Center" : "Jiffy Lube"} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.category">Category</FormLabel>
                  <Select value={field.value} onValueChange={(v) => field.onChange(v ?? NO_CATEGORY)}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Uncategorized">
                          {(v: string) => SERVICE_CATEGORIES.find((c) => c.value === v)?.label ?? "Uncategorized"}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>Uncategorized</SelectItem>
                      {categoriesFor(asset?.assetType ?? "PROPERTY").map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {asset?.assetType === "VEHICLE" && (
                <FormField control={form.control} name="mileageAtService" render={({ field }) => (
                  <FormItem>
                    <FormLabel help="service.mileage">{fmt.meterNoun(chosen?.meterUnit ?? "MILES")} at Service</FormLabel>
                    <FormControl><Input type="number" inputMode="numeric" placeholder={chosen?.meterUnit === "HOURS" ? "1250" : "45230"} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel help="service.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Filing…" : "File it"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
