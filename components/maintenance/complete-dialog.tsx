"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDropTarget } from "@/components/drop/drop-provider"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { completeMaintenanceSchedule } from "@/lib/actions/maintenance"
import { uploadAll } from "@/lib/upload-client"
import type { MaintenanceSchedule, MeterUnit } from "@/app/generated/prisma/client"
import { useFormat } from "@/components/regional-provider"
import { localDay } from "@/lib/equipment-life"
import { ManualLink, type ManualLinkTarget } from "./manual-link"
import { showServerError } from "@/components/forms/server-errors"

/** Marks a reminder done and, unless unticked, logs it in the service history. */
export function CompleteDialog({ schedule, currentMileage, meterUnit, manual, onClose }: {
  schedule: MaintenanceSchedule
  currentMileage?: number | null
  meterUnit: MeterUnit
  /** The reminder's manual link, when the caller has loaded it. */
  manual?: ManualLinkTarget
  onClose: () => void
}) {
  const router = useRouter()
  const fmt = useFormat()
  const [files, setFiles] = useState<File[]>([])
  const form = useForm({
    defaultValues: {
      completedDate: localDay(new Date()).toISOString().split("T")[0],
      completedMileage: schedule.assetType === "VEHICLE" ? currentMileage?.toString() ?? "" : "",
      logService: true,
      vendor: "",
      cost: "",
      notes: "",
    },
  })
  const { register, handleSubmit, watch, formState: { isSubmitting, errors } } = form
  const logService = watch("logService")
  const isPerson = schedule.assetType === "PERSON"

  // Files go on the service record this logs, so they're only taken while it's ticked.
  useDropTarget({
    label: "Add to this record's files",
    onFiles: (dropped) => setFiles((prev) => [...prev, ...dropped]),
    enabled: logService,
  })

  async function onSubmit(values: { completedDate: string; completedMileage: string; logService: boolean; vendor: string; cost: string; notes: string }) {
    // Vendor and cost are hidden while the work isn't logged, so a leftover value mustn't be checked.
    const sent = values.logService ? values : { ...values, vendor: "", cost: "" }
    const result = await completeMaintenanceSchedule(schedule.id, sent as Parameters<typeof completeMaintenanceSchedule>[1])
    if (!result) { toast.error("Something went wrong."); return }
    if (result.error) { showServerError(form, result.error); return }

    // The receipt goes on the service record the completion just logged.
    const recordId = result.serviceRecordId
    const failed = recordId && files.length > 0 ? await uploadAll(files, "SERVICE", recordId) : null
    if (failed) toast.error(`Marked complete, but a file didn't upload: ${failed}`)
    else toast.success(recordId ? `"${schedule.title}" marked complete and logged.` : `"${schedule.title}" marked complete.`)
    router.refresh()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Complete: {schedule.title}</DialogTitle>
        </DialogHeader>
        <ManualLink manual={manual} />
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="complete-date" help="complete.date">Completion Date</Label>
              <Input id="complete-date" type="date" {...register("completedDate")} />
              {errors.completedDate && <p className="text-xs text-destructive">{errors.completedDate.message}</p>}
            </div>
            {schedule.assetType === "VEHICLE" && (
              <div className="space-y-1.5">
                <Label htmlFor="complete-mileage" help="complete.mileage">{fmt.meterNoun(meterUnit)} at Completion</Label>
                <Input id="complete-mileage" type="number" placeholder={meterUnit === "HOURS" ? "1250" : "45230"} {...register("completedMileage")} />
                {errors.completedMileage && <p className="text-xs text-destructive">{errors.completedMileage.message}</p>}
              </div>
            )}
          </div>

          <Label help="complete.log">
            <input type="checkbox" className="h-4 w-4 accent-primary" {...register("logService")} />
            {isPerson ? "Add to visits" : "Add to service history"}
          </Label>

          {logService && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="complete-vendor" help="complete.vendor">{isPerson ? "Facility" : "Vendor / Shop"}</Label>
                <Input id="complete-vendor" placeholder={isPerson ? "City Medical Center" : "Jiffy Lube"} {...register("vendor")} />
                {errors.vendor && <p className="text-xs text-destructive">{errors.vendor.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="complete-cost" help="complete.cost">{`Cost (${fmt.currencySymbol})`}</Label>
                <Input id="complete-cost" type="number" step="0.01" min="0" placeholder={schedule.estimatedCost != null ? `Est. ${fmt.money(schedule.estimatedCost)}` : "89.99"} {...register("cost")} />
                {errors.cost && <p className="text-xs text-destructive">{errors.cost.message}</p>}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="complete-notes" help="complete.notes">Notes</Label>
                <Textarea id="complete-notes" rows={2} {...register("notes")} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="complete-files" help="complete.files">Receipt or photos</Label>
                <Input
                  id="complete-files"
                  type="file"
                  multiple
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? [])
                    setFiles((prev) => [...prev, ...picked])
                    // Cleared so the list below is the one record of what's chosen.
                    e.target.value = ""
                  }}
                />
                {files.length > 0 && (
                  <ul className="space-y-1">
                    {files.map((file, index) => (
                      <li key={index} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                        <span className="flex-1 truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                          aria-label={`Remove "${file.name}"`}
                          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Mark Complete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
