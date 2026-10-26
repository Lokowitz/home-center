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
import { ScopeToggle } from "./scope-toggle"
import { FileText, Image, Paperclip, Plus, Trash2, Upload, X } from "lucide-react"
import { EquipmentRows } from "@/components/equipment/equipment-rows"
import type { EquipmentWithRoom } from "@/components/equipment/equipment-form-dialog"
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

export function RoomEquipment({ room, onAdd, onEdit }: { room: RoomWithDetails; onAdd: () => void; onEdit: (equipment: EquipmentWithRoom) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {room.equipment.length === 0 ? "No equipment in this room yet." : `${room.equipment.length} in this room`}
        </p>
        <Button type="button" size="sm" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" /> Add equipment</Button>
      </div>
      {room.equipment.length > 0 && <EquipmentRows equipment={room.equipment} onEdit={onEdit} />}
    </div>
  )
}

function useScopedHistory<T extends { assetType: string; assetId: string; roomId: string | null }>(room: RoomWithDetails, rows: T[]) {
  const [scope, setScope] = useState<HistoryScope>("own")
  const equipmentIds = room.equipment.map((e) => e.id)
  return { scope, setScope, rows: scopeRecords(rows, scope, { roomId: room.id }, equipmentIds) }
}

function SourceBadge({ room, r }: { room: RoomWithDetails; r: { assetType: string; assetId: string } }) {
  if (r.assetType !== "EQUIPMENT") return null
  return <Badge variant="outline" className="shrink-0">{room.equipment.find((e) => e.id === r.assetId)?.name ?? "Equipment"}</Badge>
}

/** The room's service records, optionally with those for equipment in it. Click one to edit it; the dialog stacks over this one. */
export function RoomServiceRecords({ room, serviceRecords, onAdd, onEdit }: { room: RoomWithDetails; serviceRecords: RoomServiceRecord[]; onAdd: () => void; onEdit: (record: RoomServiceRecord) => void }) {
  const fmt = useFormat()
  const { scope, setScope, rows } = useScopedHistory(room, serviceRecords)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
          <ScopeToggle scope={scope} onChange={setScope} ownLabel="Room only" withLabel="Room + its equipment" />
        </div>
        <Button type="button" size="sm" onClick={onAdd}><Plus className="mr-1 h-3.5 w-3.5" /> Add service record</Button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No service records for this room yet.</p> : (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onEdit(r)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
                <span className="w-24 shrink-0 text-muted-foreground">{fmt.date(r.date, { utc: true })}</span>
                <span className="flex-1 truncate">{r.title}</span>
                <SourceBadge room={room} r={r} />
                {r.cost != null && <span className="shrink-0 text-muted-foreground">{fmt.money(r.cost)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The room's maintenance reminders, optionally with those for equipment in it. Each links to its own page. */
export function RoomReminders({ room, schedules }: { room: RoomWithDetails; schedules: RoomSchedule[] }) {
  const fmt = useFormat()
  const { scope, setScope, rows } = useScopedHistory(room, schedules)
  const href = (s: RoomSchedule) =>
    s.assetType === "EQUIPMENT"
      ? `/assets/equipment/${s.assetId}?tab=maintenance&open=${s.id}`
      : `/assets/properties/${room.propertyId}?tab=maintenance&open=${s.id}`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{rows.length} reminder{rows.length !== 1 ? "s" : ""}</p>
        <ScopeToggle scope={scope} onChange={setScope} ownLabel="Room only" withLabel="Room + its equipment" />
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No maintenance reminders for this room.</p> : (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={href(s)} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                <span className="flex-1 truncate">{s.title}</span>
                <SourceBadge room={room} r={s} />
                <span className="shrink-0 text-muted-foreground">{s.nextDueDate ? `Due ${fmt.date(s.nextDueDate, { utc: true })}` : "No due date"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
