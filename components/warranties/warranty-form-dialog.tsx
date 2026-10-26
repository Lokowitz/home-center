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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createWarranty, updateWarranty } from "@/lib/actions/warranties"
import { deleteAttachment } from "@/lib/actions/attachments"
import { warrantySchema as schema } from "@/lib/warranty-input"
import { showServerError } from "@/components/forms/server-errors"
import { Paperclip, Upload, X, Trash2, FileText, Image } from "lucide-react"
import type { Attachment, Warranty, AssetType } from "@/app/generated/prisma/client"

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  assetId: string
  assetType: AssetType
  warranty?: Warranty | null
  attachments?: Attachment[]
  onAttachmentDeleted?: (warrantyId: string, attachmentId: string) => void
  /** When set (property view), shows a target picker: this property or one of its equipment. */
  equipmentOptions?: { id: string; name: string }[]
  propertyName?: string
}

function fmt(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().split("T")[0] : ""
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

export function WarrantyFormDialog({ open, onClose, assetId, assetType, warranty, attachments: initialAttachments = [], onAttachmentDeleted, equipmentOptions, propertyName = "This property" }: Props) {
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [createdWarrantyId, setCreatedWarrantyId] = useState<string | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
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
    defaultValues: { assetId, assetType, productName: "", purchaseDate: "", expirationDate: "", vendor: "", vendorPhone: "", vendorEmail: "", notes: "" },
  })

  useEffect(() => {
    form.reset(
      warranty
        ? { assetId: warranty.assetId, assetType: warranty.assetType, productName: warranty.productName, purchaseDate: fmt(warranty.purchaseDate), expirationDate: fmt(warranty.expirationDate), vendor: warranty.vendor ?? "", vendorPhone: warranty.vendorPhone ?? "", vendorEmail: warranty.vendorEmail ?? "", notes: warranty.notes ?? "" }
        : { assetId, assetType, productName: "", purchaseDate: "", expirationDate: "", vendor: "", vendorPhone: "", vendorEmail: "", notes: "" }
    )
  }, [warranty, open, form, assetId, assetType])

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
    if (!warranty) return
    const result = await deleteAttachment(attachment.id)
    if (result?.error) { toast.error(result.error); return }
    setRemovedIds((prev) => new Set(prev).add(attachment.id))
    onAttachmentDeleted?.(warranty.id, attachment.id)
    toast.success("Attachment removed.")
  }

  async function onSubmit(values: FormValues) {
    const payload = values as unknown as Parameters<typeof createWarranty>[0]
    const existingId = warranty?.id ?? createdWarrantyId
    const result = existingId
      ? await updateWarranty(existingId, payload)
      : await createWarranty(payload)

    if (result?.error) { showServerError(form, result.error); return }

    const warrantyId = existingId ?? (result as { success: boolean; id?: string }).id
    if (warrantyId && !existingId) setCreatedWarrantyId(warrantyId)

    if (stagedFiles.length > 0 && warrantyId) {
      const uploads = await Promise.allSettled(
        stagedFiles.map(async (file) => {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("recordId", warrantyId)
          formData.append("recordType", "WARRANTY")
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

    toast.success(warranty ? "Warranty updated." : "Warranty added.")
    router.refresh()
    handleClose()
  }

  function handleClose() {
    setStagedFiles([])
    setRemovedIds(new Set())
    setCreatedWarrantyId(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()} disablePointerDismissal={filePickerOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{warranty ? "Edit Warranty" : "Add Warranty"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {equipmentOptions && equipmentOptions.length > 0 && (
              <FormItem>
                <FormLabel help="warranty.target">For</FormLabel>
                <Select
                  value={targetKey(form.watch("assetType"), form.watch("assetId"))}
                  onValueChange={(value) => {
                    if (!value) return
                    const [type, ...rest] = value.split(":")
                    form.setValue("assetType", type as FormValues["assetType"])
                    form.setValue("assetId", rest.join(":"))
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

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="productName" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="warranty.product">Product / Coverage *</FormLabel>
                  <FormControl><Input placeholder="Roof — GAF Timberline" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="vendor" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="warranty.vendor">Vendor / Manufacturer</FormLabel>
                  <FormControl><Input placeholder="GAF" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="warranty.purchase-date">Purchase Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="expirationDate" render={({ field }) => (
                <FormItem>
                  <FormLabel help="warranty.expiration">Expiration Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="vendorPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel help="warranty.phone">Vendor Phone</FormLabel>
                  <FormControl><Input type="tel" placeholder="555-555-5555" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="vendorEmail" render={({ field }) => (
                <FormItem>
                  <FormLabel help="warranty.email">Vendor Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="warranty.notes">Notes</FormLabel>
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
                    const href = `/api/files/warranty/${warranty?.id}/${a.filename}`
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
                {form.formState.isSubmitting ? "Saving…" : warranty ? "Save Changes" : "Add Warranty"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
