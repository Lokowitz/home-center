import { describe, expect, it } from "vitest"
import { aggregateRows, dateBucket, groupSpec, measureSpec, NONE } from "./aggregate"
import { ToolInputError } from "./query"

const d = (s: string) => new Date(`${s}T00:00:00Z`)
const civic = { type: "VEHICLE", id: "v1", name: "Civic", href: "/vehicles/v1" }
const tacoma = { type: "VEHICLE", id: "v2", name: "Tacoma", href: "/vehicles/v2" }

const records = [
  { id: "1", cost: 0.1, date: d("2024-02-01"), category: "ROUTINE", asset: civic },
  { id: "2", cost: 0.2, date: d("2024-11-15"), category: null, asset: civic },
  { id: "3", cost: 100, date: d("2025-01-10"), category: "REPAIR", asset: tacoma },
  { id: "4", cost: null, date: d("2025-06-01"), category: "REPAIR", asset: tacoma },
]

describe("dateBucket", () => {
  it("buckets in UTC", () => {
    expect(dateBucket(d("2025-03-31"), "year")).toBe("2025")
    expect(dateBucket(d("2025-03-31"), "quarter")).toBe("2025-Q1")
    expect(dateBucket(d("2025-04-01"), "quarter")).toBe("2025-Q2")
    expect(dateBucket(d("2025-03-31"), "month")).toBe("2025-03")
  })
})

describe("aggregateRows", () => {
  it("sums money in cents by asset and year", () => {
    const result = aggregateRows(
      records,
      measureSpec("serviceRecord", { op: "sum", field: "cost" }),
      [groupSpec("serviceRecord", "asset"), groupSpec("serviceRecord", "date:year")]
    )
    expect(result).toEqual({
      measure: "sum(cost)",
      groupBy: ["asset", "date:year"],
      groups: [
        { key: ["Civic", "2024"], value: 0.3, count: 2, assetId: "v1", href: "/vehicles/v1" },
        { key: ["Tacoma", "2025"], value: 100, count: 2, assetId: "v2", href: "/vehicles/v2" },
      ],
      total: { value: 100.3, count: 4 },
    })
  })

  it("counts, labelling empty values", () => {
    const result = aggregateRows(records, measureSpec("serviceRecord", { op: "count" }), [groupSpec("serviceRecord", "category")])
    expect(result.groups).toEqual([
      { key: [NONE], value: 1, count: 1 },
      { key: ["REPAIR"], value: 2, count: 2 },
      { key: ["ROUTINE"], value: 1, count: 1 },
    ])
    expect(result.total).toEqual({ value: 4, count: 4 })
  })

  it("averages and ranges skip nulls", () => {
    const avg = aggregateRows(records, measureSpec("serviceRecord", { op: "avg", field: "cost" }), [])
    expect(avg.total).toEqual({ value: 33.43, count: 4 })
    const max = aggregateRows(records, measureSpec("serviceRecord", { op: "max", field: "cost" }), [])
    expect(max.total.value).toBe(100)
    const none = aggregateRows([], measureSpec("serviceRecord", { op: "min", field: "cost" }), [])
    expect(none.total).toEqual({ value: null, count: 0 })
  })

  it("keeps same-named assets apart, labelled by name with id and link", () => {
    const fridge = (id: string) => ({ type: "EQUIPMENT", id, name: "Refrigerator", href: `/equipment/${id}` })
    const rows = [
      { id: "1", cost: 10, asset: fridge("e1") },
      { id: "2", cost: 20, asset: fridge("e2") },
      { id: "3", cost: 5, asset: fridge("e1") },
      { id: "4", cost: 1 },
    ]
    const result = aggregateRows(rows, measureSpec("serviceRecord", { op: "sum", field: "cost" }), [groupSpec("serviceRecord", "asset")])
    expect(result.groups).toEqual([
      { key: [NONE], value: 1, count: 1 },
      { key: ["Refrigerator"], value: 15, count: 2, assetId: "e1", href: "/equipment/e1" },
      { key: ["Refrigerator"], value: 20, count: 1, assetId: "e2", href: "/equipment/e2" },
    ])
  })

  it("groups by a one-relation's name", () => {
    const meds = [
      { id: "m1", person: { name: "Anna" } },
      { id: "m2", person: { name: "Anna" } },
      { id: "m3", person: null },
    ]
    const result = aggregateRows(meds, measureSpec("medication", { op: "count" }), [groupSpec("medication", "person")])
    expect(result.groups).toEqual([
      { key: [NONE], value: 1, count: 1 },
      { key: ["Anna"], value: 2, count: 2 },
    ])
  })

  it("sorts month keys chronologically and caps the group count", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), date: d(`2025-${String(12 - i).padStart(2, "0")}-01`) }))
    const result = aggregateRows(rows, measureSpec("serviceRecord", { op: "count" }), [groupSpec("serviceRecord", "date:month")], 5)
    expect(result.groups.map((g) => g.key[0])).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"])
    expect(result.truncatedGroups).toBe(7)
  })
})

describe("specs", () => {
  it("say what selection they need", () => {
    expect(groupSpec("serviceRecord", "date:year").select).toEqual({ date: true })
    expect(groupSpec("medication", "person").select).toEqual({ person: { select: { name: true } } })
    expect(groupSpec("serviceRecord", "asset").select).toEqual({ assetType: true, assetId: true })
    expect(measureSpec("serviceRecord", { op: "sum", field: "cost" }).select).toEqual({ cost: true })
  })

  it("reject what can't be grouped or measured", () => {
    expect(() => groupSpec("person", "medications")).toThrow(/Aggregate medication instead/)
    expect(() => groupSpec("serviceRecord", "title:year")).toThrow(/Date fields on serviceRecord: date/)
    expect(() => groupSpec("serviceRecord", "date:week")).toThrow(ToolInputError)
    expect(() => groupSpec("serviceRecord", "nope")).toThrow(ToolInputError)
    expect(() => measureSpec("serviceRecord", { op: "sum", field: "title" })).toThrow(/numeric field on serviceRecord: cost, mileageAtService/)
    expect(() => measureSpec("serviceRecord", { op: "sum" })).toThrow(ToolInputError)
  })

  it("won't group through a relation into a feature that's off", () => {
    expect(() => groupSpec("equipment", "room", { rooms: false })).toThrow(/Rooms is turned off/)
    expect(() => groupSpec("serviceRecord", "room", { rooms: false })).toThrow(/Rooms is turned off/)
    expect(() => groupSpec("maintenanceSchedule", "room", { rooms: false })).toThrow(/Rooms is turned off/)
    expect(() => groupSpec("serviceRecord", "provider", { health: false })).toThrow(/Health is turned off/)
    expect(groupSpec("equipment", "room").select).toEqual({ room: { select: { name: true } } })
  })

  it("lists only reachable relations when a name is unknown", () => {
    expect(() => groupSpec("equipment", "nope", { rooms: false })).toThrow(/Relations: property, serviceRecords/)
    expect(() => groupSpec("equipment", "nope")).toThrow(/Relations: property, room, serviceRecords/)
  })
})
