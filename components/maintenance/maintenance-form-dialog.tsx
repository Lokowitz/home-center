"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useDropTarget } from "@/components/drop/drop-provider"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createMaintenanceSchedule, suggestManualPage, updateMaintenanceSchedule } from "@/lib/actions/maintenance"
import { deleteAttachment } from "@/lib/actions/attachments"
import { ASSET_TYPES } from "@/lib/assets"
import { useFormat } from "@/components/regional-provider"
import { formatDueMonths, monthsMissing, parseDueMonths, scheduleKind } from "@/lib/maintenance-schedule"
import { intervalDays, intervalMiles, meterReading, moneyAmount, nameText, numberText, fieldIssue, optionalDateText } from "@/lib/input-limits"
import { showServerError } from "@/components/forms/server-errors"
import { manualChoices, type ManualOption } from "@/lib/manual-reference"
import { RoomSelect } from "@/components/rooms/room-select"
import type { RoomOption } from "@/lib/rooms-server"
import { Paperclip, Upload, X, Trash2, FileText, Image } from "lucide-react"
import type { Attachment, MaintenanceSchedule, MeterUnit, AssetType } from "@/app/generated/prisma/client"

const schema = z.object({
  assetId: z.string(),
  assetType: z.enum(ASSET_TYPES),
  title: nameText("Title is required"),
  description: z.string().optional(),
  intervalDays: z.string().optional(),
  intervalMiles: z.string().optional(),
  repeat: z.enum(["every", "months", "once"]),
  dueMonths: z.string().optional(),
  dueDay: z.string().optional(),
  estimatedCost: numberText(moneyAmount()),
  nextDueDate: optionalDateText,
  nextDueMileage: numberText(meterReading()),
  reminderDaysBefore: numberText(intervalDays()),
  reminderMilesBefore: numberText(intervalMiles()),
  roomId: z.string().optional(),
  referenceAttachmentId: z.string().optional(),
  referencePage: z.string().optional(),
}).superRefine((v, ctx) => {
  // The intervals are only sent (and only shown) for "Every"; miles only on a vehicle.
  if (v.repeat !== "every") return
  for (const [path, number] of [["intervalDays", intervalDays()], ["intervalMiles", v.assetType === "VEHICLE" ? intervalMiles() : null]] as const) {
    const message = number && fieldIssue(number, v[path])
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
  }
})

type FormValues = z.infer<typeof schema>

// The fields that show their own message; an error on any other (the room, months or manual) is toasted.
const SHOWN_FIELDS = ["title", "description", "intervalDays", "intervalMiles", "dueDay", "estimatedCost", "nextDueDate", "nextDueMileage", "reminderDaysBefore", "reminderMilesBefore", "referencePage"]

/** Starting values for a new reminder, such as the one "Plan replacement" prefills. */
export type MaintenanceFormDefaults = Partial<Pick<FormValues, "title" | "repeat" | "nextDueDate" | "estimatedCost">>

// Base UI Select has no empty option, so "None" is a sentinel mapped to "".
const NO_MANUAL = "__none__"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const INTERVAL_PRESETS = [
  { label: "Monthly", days: 30 },
  { label: "Quarterly", days: 91 },
  { label: "Twice a year", days: 182 },
  { label: "Yearly", days: 365 },
]
const REPEAT_OPTIONS = [
  { value: "every", label: "Every" },
  { value: "months", label: "On set months" },
  { value: "once", label: "Once" },
] as const

interface Props {
  open: boolean
  onClose: () => void
  assetId: string
  assetType: AssetType
  schedule?: MaintenanceSchedule | null
  attachments?: Attachment[]
  onAttachmentDeleted?: (scheduleId: string, attachmentId: string) => void
  /** When set (property view), shows a target picker: this property or one of its equipment. */
  equipmentOptions?: { id: string; name: string; roomId: string | null }[]
  propertyName?: string
  /** Rooms of the target's property. Empty or missing hides the room select. */
  roomOptions?: RoomOption[]
  /** A new schedule's room (on an equipment page: the equipment's own). */
  defaultRoomId?: string | null
  /** Vehicle's odometer unit, for the mileage field labels. Defaults to miles. */
  meterUnit?: MeterUnit
  /** A new schedule's starting values. Pass a stable object (state or memo): a new object resets the form. */
  defaults?: MaintenanceFormDefaults
  /** Files a reminder may link as its manual. Missing hides the Manual row and keeps an edited reminder's stored link. */
  manualOptions?: ManualOption[]
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

export function MaintenanceFormDialog({ open, onClose, assetId, assetType, schedule, attachments: initialAttachments = [], onAttachmentDeleted, equipmentOptions, propertyName = "This property", roomOptions = [], defaultRoomId, meterUnit = "MILES", defaults, manualOptions }: Props) {
  const fmt = useFormat()
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [createdScheduleId, setCreatedScheduleId] = useState<string | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [finding, setFinding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

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
    defaultValues: { assetId, assetType, title: "", description: "", intervalDays: "", intervalMiles: "", repeat: "every", dueMonths: "", dueDay: "", estimatedCost: "", nextDueDate: "", nextDueMileage: "", reminderDaysBefore: "14", reminderMilesBefore: "500", roomId: defaultRoomId ?? "", referenceAttachmentId: "", referencePage: "" },
  })

  const [repeat, dueMonthsValue] = useWatch({ control: form.control, name: ["repeat", "dueMonths"] })
  const selectedMonths = parseDueMonths(dueMonthsValue)
  const [targetType, targetId, pickedManual, titleValue] = useWatch({ control: form.control, name: ["assetType", "assetId", "referenceAttachmentId", "title"] })
  // A stored file that isn't a choice any more (deleted, or the reminder moved to another asset) reads as None.
  const choices = manualChoices(manualOptions ?? [], { assetType: targetType, assetId: targetId }, schedule?.id ?? createdScheduleId)
  const pickedChoice = choices.find((c) => c.id === pickedManual)

  // A room that isn't one of the options (the equipment moved property since) would only fail to save, so it opens as None.
  const roomKey = roomOptions.map((r) => r.id).join(" ")
  useEffect(() => {
    form.reset(schedule ? {
      assetId: schedule.assetId, assetType: schedule.assetType,
      title: schedule.title,
      description: schedule.description ?? "",
      intervalDays: schedule.intervalDays?.toString() ?? "",
      intervalMiles: schedule.intervalMiles?.toString() ?? "",
      repeat: ({ interval: "every", calendar: "months", once: "once" } as const)[scheduleKind(schedule)],
      dueMonths: schedule.dueMonths ?? "",
      dueDay: schedule.dueDay?.toString() ?? "",
      estimatedCost: schedule.estimatedCost?.toString() ?? "",
      nextDueDate: schedule.nextDueDate ? new Date(schedule.nextDueDate).toISOString().split("T")[0] : "",
      nextDueMileage: schedule.nextDueMileage?.toString() ?? "",
      reminderDaysBefore: schedule.reminderDaysBefore.toString(),
      reminderMilesBefore: schedule.reminderMilesBefore.toString(),
      roomId: schedule.roomId && roomKey.split(" ").includes(schedule.roomId) ? schedule.roomId : "",
      referenceAttachmentId: schedule.referenceAttachmentId ?? "",
      referencePage: schedule.referencePage?.toString() ?? "",
    } : {
      assetId, assetType, title: "", description: "", intervalDays: "", intervalMiles: "", repeat: "every", dueMonths: "", dueDay: "", estimatedCost: "", nextDueDate: "", nextDueMileage: "", reminderDaysBefore: "14", reminderMilesBefore: "500", roomId: defaultRoomId ?? "", referenceAttachmentId: "", referencePage: "",
      ...defaults,
    })
  }, [schedule, open, form, assetId, assetType, defaultRoomId, roomKey, defaults])

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
    if (!schedule) return
    const result = await deleteAttachment(attachment.id)
    if (result?.error) { toast.error(result.error); return }
    setRemovedIds((prev) => new Set(prev).add(attachment.id))
    if (form.getValues("referenceAttachmentId") === attachment.id) {
      form.setValue("referenceAttachmentId", "", { shouldDirty: true })
      form.setValue("referencePage", "", { shouldDirty: true })
    }
    onAttachmentDeleted?.(schedule.id, attachment.id)
    toast.success("Attachment removed.")
  }

  async function findPage() {
    if (!pickedChoice) return
    setFinding(true)
    try {
      const result = await suggestManualPage({
        attachmentId: pickedChoice.id,
        assetType: targetType,
        assetId: targetId,
        scheduleId: schedule?.id ?? createdScheduleId,
        title: titleValue,
      })
      if ("error" in result) toast.error("Couldn't search this file.")
      else if (result.page == null) toast.message("No page mentions this title. Type the page instead.")
      else {
        form.setValue("referencePage", String(result.page), { shouldDirty: true })
        toast.success(`Found on page ${result.page}.`)
      }
    } finally {
      setFinding(false)
    }
  }

  async function onSubmit(values: FormValues) {
    const { repeat: chosenRepeat, ...rest } = values
    if (monthsMissing(chosenRepeat, values.dueMonths)) {
      toast.error("Pick at least one month, or choose a different repeat.")
      return
    }
    const payload = {
      ...rest,
      // Only the chosen kind of repeat is sent; the others are cleared so an edit can switch kinds.
      intervalDays: chosenRepeat === "every" ? values.intervalDays : "",
      intervalMiles: chosenRepeat === "every" ? values.intervalMiles : "",
      dueMonths: chosenRepeat === "months" ? values.dueMonths : "",
      dueDay: chosenRepeat === "months" ? values.dueDay : "",
      // No room select shown: send nothing, so an edit keeps the schedule's room.
      roomId: roomOptions.length > 0 ? values.roomId : undefined,
      // Same for the manual: with no Manual row offered, an edit keeps the stored link.
      referenceAttachmentId: manualOptions ? (pickedChoice ? values.referenceAttachmentId : "") : undefined,
      referencePage: manualOptions ? (pickedChoice ? values.referencePage : "") : undefined,
    } as unknown as Parameters<typeof createMaintenanceSchedule>[0]
    const existingId = schedule?.id ?? createdScheduleId
    const result = existingId
      ? await updateMaintenanceSchedule(existingId, payload)
      : await createMaintenanceSchedule(payload)

    if (result?.error) {
      showServerError(form, result.error, SHOWN_FIELDS)
      return
    }

    const scheduleId = existingId ?? (result as { success: boolean; id?: string }).id
    if (scheduleId && !existingId) setCreatedScheduleId(scheduleId)

    if (stagedFiles.length > 0 && scheduleId) {
      const uploads = await Promise.allSettled(
        stagedFiles.map(async (file) => {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("recordId", scheduleId)
          formData.append("recordType", "MAINTENANCE")
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
      router.refresh()
    }

    toast.success(schedule ? "Schedule updated." : "Maintenance schedule added.")
    handleClose()
  }

  function handleClose() {
    setStagedFiles([])
    setRemovedIds(new Set())
    setCreatedScheduleId(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()} disablePointerDismissal={filePickerOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schedule ? "Edit Schedule" : "Add Maintenance Schedule"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {equipmentOptions && equipmentOptions.length > 0 && (
              <FormItem>
                <FormLabel help="reminder.for">For</FormLabel>
                <Select
                  value={targetKey(form.watch("assetType"), form.watch("assetId"))}
                  onValueChange={(value) => {
                    if (!value) return
                    const [type, ...rest] = value.split(":")
                    form.setValue("assetType", type as FormValues["assetType"])
                    form.setValue("assetId", rest.join(":"))
                    // Equipment with a room fills a blank room; a chosen room stays.
                    const equipmentRoom = type === "EQUIPMENT" ? equipmentOptions.find((e) => e.id === rest.join(":"))?.roomId : null
                    if (equipmentRoom && !form.getValues("roomId")) form.setValue("roomId", equipmentRoom)
                    // A manual filed on the old target can't follow the reminder to the new one.
                    form.setValue("referenceAttachmentId", "")
                    form.setValue("referencePage", "")
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

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="reminder.title">Title *</FormLabel>
                  <FormControl><Input placeholder="Oil Change" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="col-span-2 space-y-2">
                <FormLabel help="reminder.repeat">Repeats</FormLabel>
                <div role="group" aria-label="Repeats" className="flex flex-wrap gap-2">
                  {REPEAT_OPTIONS.map((o) => (
                    <Button
                      key={o.value}
                      type="button"
                      size="sm"
                      variant={repeat === o.value ? "default" : "outline"}
                      aria-pressed={repeat === o.value}
                      onClick={() => form.setValue("repeat", o.value, { shouldDirty: true })}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </div>

              {repeat === "every" && (
                <>
                  <FormField control={form.control} name="intervalDays" render={({ field }) => (
                    <FormItem>
                      <FormLabel help="reminder.interval-days">Repeat Every (days)</FormLabel>
                      <FormControl><Input type="number" placeholder="90" {...field} /></FormControl>
                      <FormDescription className="text-xs">
                        {INTERVAL_PRESETS.map((p, i) => (
                          <span key={p.days}>
                            {i > 0 && " · "}
                            <button type="button" className="underline hover:text-foreground" onClick={() => form.setValue("intervalDays", String(p.days), { shouldDirty: true })}>
                              {p.label}
                            </button>
                          </span>
                        ))}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {assetType === "VEHICLE" && (
                    <FormField control={form.control} name="intervalMiles" render={({ field }) => (
                      <FormItem>
                        <FormLabel help="reminder.interval-miles">Repeat Every ({fmt.meterShort(meterUnit)})</FormLabel>
                        <FormControl><Input type="number" placeholder={meterUnit === "HOURS" ? "50" : "5000"} {...field} /></FormControl>
                        <FormDescription className="text-xs">{meterUnit === "HOURS" ? "e.g. 50 for an oil change" : "e.g. 5000 for oil change"}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </>
              )}

              {repeat === "months" && (
                <>
                  <div className="col-span-2 space-y-2">
                    <FormLabel help="reminder.months">Months</FormLabel>
                    <div role="group" aria-label="Months" className="grid grid-cols-6 gap-1.5">
                      {MONTHS.map((name, i) => {
                        const on = selectedMonths.includes(i + 1)
                        return (
                          <Button
                            key={name}
                            type="button"
                            size="sm"
                            variant={on ? "default" : "outline"}
                            aria-pressed={on}
                            onClick={() =>
                              form.setValue(
                                "dueMonths",
                                formatDueMonths(on ? selectedMonths.filter((m) => m !== i + 1) : [...selectedMonths, i + 1]) ?? "",
                                { shouldDirty: true }
                              )
                            }
                          >
                            {name}
                          </Button>
                        )
                      })}
                    </div>
                    {selectedMonths.length === 0 && <p className="text-xs text-muted-foreground">Pick at least one month.</p>}
                  </div>
                  <FormField control={form.control} name="dueDay" render={({ field }) => (
                    <FormItem>
                      <FormLabel help="reminder.due-day">Day of month</FormLabel>
                      <FormControl><Input type="number" min={1} max={28} placeholder="1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}

              <FormField control={form.control} name="estimatedCost" render={({ field }) => (
                <FormItem>
                  <FormLabel help="reminder.estimated-cost">{`Estimated cost (${fmt.currencySymbol})`}</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" placeholder="150" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="nextDueDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="reminder.next-due-date">Next Due Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {assetType === "VEHICLE" && (
                <FormField control={form.control} name="nextDueMileage" render={({ field }) => (
                  <FormItem>
                    <FormLabel help="reminder.next-due-mileage">Next Due {fmt.meterNoun(meterUnit)}</FormLabel>
                    <FormControl><Input type="number" placeholder={meterUnit === "HOURS" ? "1300" : "50000"} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="reminderDaysBefore" render={({ field }) => (
                <FormItem>
                  <FormLabel help="reminder.remind-days">Remind (days before)</FormLabel>
                  <FormControl><Input type="number" placeholder="14" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {assetType === "VEHICLE" && (
                <FormField control={form.control} name="reminderMilesBefore" render={({ field }) => (
                  <FormItem>
                    <FormLabel help="reminder.remind-miles">Remind ({fmt.meterShort(meterUnit)} before)</FormLabel>
                    <FormControl><Input type="number" placeholder={meterUnit === "HOURS" ? "10" : "500"} {...field} /></FormControl>
                    <FormDescription className="text-xs">How close to the due {meterUnit === "HOURS" ? "hour count" : fmt.distanceNoun.toLowerCase()} to start warning</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {choices.length > 0 && (
                <div className="col-span-2 space-y-2">
                  <FormLabel help="reminder.manual">Manual</FormLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={pickedChoice ? pickedChoice.id : NO_MANUAL}
                      onValueChange={(value) => {
                        if (!value) return
                        const none = value === NO_MANUAL
                        form.setValue("referenceAttachmentId", none ? "" : value, { shouldDirty: true })
                        if (none) form.setValue("referencePage", "", { shouldDirty: true })
                      }}
                    >
                      <SelectTrigger className="min-w-0 flex-1" aria-label="Manual">
                        <SelectValue>
                          {(v: string) => (v === NO_MANUAL ? "None" : choices.find((c) => c.id === v)?.name ?? "None")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_MANUAL}>None</SelectItem>
                        {choices.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {pickedChoice && (
                      <>
                        <FormField control={form.control} name="referencePage" render={({ field }) => (
                          <Input type="number" min={1} max={9999} step={1} placeholder="42" aria-label="Page" className="w-24" {...field} />
                        )} />
                        {pickedChoice.hasText && (
                          <Button type="button" variant="outline" size="sm" onClick={findPage} disabled={finding || !titleValue.trim()}>
                            {finding ? "Searching…" : "Find page"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="reminder.notes">Notes</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
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
                    const href = `/api/files/maintenance/${schedule?.id}/${a.filename}`
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
                {form.formState.isSubmitting ? "Saving…" : schedule ? "Save Changes" : "Add Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
