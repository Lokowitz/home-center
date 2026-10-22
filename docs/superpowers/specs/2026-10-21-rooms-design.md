# Rooms — design

## Why

A new user (found the app via YouTube) asked for rooms inside a property: paint
colors, flooring and similar facts, photos, and a room picker in maintenance
dialogs. The owner extended it: equipment location can pick a room, a Features
toggle, and rooms in the property report, search and the assistant.

The everyday moment: "what paint is in the kitchen?" for a touch-up, or "where
is the water heater?" Success is finding that in seconds. Keep it simple — the
owner asked explicitly not to over-build.

## Goals

- Rooms tab on the property page, right after Warranties.
- Room record: name, level, area, dimensions, flooring, notes, a short paint list,
  and photos/files.
- Optional room on maintenance schedules and service records.
- Equipment location is a combobox: pick one of the property's rooms or type free
  text.
- Room dialog shows linked equipment and history, with "room only / room + its
  equipment" filter. The property Service tab gets the same kind of filter.
- Settings → Features: "Rooms", on by default.
- Rooms appear in the property report, global search and the assistant.

## Non-goals / anti-goals

- No room detail page — a dialog over the Rooms tab (owner's pick).
- No floor plans, room-to-room relations, per-wall geometry, unit conversion.
- No assistant create/edit of rooms — read-only access.
- No room on warranties.
- Anti-goal: a form that feels like paperwork. Every field but name is optional.

## Data model (SQLite / Prisma)

```prisma
model Room {
  id             String    @id @default(cuid())
  propertyId     String
  property       Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  name           String
  level          String?   // "Main floor", "Upstairs", free text
  area           Float?    // labelled with RegionalSettings.areaUnit
  dimensions     String?   // free text, "14 × 16 ft"
  flooringType   String?   // free text with suggestions (Hardwood, LVP, Tile…)
  flooringProduct String?  // brand / product / color
  flooringInstalled DateTime?
  notes          String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  paints         RoomPaint[]
  equipment      Equipment[]
  serviceRecords ServiceRecord[]
  schedules      MaintenanceSchedule[]
  attachments    Attachment[]
  @@index([propertyId])
}

model RoomPaint {
  id        String  @id @default(cuid())
  roomId    String
  room      Room    @relation(fields: [roomId], references: [id], onDelete: Cascade)
  surface   String  // "Walls", "Ceiling", "Trim", "Accent wall"
  brand     String?
  colorName String?
  colorCode String?
  finish    String?
  sortOrder Int     @default(0)
}
```

- `Equipment.roomId`, `ServiceRecord.roomId`, `MaintenanceSchedule.roomId`:
  nullable FK, `onDelete: SetNull`.
- `Attachment.roomId` FK cascade + new `AttachmentRecordType.ROOM`; files under
  `uploads/room/<roomId>/`.
- `FeatureSettings.roomsEnabled Boolean @default(true)`.
- Paint list saved by replacing the room's rows on each save (simple).

## Behaviour

**Rooms tab.** Grid of cards (first image attachment as photo, name, level, paint
and flooring summary, equipment and file counts), filter box, "+ Add room".
`?tab=rooms&open=<id>` opens a room.

**Room dialog.** Large dialog with inner tabs:
Details (form) · Files (attachment list, image thumbnails) · Equipment (linked
equipment, links to their pages) · History (service records + schedules tagged to
the room; toggle "Room only / Room + its equipment"). New room: only Details;
files can be queued like warranties do.

**Equipment location combobox.** Text input with the property's rooms as
suggestions. Picking a room links `roomId` and clears `location`; typing text
clears `roomId`. Display everywhere: `room.name ?? location`. Changing the
equipment's property clears `roomId`. Server checks the room belongs to the
equipment's property. With Rooms off: plain text input showing the same value;
saving unchanged text keeps the link.

**Room select in maintenance and service record dialogs.** Optional "Room"
select (with "None") under the "For" picker, listing rooms of the target's
property. Shown only when Rooms is on and the target is a property or equipment
on a property with rooms. Choosing equipment that has a room pre-fills it.
Server checks the room belongs to the property. Completing a schedule copies its
room to the new service record.

**Property Service tab filter.** "Property only / Property + equipment" toggle,
default "+ equipment" (today's behaviour). Room column/badge shown on records
that have one.

**Deleting a room.** Linked equipment gets `location = room.name` before the
link is cleared; records/schedules just lose the link; room files removed from
disk. Deleting a property cascades rooms and their upload dirs.

**Feature off.** Tab, room selects, room badges, search hits, report section,
assistant entity hidden. Data and links untouched.

**Report.** Property report gets a "Rooms" section after Equipment: each room
with level, area/dimensions, flooring, paints, notes. Omitted when off or empty.

**Search.** Keyword search over room name, level, flooring, notes and paint
fields; results link to `?tab=rooms&open=<id>`. Semantic entity doc per room
(paint + flooring text) through the existing entity sync.

**Assistant.** `room` entity in the ontology (fields, `property` relation, paint
as readable text), so `find_records`/`get_record` work; added to the search
shortcut. Read-only.

**Backup / export.** Room and RoomPaint included in snapshot counts and readable
export; `docs/export-format.md` updated.

## Calls made by the builder (owner may override)

- Paint as child rows; flooring as single fields; area + free-text dimensions.
- Room dialog uses inner tabs; Service tab filter defaults to "+ equipment".
- Room select in maintenance and service record dialogs only (not warranties).
- Equipment pre-fills room; completion carries room to the record.
- Room delete copies its name into equipment location.
- Assistant read-only.
