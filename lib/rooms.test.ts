import { describe, expect, it } from "vitest"
import { locationLabel, matchRoom, paintLabel, paintRows, planRoomLinks, resolveRoomId, roomData, roomSchema, scopeRecords } from "./rooms"

describe("paintRows", () => {
  it("drops all-blank rows and numbers sortOrder from 0", () => {
    const rows = paintRows([
      { surface: "Walls", brand: "  Behr ", colorName: "", colorCode: undefined, finish: "" },
      { surface: "  ", brand: "", colorName: "\t" },
      { surface: "Trim" },
    ])
    expect(rows).toEqual([
      { surface: "Walls", brand: "Behr", colorName: null, colorCode: null, finish: null, sortOrder: 0 },
      { surface: "Trim", brand: null, colorName: null, colorCode: null, finish: null, sortOrder: 1 },
    ])
  })
})

describe("paintLabel", () => {
  it("joins every part", () => {
    expect(
      paintLabel({ surface: "Walls", brand: "Sherwin-Williams", colorName: "Agreeable Gray", colorCode: "SW 7029", finish: "Eggshell" }),
    ).toBe("Walls: Sherwin-Williams Agreeable Gray SW 7029 · Eggshell")
  })

  it("skips missing parts", () => {
    expect(paintLabel({ surface: "Ceiling" })).toBe("Ceiling")
    expect(paintLabel({ surface: "Trim", finish: "Gloss" })).toBe("Trim: Gloss")
  })
})

describe("room input", () => {
  const base = { propertyId: "p1", name: "Kitchen" }
  const parse = (extra: Record<string, unknown>) => {
    const r = roomSchema.safeParse({ ...base, ...extra })
    if (!r.success) throw new Error(JSON.stringify(r.error.flatten().fieldErrors))
    return roomData(r.data)
  }

  it("maps blanks to null and parses the date", () => {
    const d = parse({ level: "", area: "", dimensions: "  ", flooringType: "", flooringInstalled: "2024-05-01", notes: "" })
    expect(d).toMatchObject({ propertyId: "p1", name: "Kitchen", level: null, area: null, dimensions: null, flooringType: null, notes: null })
    expect(d.flooringInstalled).toEqual(new Date("2024-05-01"))
    expect(parse({}).flooringInstalled).toBeNull()
    expect("paints" in d).toBe(false)
  })

  it("keeps a real area and rejects junk", () => {
    expect(parse({ area: "180.5" }).area).toBe(180.5)
    expect(roomSchema.safeParse({ ...base, area: "abc" }).success).toBe(false)
  })

  it("requires a name and defaults paints to empty", () => {
    expect(roomSchema.safeParse({ ...base, name: "" }).success).toBe(false)
    expect(roomSchema.parse(base).paints).toEqual([])
  })
})

describe("locationLabel", () => {
  it("prefers the room, then free-text location, then null", () => {
    expect(locationLabel({ location: "Garage", room: { name: "Kitchen" } })).toBe("Kitchen")
    expect(locationLabel({ location: "Garage", room: null })).toBe("Garage")
    expect(locationLabel({ location: "Garage" })).toBe("Garage")
    expect(locationLabel({ location: null, room: null })).toBeNull()
  })
})

describe("scopeRecords", () => {
  const records = [
    { assetType: "PROPERTY", assetId: "p1", roomId: null },
    { assetType: "EQUIPMENT", assetId: "e1", roomId: null },
    { assetType: "EQUIPMENT", assetId: "e2", roomId: "r1" },
    { assetType: "PROPERTY", assetId: "p1", roomId: "r1" },
    { assetType: "VEHICLE", assetId: "e1", roomId: null },
  ]

  it("property own keeps only the property's records", () => {
    expect(scopeRecords(records, "own", { assetType: "PROPERTY", assetId: "p1" })).toEqual([records[0], records[3]])
  })

  it("property withEquipment keeps everything passed in", () => {
    expect(scopeRecords(records, "withEquipment", { assetType: "PROPERTY", assetId: "p1" })).toEqual(records)
  })

  it("room own keeps records tagged with the room", () => {
    expect(scopeRecords(records, "own", { roomId: "r1" }, ["e1"])).toEqual([records[2], records[3]])
  })

  it("room withEquipment adds the room's equipment records", () => {
    expect(scopeRecords(records, "withEquipment", { roomId: "r1" }, ["e1"])).toEqual([records[1], records[2], records[3]])
  })
})

describe("matchRoom", () => {
  const rooms = [{ id: "r1", name: "Kitchen" }, { id: "r2", name: "Primary Bath" }]

  it("matches a room name ignoring case and surrounding spaces", () => {
    expect(matchRoom("kitchen", rooms)).toEqual(rooms[0])
    expect(matchRoom("  PRIMARY bath	", rooms)).toEqual(rooms[1])
  })

  it("returns null for other text, blanks, or no rooms", () => {
    expect(matchRoom("Kitchenette", rooms)).toBeNull()
    expect(matchRoom("", rooms)).toBeNull()
    expect(matchRoom("   ", rooms)).toBeNull()
    expect(matchRoom("Kitchen", [])).toBeNull()
  })
})

describe("resolveRoomId", () => {
  const linked = { propertyId: "p1", roomId: "r1", room: { name: "Kitchen" } }

  it("keeps the link with Rooms off when the location is unchanged", () => {
    expect(resolveRoomId("Kitchen", "p1", [], linked)).toBe("r1")
    expect(resolveRoomId("  kitchen ", "p1", [], linked)).toBe("r1")
  })

  it("drops the link with Rooms off when the location text is edited", () => {
    expect(resolveRoomId("Pantry", "p1", [], linked)).toBe("")
  })

  it("drops the link when the property changes", () => {
    expect(resolveRoomId("Kitchen", "p2", [], linked)).toBe("")
    expect(resolveRoomId("Kitchen", "", [], linked)).toBe("")
  })

  it("links the property's room the text names with Rooms on", () => {
    const rooms = [{ id: "r1", name: "Kitchen" }, { id: "r2", name: "Garage" }]
    expect(resolveRoomId("garage", "p1", rooms, linked)).toBe("r2")
    expect(resolveRoomId("Garage", "p1", rooms, undefined)).toBe("r2")
    expect(resolveRoomId("Shed", "p1", rooms, undefined)).toBe("")
    expect(resolveRoomId("", "p1", rooms, linked)).toBe("")
  })
})

describe("planRoomLinks", () => {
  const rooms = [{ id: "r1", name: "Kitchen" }, { id: "r2", name: "Garage" }]

  it("links unlinked equipment whose location is exactly a room's name", () => {
    const plan = planRoomLinks(rooms, [
      { id: "e1", roomId: null, location: "kitchen" },
      { id: "e2", roomId: null, location: "  Garage " },
    ])
    expect(plan).toEqual([{ equipmentId: "e1", roomId: "r1" }, { equipmentId: "e2", roomId: "r2" }])
  })

  it("leaves linked, blank and non-matching equipment alone", () => {
    expect(planRoomLinks(rooms, [
      { id: "e1", roomId: "r2", location: "Kitchen" },
      { id: "e2", roomId: null, location: null },
      { id: "e3", roomId: null, location: "" },
      { id: "e4", roomId: null, location: "Under kitchen sink" },
    ])).toEqual([])
  })

  it("skips a name two rooms share, since either could be meant", () => {
    const twins = [{ id: "r1", name: "Bedroom" }, { id: "r2", name: "bedroom" }]
    expect(planRoomLinks(twins, [{ id: "e1", roomId: null, location: "Bedroom" }])).toEqual([])
  })
})

describe("roomSchema limits", () => {
  const base = { propertyId: "p1", name: "Kitchen" }
  const ok = (extra: Record<string, unknown>) => roomSchema.safeParse({ ...base, ...extra }).success

  it("keeps the flooring date between 1900 and 2200", () => {
    expect(ok({ flooringInstalled: "1900-01-01" })).toBe(true)
    expect(ok({ flooringInstalled: "2200-12-31" })).toBe(true)
    expect(ok({ flooringInstalled: "1899-12-31" })).toBe(false)
    expect(ok({ flooringInstalled: "2201-01-01" })).toBe(false)
    expect(ok({ flooringInstalled: "  " })).toBe(true)
  })

  it("limits the name to 200 characters", () => {
    expect(ok({ name: "a".repeat(200) })).toBe(true)
    expect(ok({ name: "a".repeat(201) })).toBe(false)
  })
})
