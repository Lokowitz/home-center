"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useDropTarget } from "@/components/drop/drop-provider"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { deleteAttachment } from "@/lib/actions/attachments"
import { Paperclip, TriangleAlert, Upload, X, Trash2, FileText, Image } from "lucide-react"
import type { ActionResult, FieldConfig, FormValues } from "@/lib/form-types"
import type { Attachment, AttachmentRecordType } from "@/app/generated/prisma/client"

// Base UI Select has no empty-string option, so "none" needs a sentinel.
const NONE = "__none__"

// One dialog for every health record type. Each caller describes its fields as
// data; the server action's zod schema does the real validation and its field
// errors come back under the matching inputs.

interface Props {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  successMessage: string
  fields: FieldConfig[]
  initial: FormValues
  onSubmit: (values: FormValues) => Promise<ActionResult>
  /** Rendered under the fields, e.g. extra content for a record that already exists. */
  children?: React.ReactNode
  /** When set, shows an "Attach file" control: staged before save, uploaded once the record has an id. */
  attachmentRecordType?: AttachmentRecordType
  /** The record's id when editing; absent while creating (the id comes back from onSubmit instead). */
  recordId?: string
  attachments?: Attachment[]
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

export function EntityFormDialog({ open, onClose, title, submitLabel, successMessage, fields, initial, onSubmit, children, attachmentRecordType, recordId, attachments: initialAttachments = [] }: Props) {
  const [values, setValues] = useState<FormValues>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const existingAttachments = initialAttachments.filter((a) => !removedIds.has(a.id))
  const visibleFields = fields.filter((f) => !f.showWhen || f.showWhen(values))

  // Reset whenever the dialog opens, so it shows the record being edited (or a
  // blank form) rather than whatever was typed last time.
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setValues(initial)
      setErrors({})
      setStagedFiles([])
      setRemovedIds(new Set())
      setCreatedRecordId(null)
    }
  }

  function openFilePicker() {
    // The native OS file picker moves focus outside the dialog's DOM, which would
    // otherwise trigger Base UI's modal focus-out dismissal and close the dialog
    // before the file selection is even processed.
    setFilePickerOpen(true)
    window.addEventListener("focus", () => setFilePickerOpen(false), { once: true })
    fileInputRef.current?.click()
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    setStagedFiles((prev) => [...prev, ...Array.from(files)])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // A file dropped anywhere while this is open joins the files staged above.
  useDropTarget({
    label: "Add to this record's files",
    onFiles: (files) => setStagedFiles((prev) => [...prev, ...files]),
    enabled: open && !!attachmentRecordType,
  })

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleDeleteExisting(attachment: Attachment) {
    if (!confirm(`Remove "${attachment.originalName}"?`)) return
    const result = await deleteAttachment(attachment.id)
    if (result?.error) { toast.error(result.error); return }
    setRemovedIds((prev) => new Set(prev).add(attachment.id))
    toast.success("Attachment removed.")
  }

  function set(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const missing = visibleFields.filter((f) => f.required && !values[f.name]?.trim())
    if (missing.length > 0) {
      setErrors(Object.fromEntries(missing.map((f) => [f.name, `${f.label} is required`])))
      return
    }

    setSubmitting(true)
    try {
      const result = await onSubmit(values)
      if (result.error) {
        if (typeof result.error === "string") {
          toast.error(result.error)
        } else {
          setErrors(Object.fromEntries(Object.entries(result.error).map(([k, v]) => [k, v?.[0] ?? "Invalid value"])))
          toast.error("Please fix the errors and try again.")
        }
        return
      }

      const savedId = recordId ?? createdRecordId ?? result.id
      if (savedId && !recordId && !createdRecordId) setCreatedRecordId(savedId)

      if (stagedFiles.length > 0 && attachmentRecordType && savedId) {
        const uploads = await Promise.allSettled(
          stagedFiles.map(async (file) => {
            const formData = new FormData()
            formData.append("file", file)
            formData.append("recordId", savedId)
            formData.append("recordType", attachmentRecordType)
            const res = await fetch("/api/uploads", { method: "POST", body: formData })
            if (!res.ok) {
              const json = await res.json().catch(() => ({}))
              throw new Error(json.error ?? `Failed to upload "${file.name}"`)
            }
            return file
          })
        )
        const succeeded = new Set(uploads.flatMap((u) => (u.status === "fulfilled" ? [u.value] : [])))
        setStagedFiles((prev) => prev.filter((f) => !succeeded.has(f)))
        const firstFailure = uploads.find((u): u is PromiseRejectedResult => u.status === "rejected")
        if (firstFailure) {
          toast.error(firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some files failed to upload.")
          return
        }
        router.refresh()
      }

      toast.success(successMessage)
      onClose()
    } catch {
      toast.error("Something went wrong saving. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} disablePointerDismissal={filePickerOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visibleFields.map((f) => (
              <div key={f.name} className={cn("space-y-1.5", f.wide && "sm:col-span-2")}>
                <Label htmlFor={`field-${f.name}`} help={f.help}>
                  {f.label}
                  {f.required && " *"}
                </Label>
                <FieldInput field={f} value={values[f.name] ?? ""} onChange={(v) => set(f.name, v)} />
                {errors[f.name] && <p className="text-xs text-destructive">{errors[f.name]}</p>}
                {f.notice?.(values) && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {f.notice(values)}
                  </p>
                )}
              </div>
            ))}
          </div>

          {attachmentRecordType && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  Attachments {(existingAttachments.length + stagedFiles.length) > 0 && <span className="inline-flex items-center justify-center rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium">{existingAttachments.length + stagedFiles.length}</span>}
                </div>
                <label>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                  <Button type="button" variant="outline" size="sm" onClick={openFilePicker}>
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    Attach file
                  </Button>
                </label>
              </div>

              {existingAttachments.length > 0 && (
                <ul className="space-y-1">
                  {existingAttachments.map((a) => {
                    const Icon = fileIcon(a.mimeType)
                    const href = `/api/files/${attachmentRecordType.toLowerCase()}/${recordId}/${a.filename}`
                    return (
                      <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">
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
          )}

          {children}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FieldInput({ field, value, onChange }: { field: FieldConfig; value: string; onChange: (v: string) => void }) {
  const id = `field-${field.name}`

  if (field.kind === "textarea") {
    return <Textarea id={id} rows={3} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
  }

  if (field.kind === "select") {
    const options = field.options ?? []
    return (
      <Select value={value || NONE} onValueChange={(v) => onChange(!v || v === NONE ? "" : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{(v: string) => options.find((o) => o.value === v)?.label ?? "None"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!field.required && <SelectItem value={NONE}>None</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.kind === "checkboxes") {
    const options = field.options ?? []
    const selected = new Set(value ? value.split(",") : [])
    return (
      <div id={id} className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={selected.has(o.value)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(o.value)
                else next.delete(o.value)
                onChange([...next].join(","))
              }}
            />
            {o.label}
          </label>
        ))}
        {options.length === 0 && <span className="text-sm text-muted-foreground">Nothing to choose yet.</span>}
      </div>
    )
  }

  const listId = field.suggestions?.length ? `${id}-suggestions` : undefined
  return (
    <>
      <Input
        id={id}
        type={field.kind}
        step={field.kind === "number" ? "any" : undefined}
        value={value}
        placeholder={field.placeholder}
        list={listId}
        autoComplete={listId ? "off" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {field.suggestions!.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </>
  )
}
