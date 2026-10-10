import { describe, expect, it } from "vitest"
import {
  NO_CATEGORY, assetKey, fileFormDefaults, fileFormPayload, guessTitle, hasPendingItems, localDay, parseAssetKey,
  readByLabel, uploadAccept, fieldErrorTarget, isPreviewableImage,
} from "./inbox-form"

const item = {
  status: "READY" as const,
  parsedDate: new Date("2026-09-30T00:00:00Z"),
  parsedTotal: 84.5,
  parsedVendor: "Jiffy Lube",
  suggestedAsset: { type: "VEHICLE" as const, id: "v1", name: "Civic" },
}

describe("guessTitle", () => {
  it("names the service after the vendor", () => {
    expect(guessTitle("Jiffy Lube")).toBe("Jiffy Lube service")
    expect(guessTitle("  Home Depot  ")).toBe("Home Depot service")
  })
  it("leaves the title blank without a vendor", () => {
    expect(guessTitle(null)).toBe("")
    expect(guessTitle("")).toBe("")
    expect(guessTitle("   ")).toBe("")
    expect(guessTitle("\t")).toBe("")
  })
})

describe("assetKey / parseAssetKey", () => {
  it("round-trips a type and id", () => {
    expect(parseAssetKey(assetKey("EQUIPMENT", "e:1"))).toEqual({ assetType: "EQUIPMENT", assetId: "e:1" })
  })
  it("rejects blanks and unknown types", () => {
    expect(parseAssetKey("")).toBeNull()
    expect(parseAssetKey("BOAT:1")).toBeNull()
    expect(parseAssetKey("VEHICLE:")).toBeNull()
  })
})

describe("localDay", () => {
  it("formats the local calendar day as YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05")
  })
})

describe("fileFormDefaults", () => {
  it("prefills from what was read", () => {
    expect(fileFormDefaults(item, "2026-10-10")).toEqual({
      assetKey: "VEHICLE:v1",
      date: "2026-09-30",
      title: "Jiffy Lube service",
      vendor: "Jiffy Lube",
      cost: "84.5",
      category: NO_CATEGORY,
      mileageAtService: "",
      scheduleId: "",
      description: "",
    })
  })
  it("falls back to today, no asset and blanks", () => {
    expect(fileFormDefaults({ status: "FAILED", parsedDate: null, parsedTotal: null, parsedVendor: null, suggestedAsset: null }, "2026-10-10"))
      .toMatchObject({ assetKey: "", date: "2026-10-10", title: "", vendor: "", cost: "" })
  })
  it("keeps a zero total", () => {
    expect(fileFormDefaults({ ...item, parsedTotal: 0 }, "2026-10-10").cost).toBe("0")
  })
})

describe("fileFormPayload", () => {
  it("splits the asset and clears the category sentinel", () => {
    const p = fileFormPayload({ ...fileFormDefaults(item, "2026-10-10"), scheduleId: "s1" })
    expect(p).toMatchObject({ assetType: "VEHICLE", assetId: "v1", category: "", scheduleId: "s1", cost: "84.5", title: "Jiffy Lube service" })
    expect(p).not.toHaveProperty("assetKey")
  })
  it("drops mileage for anything but a vehicle", () => {
    const p = fileFormPayload({ ...fileFormDefaults(item, "2026-10-10"), assetKey: "PROPERTY:p1", mileageAtService: "1200" })
    expect(p.mileageAtService).toBe("")
  })
  it("returns blank ids when no asset is chosen (the server rejects it)", () => {
    expect(fileFormPayload({ ...fileFormDefaults(item, "2026-10-10"), assetKey: "" })).toMatchObject({ assetId: "", assetType: "PROPERTY" })
  })
})

describe("fieldErrorTarget", () => {
  it("maps the server's asset fields onto the single asset picker", () => {
    expect(fieldErrorTarget("assetId")).toBe("assetKey")
    expect(fieldErrorTarget("assetType")).toBe("assetKey")
    expect(fieldErrorTarget("title")).toBe("title")
    expect(fieldErrorTarget("providerId")).toBeNull()
  })
})

describe("hasPendingItems", () => {
  it("is true while any item is being read or still has no files", () => {
    expect(hasPendingItems([{ status: "READY", attachments: [{}] }, { status: "PENDING", attachments: [{}] }])).toBe(true)
    expect(hasPendingItems([{ status: "READY", attachments: [] }])).toBe(true)
  })
  it("is false when everything is settled, or there's nothing", () => {
    expect(hasPendingItems([{ status: "READY", attachments: [{}] }, { status: "FAILED", attachments: [{}] }])).toBe(false)
    expect(hasPendingItems([])).toBe(false)
  })
})

describe("readByLabel", () => {
  it("names the reader", () => {
    expect(readByLabel("basic")).toBe("basic")
    expect(readByLabel("llm")).toBe("local AI")
    expect(readByLabel(null)).toBeNull()
    expect(readByLabel("other")).toBeNull()
  })
})

describe("uploadAccept", () => {
  it("lists every allowed extension", () => {
    const accept = uploadAccept()
    expect(accept.split(",")).toContain(".pdf")
    expect(accept.split(",")).toContain(".heic")
    expect(accept).not.toContain(" ")
  })
})

describe("isPreviewableImage", () => {
  it("shows a thumbnail only for images a browser can draw", () => {
    expect(isPreviewableImage("image/jpeg")).toBe(true)
    expect(isPreviewableImage("image/heic")).toBe(false)
    expect(isPreviewableImage("image/tiff")).toBe(false)
    expect(isPreviewableImage("application/pdf")).toBe(false)
  })
})
