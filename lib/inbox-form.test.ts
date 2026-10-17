import { describe, expect, it } from "vitest"
import {
  NO_CATEGORY, assetKey, fileFormDefaults, fileFormPayload, guessTitle, hasPendingItems, localDay, parseAssetKey,
  readByLabel, readerNote, looksLikeHouseholdName, uploadAccept, fieldErrorTarget, isPreviewableImage,
  vendorDoubt, dateDoubt, totalDoubt, readFields, inboxReadiness, inboxHeadline, defaultDestination,
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

describe("readerNote", () => {
  it("says why the built-in reader was used when Local AI was chosen", () => {
    expect(readerNote("basic", "llm-failed")).toBe("Local AI couldn't read this one — used the built-in reader")
    expect(readerNote("basic", "llm-no-answer")).toBe("Local AI couldn't read this one — used the built-in reader")
    expect(readerNote("basic", "llm-health")).toBe("Local AI skipped: health file")
    expect(readerNote("basic", "llm-not-ready")).toBe("Local AI isn't set up")
  })
  it("says nothing otherwise", () => {
    expect(readerNote("basic", null)).toBeNull()
    expect(readerNote("llm", null)).toBeNull()
    expect(readerNote(null, null)).toBeNull()
    // A note only explains a built-in read.
    expect(readerNote("llm", "llm-failed")).toBeNull()
    expect(readerNote(null, "llm-failed")).toBeNull()
    expect(readerNote("basic", "something-new")).toBeNull()
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

describe("vendorDoubt", () => {
  it("trusts ordinary shop names", () => {
    for (const v of ["Haley Mechanical", "Jiffy Lube", "THE HOME DEPOT #1234", "\tJiffy Lube\t", "Café Müller", "Ålesund Bilservice", "3M", "7-Eleven", "May Plumbing", "Job Lot Hardware", "Accountants Ltd"]) {
      expect(vendorDoubt(v), v).toBeNull()
    }
  })
  it("has nothing to doubt when there is no vendor", () => {
    expect(vendorDoubt(null)).toBeNull()
    expect(vendorDoubt("")).toBeNull()
    expect(vendorDoubt("   ")).toBeNull()
    expect(vendorDoubt("\t\n")).toBeNull()
  })
  it("doubts job, order, invoice and reference numbers", () => {
    for (const v of ["Job #188202288", "Order 55123", "INVOICE NO. 4471", "Ref: A-2231", "Receipt #9", "PO 7781", "Acct 0042", "Account # 12-33", "\tJob\t#188202288"]) {
      expect(vendorDoubt(v), v).toMatch(/number/i)
    }
  })
  it("doubts names that start with punctuation", () => {
    for (const v of [">. BELLE TIR", "#188202288", "*** THANK YOU", "- Acme"]) {
      expect(vendorDoubt(v), v).not.toBeNull()
    }
  })
  it("doubts names that are mostly digits", () => {
    expect(vendorDoubt("188202288")).not.toBeNull()
    expect(vendorDoubt("A 55-1234-99")).not.toBeNull()
    expect(vendorDoubt("Tel 555 123 4567")).not.toBeNull()
  })
  it("doubts names that read as a date", () => {
    for (const v of ["02/02/2026", "2026-02-02", "Feb 2, 2026", "February 2nd 2026", "2 Feb 2026", "12.31.25"]) {
      expect(vendorDoubt(v), v).toMatch(/date/i)
    }
  })
})

describe("looksLikeHouseholdName", () => {
  const names = ["Sam Rivera", "Dana Rivera", "Grandma"]
  it("matches a household member's full name, however it's written", () => {
    for (const v of ["Sam Rivera", "SAM RIVERA", "Rivera, Sam", "sam  rivera.", "Sam J. Rivera", "Mr Sam Rivera"]) {
      expect(looksLikeHouseholdName(v, names), v).toBe(true)
    }
  })
  it("matches a shared last name with any household first name", () => {
    expect(looksLikeHouseholdName("Sam & Dani Rivera", ["Sam Rivera"])).toBe(true)
    expect(looksLikeHouseholdName("Dana and Sam Rivera", ["Sam Rivera"])).toBe(true)
    expect(looksLikeHouseholdName("Dana Rivera", ["Sam Rivera", "Dana Smith"])).toBe(true)
  })
  it("ignores accents", () => {
    expect(looksLikeHouseholdName("Zoe Muller", ["Zoë Müller"])).toBe(true)
  })
  it("doesn't flag a business that only shares a first name, or only a last name", () => {
    for (const v of ["Sam's Plumbing", "Sam's Auto Body", "Big Sam Towing", "Rivera's Pizza", "Rivera Brothers Paving", "Dani Hair Studio"]) {
      expect(looksLikeHouseholdName(v, names), v).toBe(false)
    }
    expect(looksLikeHouseholdName("Sam's Plumbing", ["Sam Rivera"])).toBe(false)
  })
  it("matches a single-word name only when the vendor is just that name", () => {
    expect(looksLikeHouseholdName("Grandma", names)).toBe(true)
    expect(looksLikeHouseholdName("grandma!", names)).toBe(true)
    expect(looksLikeHouseholdName("Grandma's Kitchen", names)).toBe(false)
    expect(looksLikeHouseholdName("Sam", ["Sam"])).toBe(true)
    expect(looksLikeHouseholdName("Sam's Plumbing", ["Sam"])).toBe(false)
  })
  it("has nothing to match without names or a vendor", () => {
    expect(looksLikeHouseholdName("Sam Rivera", [])).toBe(false)
    expect(looksLikeHouseholdName("Sam Rivera", ["", "  ", "&"])).toBe(false)
    expect(looksLikeHouseholdName("", names)).toBe(false)
    expect(looksLikeHouseholdName("  ", names)).toBe(false)
  })
})

describe("vendorDoubt with household names", () => {
  it("doubts a vendor that looks like someone in the household", () => {
    expect(vendorDoubt("Sam & Dani Rivera", ["Sam Rivera"])).toBe("Looks like a household member's name, not a shop name.")
  })
  it("leaves shops alone", () => {
    expect(vendorDoubt("Sam's Plumbing", ["Sam Rivera"])).toBeNull()
    expect(vendorDoubt("Haley Mechanical", ["Sam Rivera"])).toBeNull()
    expect(vendorDoubt("Sam Rivera")).toBeNull()
  })
})

describe("dateDoubt", () => {
  const uploaded = new Date("2026-10-10T15:00:00Z")
  it("trusts dates from the last three years up to the upload", () => {
    expect(dateDoubt(new Date("2026-10-10T00:00:00Z"), uploaded)).toBeNull()
    expect(dateDoubt(new Date("2024-04-30T00:00:00Z"), uploaded)).toBeNull()
    expect(dateDoubt(new Date("2023-10-20T00:00:00Z"), uploaded)).toBeNull()
  })
  it("allows a few days of clock and time-zone slack after the upload", () => {
    expect(dateDoubt(new Date("2026-10-12T00:00:00Z"), uploaded)).toBeNull()
  })
  it("doubts dates well after the upload", () => {
    expect(dateDoubt(new Date("2026-10-20T00:00:00Z"), uploaded)).toMatch(/after/i)
    expect(dateDoubt(new Date("2027-01-01T00:00:00Z"), uploaded)).toMatch(/after/i)
  })
  it("doubts dates more than about three years old", () => {
    expect(dateDoubt(new Date("2023-09-01T00:00:00Z"), uploaded)).toMatch(/years/i)
    expect(dateDoubt(new Date("1999-01-01T00:00:00Z"), uploaded)).toMatch(/years/i)
  })
  it("has nothing to doubt without a date, and doubts an invalid one", () => {
    expect(dateDoubt(null, uploaded)).toBeNull()
    expect(dateDoubt(new Date("nope"), uploaded)).not.toBeNull()
  })
})

describe("totalDoubt", () => {
  it("trusts positive totals and refunds", () => {
    expect(totalDoubt(125)).toBeNull()
    expect(totalDoubt(0.01)).toBeNull()
    expect(totalDoubt(-40)).toBeNull()
    expect(totalDoubt(null)).toBeNull()
  })
  it("doubts a zero or non-finite total", () => {
    expect(totalDoubt(0)).toMatch(/zero/i)
    expect(totalDoubt(-0)).toMatch(/zero/i)
    expect(totalDoubt(Number.NaN)).not.toBeNull()
    expect(totalDoubt(Number.POSITIVE_INFINITY)).not.toBeNull()
  })
})

const ready = {
  status: "READY" as const,
  createdAt: new Date("2026-10-10T15:00:00Z"),
  parsedDate: new Date("2024-04-30T00:00:00Z"),
  parsedTotal: 125,
  parsedVendor: "Haley Mechanical",
  suggestedAsset: { type: "PROPERTY" as const, id: "p1", name: "Boiler" },
  attachments: [{}],
}

describe("readFields", () => {
  it("marks every field found", () => {
    expect(readFields(ready)).toEqual({
      date: { state: "found" }, total: { state: "found" }, vendor: { state: "found" }, asset: { state: "found" },
    })
  })
  it("marks missing fields, including whitespace-only vendors", () => {
    expect(readFields({ ...ready, parsedDate: null, parsedTotal: null, parsedVendor: " \t", suggestedAsset: null })).toEqual({
      date: { state: "missing" }, total: { state: "missing" }, vendor: { state: "missing" }, asset: { state: "missing" },
    })
  })
  it("marks unsure fields with the reason", () => {
    const f = readFields({ ...ready, parsedVendor: "Job #188202288", parsedTotal: 0, parsedDate: new Date("2027-03-01T00:00:00Z") })
    expect(f.vendor).toMatchObject({ state: "unsure", reason: expect.stringMatching(/number/i) })
    expect(f.total).toMatchObject({ state: "unsure", reason: expect.stringMatching(/zero/i) })
    expect(f.date).toMatchObject({ state: "unsure", reason: expect.stringMatching(/after/i) })
  })
  it("marks a vendor that is a household member's name unsure", () => {
    expect(readFields({ ...ready, parsedVendor: "Sam Rivera" }, ["Sam Rivera"]).vendor).toEqual({
      state: "unsure", reason: "Looks like a household member's name, not a shop name.",
    })
    expect(readFields({ ...ready, parsedVendor: "Sam Rivera" }).vendor).toEqual({ state: "found" })
  })
  it("reads dates sent over the wire as strings", () => {
    expect(readFields({ ...ready, createdAt: "2026-10-10T15:00:00.000Z" as unknown as Date, parsedDate: "2024-04-30T00:00:00.000Z" as unknown as Date }).date).toEqual({ state: "found" })
  })
})

describe("inboxReadiness", () => {
  it("is reading while uploading or pending", () => {
    expect(inboxReadiness({ ...ready, attachments: [] })).toBe("reading")
    expect(inboxReadiness({ ...ready, status: "PENDING" })).toBe("reading")
  })
  it("is failed when the file couldn't be read", () => {
    expect(inboxReadiness({ ...ready, status: "FAILED" })).toBe("failed")
  })
  it("is ready with date, total and asset found and nothing unsure", () => {
    expect(inboxReadiness(ready)).toBe("ready")
    // A missing vendor doesn't block it.
    expect(inboxReadiness({ ...ready, parsedVendor: null })).toBe("ready")
  })
  it("needs a look when anything is missing or unsure", () => {
    expect(inboxReadiness({ ...ready, parsedTotal: null })).toBe("check")
    expect(inboxReadiness({ ...ready, parsedDate: null })).toBe("check")
    expect(inboxReadiness({ ...ready, suggestedAsset: null })).toBe("check")
    expect(inboxReadiness({ ...ready, parsedVendor: ">. BELLE TIR" })).toBe("check")
    expect(inboxReadiness({ ...ready, parsedTotal: 0 })).toBe("check")
    expect(inboxReadiness({ ...ready, parsedVendor: "Sam & Dana Rivera" }, ["Sam Rivera"])).toBe("check")
  })
})

describe("inboxHeadline", () => {
  it("reads as a sentence when everything is there", () => {
    expect(inboxHeadline({ total: "$125.00", vendor: "Haley Mechanical", date: "Apr 30, 2024" }, "r6-ai.pdf")).toBe("$125.00 at Haley Mechanical · Apr 30, 2024")
  })
  it("drops the parts it doesn't have", () => {
    expect(inboxHeadline({ total: "$82.40", vendor: null, date: "Feb 2, 2026" }, "x.pdf")).toBe("$82.40 · Feb 2, 2026")
    expect(inboxHeadline({ total: null, vendor: null, date: "Feb 2, 2026" }, "x.pdf")).toBe("Receipt from Feb 2, 2026")
    expect(inboxHeadline({ total: null, vendor: "Haley Mechanical", date: "Apr 30, 2024" }, "x.pdf")).toBe("Haley Mechanical · Apr 30, 2024")
    expect(inboxHeadline({ total: "$9.99", vendor: "Acme", date: null }, "x.pdf")).toBe("$9.99 at Acme")
    expect(inboxHeadline({ total: null, vendor: "\t ", date: null }, "x.pdf")).toBe("x.pdf")
  })
  it("falls back to the file name when nothing was read", () => {
    expect(inboxHeadline({ total: null, vendor: null, date: null }, "scan 1.jpg")).toBe("scan 1.jpg")
  })
})

describe("defaultDestination", () => {
  it("suggests the existing record when one matches the receipt", () => {
    expect(defaultDestination({ suggestedAsset: { type: "VEHICLE", id: "v1", name: "Civic" }, matchingRecord: true })).toBe("attach")
  })
  it("otherwise suggests a new service record", () => {
    expect(defaultDestination({ suggestedAsset: { type: "VEHICLE", id: "v1", name: "Civic" }, matchingRecord: false })).toBe("file")
    expect(defaultDestination({ suggestedAsset: null, matchingRecord: true })).toBe("file")
  })
})
