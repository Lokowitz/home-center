"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DoorOpen, Package, Paperclip, Plus, Search } from "lucide-react"
import { paintLabel } from "@/lib/rooms"
import { RoomFormDialog } from "./room-form-dialog"
import type { Attachment, AssetType, Room, RoomPaint } from "@/app/generated/prisma/client"

export type RoomWithDetails = Room & { paints: RoomPaint[]; attachments: Attachment[]; equipment: { id: string; name: string }[] }

/** A service record or reminder tagged with one of the property's rooms or on equipment in one. */
type HistoryBase = { id: string; title: string; assetType: AssetType; assetId: string; roomId: string | null }
export type RoomServiceRecord = HistoryBase & { date: Date }
export type RoomSchedule = HistoryBase & { nextDueDate: Date | null }

interface Props {
  rooms: RoomWithDetails[]
  propertyId: string
  serviceRecords: RoomServiceRecord[]
  schedules: RoomSchedule[]
  openId?: string
}

function roomPhoto(room: RoomWithDetails) {
  const image = room.attachments.find((a) => a.mimeType.startsWith("image/"))
  return image ? `/api/files/room/${room.id}/${image.filename}` : null
}

function matches(room: RoomWithDetails, q: string) {
  const haystack = [room.name, room.level, room.flooringType, room.flooringProduct, ...room.paints.map(paintLabel)]
  return haystack.some((s) => s?.toLowerCase().includes(q))
}

export function RoomList({ rooms, propertyId, serviceRecords, schedules, openId }: Props) {
  // The open room is looked up by id so a refresh after an upload or save shows fresh data.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [filter, setFilter] = useState("")

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    if (openId && rooms.some((r) => r.id === openId)) { setEditingId(openId); setDialogOpen(true) }
  }

  const editing = editingId ? rooms.find((r) => r.id === editingId) ?? null : null
  const q = filter.trim().toLowerCase()
  const shown = q ? rooms.filter((r) => matches(r, q)) : rooms

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter rooms" aria-label="Filter rooms" className="pl-8" />
        </div>
        <Button size="sm" onClick={() => { setEditingId(null); setDialogOpen(true) }}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No rooms yet. Add one to keep its paint colors, flooring and photos in one place.
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No rooms match “{filter}”.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((room) => (
            <RoomCard key={room.id} room={room} onOpen={() => { setEditingId(room.id); setDialogOpen(true) }} />
          ))}
        </div>
      )}

      <RoomFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        propertyId={propertyId}
        room={editing}
        serviceRecords={serviceRecords}
        schedules={schedules}
      />
    </>
  )
}

function RoomCard({ room, onOpen }: { room: RoomWithDetails; onOpen: () => void }) {
  const photo = roomPhoto(room)
  const flooring = [room.flooringType, room.flooringProduct].filter(Boolean).join(" · ")
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex aspect-[16/9] w-full items-center justify-center bg-muted">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- served from a private, auth-gated route
          <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <DoorOpen className="h-8 w-8 text-muted-foreground/50" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{room.name}</span>
          {room.level && <span className="shrink-0 text-xs text-muted-foreground">{room.level}</span>}
        </div>
        {room.paints.length > 0 && <p className="truncate text-muted-foreground">{paintLabel(room.paints[0])}{room.paints.length > 1 && ` +${room.paints.length - 1}`}</p>}
        {flooring && <p className="truncate text-muted-foreground">Floor: {flooring}</p>}
        <div className="mt-auto flex gap-3 pt-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> {room.equipment.length} equipment</span>
          <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> {room.attachments.length} file{room.attachments.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </button>
  )
}
