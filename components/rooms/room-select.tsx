"use client"

import { useId } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { RoomOption } from "@/lib/rooms-server"

// Base UI Select has no empty-string option, so "no room" needs a sentinel.
const NO_ROOM = "__none__"

/** Optional room on a record or reminder. Nothing to show when the target's property has no rooms (or Rooms is off). */
export function RoomSelect({ value, onChange, options }: { value: string; onChange(v: string): void; options: RoomOption[] }) {
  const id = useId()
  if (options.length === 0) return null
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} help="room.select">Room</Label>
      <Select value={value || NO_ROOM} onValueChange={(v) => onChange(!v || v === NO_ROOM ? "" : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{(v: string) => options.find((r) => r.id === v)?.name ?? "None"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ROOM}>None</SelectItem>
          {options.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
