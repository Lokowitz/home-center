"use client"

// The room dialog's inner panels other than Details: Files, Equipment, History,
// plus the queued-files list a new room shows under its form.

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useFormat } from "@/components/regional-provider"
import { deleteAttachment } from "@/lib/actions/attachments"
import { scopeRecords, type HistoryScope } from "@/lib/rooms"
import { cn } from "@/lib/utils"
import { FileText, Image, Paperclip, Trash2, Upload, X } from "lucide-react"
import type { Attachment } from "@/app/generated/prisma/client"
import type { RoomSchedule, RoomServiceRecord, RoomWithDetails } from "./room-list"

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isImage = (mimeType: string) => mimeType.startsWith("image/")

/** Files picked for a room that doesn't exist yet; uploaded once it's saved. */
export function StagedFiles({ files, inputRef, onPick, onAdd, onRemove }: {
  files: File[]
  inputRef: React.RefObject<HTMLInputElement | null>
  onPick: () => void
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" /> Photos and files
          {files.length > 0 && <Badge variant="secondary" className="h-4 px-1.5 text-xs">{files.length}</Badge>}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { onAdd(Array.from(e.target.files ?? [])); e.target.value = "" }}
        />
        <Button type="button" variant="outline" size="sm" onClick={onPick}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> Attach file
        </Button>
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => {
            const Icon = isImage(file.type) ? Image : FileText
            return (
              <li key={index} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                <button type="button" onClick={() => onRemove(index)} aria-label={`Remove "${file.name}"`} className="shrink-0 text-muted-foreground transition-colors hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** A saved room's files: images as thumbnails, everything else as a list. Uploads go straight to the room. */
export function RoomFiles({ room, uploading, onUpload, onPick, onChanged }: {
  room: RoomWithDetails
  uploading: boolean
  onUpload: (files: File[]) => void
  onPick: (input: HTMLInputElement | null) => void
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const href = (a: Attachment) => `/api/files/room/${room.id}/${a.filename}`
  const images = room.attachments.filter((a) => isImage(a.mimeType))
  const others = room.attachments.filter((a) => !isImage(a.mimeType))

  function handleDelete(a: Attachment) {
    if (!confirm(`Remove "${a.originalName}"?`)) return
    startTransition(async () => {
      const result = await deleteAttachment(a.id)
      if (result?.error) { toast.error(result.error); return }
      toast.success("Attachment removed.")
      onChanged()
    })
  }

  const removeButton = (a: Attachment, className?: string) => (
    <button type="button" onClick={() => handleDelete(a)} disabled={isPending} aria-label={`Remove "${a.originalName}"`}
      className={cn("shrink-0 text-muted-foreground transition-colors hover:text-destructive", className)}>
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Photos, paint chips, flooring receipts. Drop files anywhere to add them.</p>
        <input ref={inputRef} type="file" multiple className="hidden" disabled={uploading}
          onChange={(e) => { onUpload(Array.from(e.target.files ?? [])); e.target.value = "" }} />
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => onPick(inputRef.current)}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Attach file"}
        </Button>
      </div>

      {room.attachments.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-md border">
              <a href={href(a)} target="_blank" rel="noopener noreferrer" title={a.originalName}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served from a private, auth-gated route */}
                <img src={href(a)} alt={a.originalName} loading="lazy" className="aspect-square w-full object-cover" />
              </a>
              {removeButton(a, "absolute right-1 top-1 rounded bg-background/90 p-1")}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <ul className="space-y-1">
          {others.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <a href={href(a)} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">{a.originalName}</a>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
              {removeButton(a)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function RoomEquipment({ room }: { room: RoomWithDetails }) {
  if (room.equipment.length === 0) {
    return <p className="text-sm text-muted-foreground">No equipment in this room yet. Set a piece of equipment&apos;s location to this room to list it here.</p>
  }
  return (
    <ul className="divide-y rounded-md border">
      {room.equipment.map((e) => (
        <li key={e.id}>
          <Link href={`/assets/equipment/${e.id}`} className="block px-3 py-2 text-sm hover:bg-muted/40 hover:underline">{e.name}</Link>
        </li>
      ))}
    </ul>
  )
}

const SCOPES: { value: HistoryScope; label: string }[] = [
  { value: "own", label: "Room only" },
  { value: "withEquipment", label: "Room + its equipment" },
]

/** Service records and reminders for the room, optionally with those for equipment in it. Read-only; each links to its own page. */
export function RoomHistory({ room, serviceRecords, schedules }: { room: RoomWithDetails; serviceRecords: RoomServiceRecord[]; schedules: RoomSchedule[] }) {
  const fmt = useFormat()
  const [scope, setScope] = useState<HistoryScope>("own")
  const equipmentIds = room.equipment.map((e) => e.id)
  const equipmentNames = Object.fromEntries(room.equipment.map((e) => [e.id, e.name]))
  const records = scopeRecords(serviceRecords, scope, { roomId: room.id }, equipmentIds)
  const reminders = scopeRecords(schedules, scope, { roomId: room.id }, equipmentIds)

  function href(r: { id: string; assetType: string; assetId: string }, tab: "service" | "maintenance") {
    return r.assetType === "EQUIPMENT"
      ? `/assets/equipment/${r.assetId}?tab=${tab}&open=${r.id}`
      : `/assets/properties/${room.propertyId}?tab=${tab}&open=${r.id}`
  }

  function source(r: { assetType: string; assetId: string }) {
    if (r.assetType !== "EQUIPMENT") return null
    return <Badge variant="outline" className="shrink-0">{equipmentNames[r.assetId] ?? "Equipment"}</Badge>
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Whose history">
        {SCOPES.map((s) => (
          <button key={s.value} type="button" aria-pressed={scope === s.value} onClick={() => setScope(s.value)}
            className={cn("rounded px-2.5 py-1 text-xs font-medium transition-colors", scope === s.value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {s.label}
          </button>
        ))}
      </div>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium">Service records ({records.length})</h3>
        {records.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
          <ul className="divide-y rounded-md border">
            {records.map((r) => (
              <li key={r.id}>
                <Link href={href(r, "service")} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                  <span className="w-24 shrink-0 text-muted-foreground">{fmt.date(r.date)}</span>
                  <span className="flex-1 truncate">{r.title}</span>
                  {source(r)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium">Maintenance reminders ({reminders.length})</h3>
        {reminders.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
          <ul className="divide-y rounded-md border">
            {reminders.map((s) => (
              <li key={s.id}>
                <Link href={href(s, "maintenance")} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                  <span className="flex-1 truncate">{s.title}</span>
                  {source(s)}
                  <span className="shrink-0 text-muted-foreground">{s.nextDueDate ? `Due ${fmt.date(s.nextDueDate)}` : "No due date"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
