import { describe, expect, it } from "vitest"
import { buildIdentifiers, matchAsset, type CandidateAsset } from "./match"

const civic: CandidateAsset = {
  assetType: "VEHICLE", id: "v1", name: "Civic",
  identifiers: buildIdentifiers.vehicle({ name: "Civic", make: "Honda", model: "Civic", vin: "1HGCM82633A004352" }),
}
const truck: CandidateAsset = {
  assetType: "VEHICLE", id: "v2", name: "Work Truck",
  identifiers: buildIdentifiers.vehicle({ name: "Work Truck", make: "Ford", model: "F-150", vin: "1FTFW1ET5DFC10312" }),
}
const house: CandidateAsset = {
  assetType: "PROPERTY", id: "p1", name: "Home",
  identifiers: buildIdentifiers.property({ name: "Home", address: "123 Main Street, Springfield, IL 62704" }),
}
const cabin: CandidateAsset = {
  assetType: "PROPERTY", id: "p2", name: "Lake Cabin",
  identifiers: buildIdentifiers.property({ name: "Lake Cabin", address: "9 Shore Rd" }),
}
const washer: CandidateAsset = {
  assetType: "EQUIPMENT", id: "e1", name: "Washer",
  identifiers: buildIdentifiers.equipment({ name: "Washer", manufacturer: "LG", modelNumber: "WM3900HWA", serialNumber: "SN-8812345" }),
}
const all = [civic, truck, house, cabin, washer]

describe("buildIdentifiers", () => {
  it("skips empty fields and uses the first address line", () => {
    expect(buildIdentifiers.vehicle({ name: "Car", make: "Honda", model: "Civic", vin: null })).toEqual([
      { kind: "makeModel", value: "Honda Civic" }, { kind: "name", value: "Car" },
    ])
    expect(buildIdentifiers.property({ name: "Home", address: "123 Main Street, Springfield" })).toEqual([
      { kind: "address", value: "123 Main Street" }, { kind: "name", value: "Home" },
    ])
    expect(buildIdentifiers.equipment({ name: "Furnace", manufacturer: null, modelNumber: null, serialNumber: " " })).toEqual([
      { kind: "name", value: "Furnace" },
    ])
  })
})

describe("matchAsset", () => {
  it("a VIN beats a name match on another vehicle", () => {
    const r = matchAsset("Oil change for Work Truck. VIN 1HGCM82633A004352", all)
    expect(r).toMatchObject({ assetType: "VEHICLE", assetId: "v1" })
    expect(r?.reason).toMatch(/1HGCM82633A004352/)
  })
  it("matches a VIN split by spaces or dashes", () => {
    expect(matchAsset("vin: 1HGCM8-2633A-004352", all)?.assetId).toBe("v1")
  })
  it("normalises Street to St and ignores punctuation and case", () => {
    expect(matchAsset("Service address: 123 MAIN ST.\nSpringfield", all)).toMatchObject({ assetType: "PROPERTY", assetId: "p1" })
    expect(matchAsset("Job site 9 shore road", all)?.assetId).toBe("p2")
  })
  it("does not match an address number inside a longer number", () => {
    expect(matchAsset("Ship to 1123 Main St", [house])).toBeNull()
  })
  it("make and model beat a name", () => {
    const r = matchAsset("Honda Civic brake job, also looked at the Lake Cabin? no", [civic, cabin])
    expect(r?.assetId).toBe("v1")
  })
  it("matches equipment by serial and model number", () => {
    expect(matchAsset("Serial: SN8812345", all)?.assetId).toBe("e1")
    expect(matchAsset("Model WM3900HWA washer repair", all)?.assetId).toBe("e1")
  })
  it("ignores short and common names", () => {
    const car: CandidateAsset = { assetType: "VEHICLE", id: "v9", name: "Car", identifiers: ["Car"] }
    const home: CandidateAsset = { assetType: "PROPERTY", id: "p9", name: "Home", identifiers: ["Home", "My Home"] }
    expect(matchAsset("car wash near home", [car, home])).toBeNull()
  })
  it("matches a long enough name", () => {
    expect(matchAsset("Lake cabin dock repair", all)?.assetId).toBe("p2")
  })
  it("returns null on a tie between different assets", () => {
    const a: CandidateAsset = { assetType: "VEHICLE", id: "a", name: "A", identifiers: ["Honda Civic"] }
    const b: CandidateAsset = { assetType: "VEHICLE", id: "b", name: "B", identifiers: ["Honda Civic"] }
    expect(matchAsset("Honda Civic tires", [a, b])).toBeNull()
  })
  it("returns null on empty text or no match", () => {
    expect(matchAsset("", all)).toBeNull()
    expect(matchAsset("   ", all)).toBeNull()
    expect(matchAsset("Groceries 12.00", all)).toBeNull()
    expect(matchAsset("anything", [])).toBeNull()
  })
  it("classifies plain string identifiers by shape", () => {
    const v: CandidateAsset = { assetType: "VEHICLE", id: "x", name: "Rig", identifiers: ["ABC1234", "Toyota Tacoma"] }
    const n: CandidateAsset = { assetType: "VEHICLE", id: "y", name: "Tacoma", identifiers: ["Tacoma"] }
    expect(matchAsset("Plate ABC 1234 Tacoma", [n, v])?.assetId).toBe("x")
  })
})

describe("matchAsset shownReason", () => {
  it("says which kind of identifier matched, without its value", () => {
    expect(matchAsset("VIN 1HGCM82633A004352", all)?.shownReason).toBe("VIN on the receipt")
    expect(matchAsset("Unit SN-8812345 repaired", [washer])?.shownReason).toBe("serial number on the receipt")
    expect(matchAsset("Model WM3900HWA", [washer])?.shownReason).toBe("model number on the receipt")
    expect(matchAsset("Service address: 123 MAIN ST.", all)?.shownReason).toBe("address on the receipt")
    expect(matchAsset("Honda Civic brake job", [civic, cabin])?.shownReason).toBe("make and model on the receipt")
    expect(matchAsset("Visit to the Lake Cabin", [cabin])?.shownReason).toBe("name on the receipt")
  })
  it("falls back to a generic ID number for untagged codes", () => {
    const plain: CandidateAsset = { assetType: "PROPERTY", id: "p9", name: "Lot", identifiers: ["PARCEL-55821"] }
    expect(matchAsset("parcel-55821", [plain])?.shownReason).toBe("ID number on the receipt")
  })
})
