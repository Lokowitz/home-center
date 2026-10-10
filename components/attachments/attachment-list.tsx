"use client"

import { useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Paperclip, Trash2, Upload, FileText, Image } from "lucide-react"
import { toast } from "sonner"
import { deleteAttachment } from "@/lib/actions/attachments"
import { uploadFile } from "@/lib/upload-client"
import type { Attachment, AttachmentRecordType } from "@/app/generated/prisma/client"

interface Props {
  recordId: string
  recordType: AttachmentRecordType
  attachments: Attachment[]
  /** Heading over the list. Defaults to "Attachments". */
  label?: string
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

export function AttachmentList({ recordId, recordType, attachments: initial, label = "Attachments" }: Props) {
  const [attachments, setAttachments] = useState(initial)
  const [uploading, setUploading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        try {
          const attachment = await uploadFile(file, recordType, recordId)
          setAttachments((prev) => [...prev, attachment])
          toast.success(`"${file.name}" uploaded.`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Upload failed")
        }
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function handleDelete(id: string, originalName: string) {
    if (!confirm(`Remove "${originalName}"?`)) return
    startTransition(async () => {
      await deleteAttachment(id)
      setAttachments((prev) => prev.filter((a) => a.id !== id))
      toast.success("Attachment removed.")
    })
  }

  const subdir = recordType.toLowerCase()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          {label} {attachments.length > 0 && <Badge variant="secondary" className="h-4 px-1.5 text-xs">{attachments.length}</Badge>}
        </div>
        <label>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {uploading ? "Uploading…" : "Attach file"}
          </Button>
        </label>
      </div>

      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((a) => {
            const Icon = fileIcon(a.mimeType)
            const href = `/api/files/${subdir}/${recordId}/${a.filename}`
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
                  onClick={() => handleDelete(a.id, a.originalName)}
                  disabled={isPending}
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
    </div>
  )
}
