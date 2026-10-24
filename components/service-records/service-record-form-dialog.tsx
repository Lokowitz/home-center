"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useDropTarget } from "@/components/drop/drop-provider"
import { maybeShowReceiptTip } from "@/components/tips/record-receipt-tip"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createServiceRecord, updateServiceRecord } from "@/lib/actions/service-records"
import { deleteAttachment } from "@/lib/actions/attachments"
import { matchingReminder } from "@/lib/maintenance-match"
import { SERVICE_CATEGORIES, categoriesFor } from "@/lib/costs"
import { ASSET_TYPES } from "@/lib/assets"
import { BellRing, Paperclip, Upload, X, Trash2, FileText, Image } from "lucide-react"
import type { Attachment, ServiceRecord, MeterUnit, AssetType } from "@/app/generated/prisma/client"
import { useFormat } from "@/components/regional-provider"
import { RoomSelect } from "@/components/rooms/room-select"
import type { RoomOption } from "@/lib/rooms-server"

// Base UI Select has no empty-string option, so "no category" needs a sentinel.
const NO_CATEGORY = "__none__"
const NO_LINK = "__none__"

const schema = z.object({
  assetId: z.string(),
  assetType: z.enum(ASSET_TYPES),
  date: z.string().min(1, "Date is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  vendor: z.string().optional(),
  cost: z.string().optional(),
  category: z.string().optional(),
  mileageAtService: z.string().optional(),
  providerId: z.string().optional(),
  conditionId: z.string().optional(),
  roomId: z.string().optional(),
  scheduleId: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  assetId: string
  assetType: AssetType
  record?: ServiceRecord | null
  attachments?: Attachment[]
  onAttachmentDeleted?: (recordId: string, attachmentId: string) => void
  /** When set (property view), shows a target picker: this property or one of its equipment. */
  equipmentOptions?: { id: string; name: string; roomId: string | null }[]
  propertyName?: string
  /** Rooms of the target's property. Empty or missing hides the room select. */
  roomOptions?: RoomOption[]
  /** A new record's room (on an equipment page: the equipment's own). */
  defaultRoomId?: string | null
  /** Vehicle's odometer unit, for the mileage field's label. Defaults to miles. */
  meterUnit?: MeterUnit
  /** People only: the provider directory and this person's conditions. */
  providerOptions?: { id: string; name: string }[]
  conditionOptions?: { id: string; name: string }[]
  /** Active reminders on this asset (and, on a property, its equipment). A new record can complete one. */
  reminderOptions?: { id: string; title: string; assetType: AssetType; assetId: string }[]
}

function targetKey(assetType: AssetType, assetId: string) {
  return `${assetType}:${assetId}`
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image
  return FileText
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ServiceRecordFormDialog({ open, onClose, assetId, assetType, record, attachments: initialAttachments = [], onAttachmentDeleted, equipmentOptions, propertyName = "This property", roomOptions = [], defaultRoomId, meterUnit = "MILES", providerOptions, conditionOptions, reminderOptions = [] }: Props) {
  const isPerson = assetType === "PERSON"
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const fmt = useFormat()

  function openFilePicker() {
    // The native OS file picker moves focus outside the dialog's DOM, which would
    // otherwise trigger Base UI's modal focus-out dismissal and close the dialog
    // before the file selection is even processed.
    setFilePickerOpen(true)
    window.addEventListener("focus", () => setFilePickerOpen(false), { once: true })
    inputRef.current?.click()
  }

  const existingAttachments = initialAttachments.filter((a) => !removedIds.has(a.id))

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      assetId, assetType,
      date: new Date().toISOString().split("T")[0],
      title: "", description: "", vendor: "", cost: "", category: NO_CATEGORY, mileageAtService: "",
      providerId: "", conditionId: "", roomId: defaultRoomId ?? "", scheduleId: "",
    },
  })

  const targetType = form.watch("assetType")
  const targetId = form.watch("assetId")
  const targetReminders = reminderOptions.filter((r) => r.assetType === targetType && r.assetId === targetId)
  // A new record whose title reads like an open reminder offers to complete it; never picked on its own.
  const titleValue = form.watch("title")
  const scheduleValue = form.watch("scheduleId")
  const suggested = !record && !createdRecordId && !scheduleValue ? matchingReminder(titleValue ?? "", targetReminders) : null

  // A room that isn't one of the options (the equipment moved property since) would only fail to save, so it opens as None.
  const roomKey = roomOptions.map((r) => r.id).join(" ")
  useEffect(() => {
    if (record) {
      form.reset({
        assetId: record.assetId, assetType: record.assetType,
        date: new Date(record.date).toISOString().split("T")[0],
        title: record.title,
        description: record.description ?? "",
        vendor: record.vendor ?? "",
        cost: record.cost?.toString() ?? "",
        category: record.category ?? NO_CATEGORY,
        mileageAtService: record.mileageAtService?.toString() ?? "",
        providerId: record.providerId ?? "",
        conditionId: record.conditionId ?? "",
        roomId: record.roomId && roomKey.split(" ").includes(record.roomId) ? record.roomId : "",
        scheduleId: "",
      })
    } else {
      form.reset({ assetId, assetType, date: new Date().toISOString().split("T")[0], title: "", description: "", vendor: "", cost: "", category: NO_CATEGORY, mileageAtService: "", providerId: "", conditionId: "", roomId: defaultRoomId ?? "", scheduleId: "" })
    }
  }, [record, open, form, assetId, assetType, defaultRoomId, roomKey])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    setStagedFiles((prev) => [...prev, ...Array.from(files)])
    if (inputRef.current) inputRef.current.value = ""
  }

  // A file dropped anywhere while this is open joins the files staged above.
  useDropTarget({
    label: "Add to this record's files",
    onFiles: (files) => setStagedFiles((prev) => [...prev, ...files]),
    enabled: open,
  })

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleDeleteExisting(attachment: Attachment) {
    if (!confirm(`Remove "${attachment.originalName}"?`)) return
    if (!record) return
    const result = await deleteAttachment(attachment.id)
    if (result?.error) { toast.error(result.error); return }
    setRemovedIds((prev) => new Set(prev).add(attachment.id))
    onAttachmentDeleted?.(record.id, attachment.id)
    toast.success("Attachment removed.")
  }

  async function onSubmit(values: FormValues) {
    const payload = {
      ...values,
      category: values.category === NO_CATEGORY ? "" : values.category,
      providerId: values.providerId === NO_LINK ? "" : values.providerId,
      conditionId: values.conditionId === NO_LINK ? "" : values.conditionId,
      // No room select shown: send nothing, so an edit keeps the record's room.
      roomId: roomOptions.length > 0 ? values.roomId : undefined,
      // Only a new record completes a reminder; the edit path ignores it.
      scheduleId: (record?.id ?? createdRecordId) ? "" : values.scheduleId,
    } as unknown as Parameters<typeof createServiceRecord>[0]
    const existingId = record?.id ?? createdRecordId
    const result = existingId
      ? await updateServiceRecord(existingId, payload)
      : await createServiceRecord(payload)

    if (result?.error) {
      const roomError = typeof result.error === "object" && "roomId" in result.error ? result.error.roomId?.[0] : undefined
      toast.error(roomError ?? "Please fix the errors and try again.")
      return
    }

    const recordId = existingId ?? (result as { success: boolean; id?: string }).id
    if (recordId && !existingId) setCreatedRecordId(recordId)

    if (stagedFiles.length > 0 && recordId) {
      const uploads = await Promise.allSettled(
        stagedFiles.map(async (file) => {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("recordId", recordId)
          formData.append("recordType", "SERVICE")
          const res = await fetch("/api/uploads", { method: "POST", body: formData })
          if (!res.ok) {
            const json = await res.json().catch(() => ({}))
            throw new Error(json.error ?? `Failed to upload "${file.name}"`)
          }
          return file
        })
      )

      const succeeded = new Set(
        uploads.flatMap((u) => (u.status === "fulfilled" ? [u.value] : []))
      )
      setStagedFiles((prev) => prev.filter((f) => !succeeded.has(f)))

      const firstFailure = uploads.find((u): u is PromiseRejectedResult => u.status === "rejected")
      if (firstFailure) {
        toast.error(firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some files failed to upload.")
        return
      }
    }

    const completed = !existingId && values.scheduleId ? reminderOptions.find((r) => r.id === values.scheduleId) : undefined
    toast.success(record ? "Record updated." : completed ? `Service record added. "${completed.title}" marked complete.` : isPerson ? "Visit added." : "Service record added.")
    // Saved without a receipt: once, point at dropping it on the page next time.
    maybeShowReceiptTip(stagedFiles.length > 0, { isNew: !existingId })
    router.refresh()
    handleClose()
  }

  function handleClose() {
    setStagedFiles([])
    setRemovedIds(new Set())
    setCreatedRecordId(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()} disablePointerDismissal={filePickerOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{record ? (isPerson ? "Edit Visit" : "Edit Service Record") : (isPerson ? "Add Visit / Expense" : "Add Service Record")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {equipmentOptions && equipmentOptions.length > 0 && (
              <FormItem>
                <FormLabel help="service.target">For</FormLabel>
                <Select
                  value={targetKey(form.watch("assetType"), form.watch("assetId"))}
                  onValueChange={(value) => {
                    if (!value) return
                    const [type, ...rest] = value.split(":")
                    form.setValue("assetType", type as FormValues["assetType"])
                    form.setValue("assetId", rest.join(":"))
                    form.setValue("scheduleId", "")
                    // Equipment with a room fills a blank room; a chosen room stays.
                    const equipmentRoom = type === "EQUIPMENT" ? equipmentOptions.find((e) => e.id === rest.join(":"))?.roomId : null
                    if (equipmentRoom && !form.getValues("roomId")) form.setValue("roomId", equipmentRoom)
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) => v === targetKey("PROPERTY", assetId) ? propertyName : equipmentOptions.find((e) => targetKey("EQUIPMENT", e.id) === v)?.name ?? v}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={targetKey("PROPERTY", assetId)}>{propertyName}</SelectItem>
                    {equipmentOptions.map((e) => (
                      <SelectItem key={e.id} value={targetKey("EQUIPMENT", e.id)}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}

            <RoomSelect value={form.watch("roomId") ?? ""} onChange={(v) => form.setValue("roomId", v)} options={roomOptions} />

            {!record && targetReminders.length > 0 && (
              <FormField control={form.control} name="scheduleId" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.completes-reminder">Completes reminder</FormLabel>
                  <Select
                    value={field.value || NO_LINK}
                    onValueChange={(v) => {
                      const id = !v || v === NO_LINK ? "" : v
                      field.onChange(id)
                      const reminder = targetReminders.find((r) => r.id === id)
                      if (reminder && !form.getValues("title")) form.setValue("title", reminder.title)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v: string) => targetReminders.find((r) => r.id === v)?.title ?? "None"}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>None</SelectItem>
                      {targetReminders.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.date">Date *</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="service.title">Title *</FormLabel>
                  <FormControl><Input placeholder={isPerson ? "Annual physical" : "Oil Change"} {...field} /></FormControl>
                  <FormMessage />
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
                </FormItem>
              )} />

              <FormField control={form.control} name="vendor" render={({ field }) => (
                <FormItem>
                  {isPerson ? <FormLabel help="service.facility">Facility</FormLabel> : <FormLabel help="service.vendor">Vendor / Shop</FormLabel>}
                  <FormControl><Input placeholder={isPerson ? "City Medical Center" : "Jiffy Lube"} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="cost" render={({ field }) => (
                <FormItem>
                  <FormLabel help="service.cost">{`Cost (${fmt.currencySymbol})`}</FormLabel>
                  <FormControl><Input type="number" step="0.01" placeholder="89.99" {...field} /></FormControl>
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
                      {categoriesFor(assetType).map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {providerOptions && (
                <FormField control={form.control} name="providerId" render={({ field }) => (
                  <FormItem>
                    <FormLabel help="service.provider">Provider</FormLabel>
                    <Select value={field.value || NO_LINK} onValueChange={(v) => field.onChange(!v || v === NO_LINK ? "" : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>{(v: string) => providerOptions.find((p) => p.id === v)?.name ?? "None"}</SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_LINK}>None</SelectItem>
                        {providerOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              )}

              {conditionOptions && conditionOptions.length > 0 && (
                <FormField control={form.control} name="conditionId" render={({ field }) => (
                  <FormItem>
                    <FormLabel help="service.condition">For condition</FormLabel>
                    <Select value={field.value || NO_LINK} onValueChange={(v) => field.onChange(!v || v === NO_LINK ? "" : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>{(v: string) => conditionOptions.find((c) => c.id === v)?.name ?? "None"}</SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_LINK}>None</SelectItem>
                        {conditionOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              )}

              {assetType === "VEHICLE" && (
                <FormField control={form.control} name="mileageAtService" render={({ field }) => (
                  <FormItem>
                    <FormLabel help="service.mileage">{fmt.meterNoun(meterUnit)} at Service</FormLabel>
                    <FormControl><Input type="number" placeholder={meterUnit === "HOURS" ? "1250" : "45230"} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="service.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  Attachments {(existingAttachments.length + stagedFiles.length) > 0 && <span className="inline-flex items-center justify-center rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium">{existingAttachments.length + stagedFiles.length}</span>}
                </div>
                <label>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openFilePicker}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    Attach file
                  </Button>
                </label>
              </div>

              {existingAttachments.length > 0 && (
                <ul className="space-y-1">
                  {existingAttachments.map((a) => {
                    const Icon = fileIcon(a.mimeType)
                    const href = `/api/files/service/${record?.id}/${a.filename}`
                    return (
                      <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 truncate hover:underline"
                        >
                          {a.originalName}
                        </a>
                        <span className="text-xs text-muted-foreground shrink-0">{formatBytes(a.sizeBytes)}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteExisting(a)}
                          aria-label={`Remove "${a.originalName}"`}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {stagedFiles.length > 0 && (
                <ul className="space-y-1">
                  {stagedFiles.map((file, index) => {
                    const Icon = fileIcon(file.type)
                    return (
                      <li key={index} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                        <button
                          type="button"
                          onClick={() => removeStagedFile(index)}
                          aria-label={`Remove "${file.name}"`}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : record ? "Save Changes" : "Add Record"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
