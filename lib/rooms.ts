import { z } from "zod"
import { optionalNumber } from "./asset-input"
import { nameText, optionalDateText, parseDateOnly } from "./input-limits"

export const FLOORING_SUGGESTIONS = ["Hardwood", "Engineered wood", "Laminate", "Luxury vinyl plank", "Vinyl", "Tile", "Carpet", "Concrete", "Stone"]
export const PAINT_SURFACES = ["Walls", "Ceiling", "Trim", "Doors", "Accent wall", "Cabinets"]

const paintSchema = z.object({
  surface: z.string().min(1),
  brand: z.string().optional(),
  colorName: z.string().optional(),
  colorCode: z.string().optional(),
  finish: z.string().optional(),
})

export const roomSchema = z.object({
  propertyId: z.string(),
  name: nameText("Name is required"),
  level: z.string().optional(),
  area: optionalNumber(z.coerce.number().positive()),
  dimensions: z.string().optional(),
  flooringType: z.string().optional(),
  flooringProduct: z.string().optional(),
  flooringInstalled: optionalDateText,
  notes: z.string().optional(),
  paints: z.array(paintSchema).default([]),
})

export type RoomInput = z.input<typeof roomSchema>

/** The parsed form as the row to save: anything not entered is null. Paints are saved separately via paintRows. */
export function roomData(v: z.infer<typeof roomSchema>) {
  return {
    propertyId: v.propertyId,
    name: v.name,
    level: v.level?.trim() || null,
    area: v.area ?? null,
    dimensions: v.dimensions?.trim() || null,
    flooringType: v.flooringType?.trim() || null,
    flooringProduct: v.flooringProduct?.trim() || null,
    flooringInstalled: v.flooringInstalled?.trim() ? parseDateOnly(v.flooringInstalled) : null,
    notes: v.notes?.trim() || null,
  }
}

type PaintFields = { surface?: string; brand?: string; colorName?: string; colorCode?: string; finish?: string }

/** Paint rows to save: trimmed, blanks null, all-blank rows dropped, sortOrder = position among kept rows. */
export function paintRows(paints: PaintFields[]) {
  return paints
    .map((p) => ({
      surface: p.surface?.trim() ?? "",
      brand: p.brand?.trim() || null,
      colorName: p.colorName?.trim() || null,
      colorCode: p.colorCode?.trim() || null,
      finish: p.finish?.trim() || null,
    }))
    .filter((p) => p.surface || p.brand || p.colorName || p.colorCode || p.finish)
    .map((p, sortOrder) => ({ ...p, sortOrder }))
}

/** "Walls: Sherwin-Williams Agreeable Gray SW 7029 · Eggshell" */
export function paintLabel(p: { surface: string; brand?: string | null; colorName?: string | null; colorCode?: string | null; finish?: string | null }) {
  const color = [p.brand, p.colorName, p.colorCode].filter(Boolean).join(" ")
  const detail = [color, p.finish].filter(Boolean).join(" · ")
  return detail ? `${p.surface}: ${detail}` : p.surface
}

/** Where a piece of equipment lives: its room if it has one, else the free-text location. */
export function locationLabel(e: { location: string | null; room?: { name: string } | null }): string | null {
  return e.room?.name ?? e.location ?? null
}

/** The room whose name the typed text is (ignoring case and surrounding spaces), or null. */
export function matchRoom<T extends { name: string }>(text: string | null | undefined, rooms: T[]): T | null {
  const t = text?.trim().toLowerCase()
  if (!t) return null
  return rooms.find((r) => r.name.trim().toLowerCase() === t) ?? null
}

/**
 * Which unlinked equipment already names a room: a location that is, ignoring case and spaces, exactly one
 * room's name. A name two rooms share is skipped, since either could be meant. Pure; the caller saves it.
 */
export function planRoomLinks(
  rooms: { id: string; name: string }[],
  equipment: { id: string; roomId: string | null; location: string | null }[],
): { equipmentId: string; roomId: string }[] {
  const key = (s: string) => s.trim().toLowerCase()
  const byName = new Map<string, string[]>()
  for (const r of rooms) byName.set(key(r.name), [...(byName.get(key(r.name)) ?? []), r.id])
  const plan: { equipmentId: string; roomId: string }[] = []
  for (const e of equipment) {
    if (e.roomId || !e.location?.trim()) continue
    const ids = byName.get(key(e.location))
    if (ids?.length === 1) plan.push({ equipmentId: e.id, roomId: ids[0] })
  }
  return plan
}

/**
 * The room an equipment form's location links on save: text naming one of the chosen
 * property's rooms links that room; anything else is free text (""). With Rooms off there
 * are no rooms to offer, so the current room counts as the only one and saving its name
 * unchanged keeps the link. A different property drops it.
 */
export function resolveRoomId(
  location: string | null | undefined,
  propertyId: string | undefined,
  rooms: { id: string; name: string }[],
  current: { propertyId: string | null; roomId: string | null; room?: { name: string } | null } | null | undefined,
): string {
  const kept = current?.roomId && current.room && current.propertyId === propertyId ? [{ id: current.roomId, name: current.room.name }] : []
  return (matchRoom(location, rooms) ?? matchRoom(location, kept))?.id ?? ""
}

export type HistoryScope = "own" | "withEquipment"

/**
 * Narrows records to a property's or a room's history. For a property, "withEquipment" is
 * everything passed in (the property plus its equipment). For a room, "own" is records tagged
 * with the room and "withEquipment" adds records for equipment in it.
 */
export function scopeRecords<T extends { assetType: string; assetId: string; roomId?: string | null }>(
  records: T[],
  scope: HistoryScope,
  own: { assetType: "PROPERTY"; assetId: string } | { roomId: string },
  roomEquipmentIds: string[] = [],
): T[] {
  if ("roomId" in own) {
    return records.filter(
      (r) => r.roomId === own.roomId || (scope === "withEquipment" && r.assetType === "EQUIPMENT" && roomEquipmentIds.includes(r.assetId)),
    )
  }
  if (scope === "withEquipment") return records
  return records.filter((r) => r.assetType === own.assetType && r.assetId === own.assetId)
}
