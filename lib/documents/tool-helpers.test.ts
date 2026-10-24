import { describe, expect, it } from "vitest"
import {
  documentAccess, groupHits, hiddenRecordTypes, isHealthDocument, listDocumentsDescription, listedDocument,
  searchDocumentsDescription,
  recordTypeFilter, toRecordType, visibleRecordTypes,
} from "./tool-helpers"

describe("isHealthDocument", () => {
  it("treats anything owned by a person as health, plus the health record types", () => {
    expect(isHealthDocument({ recordType: "SERVICE", asset: { type: "PERSON", id: "p1" } })).toBe(true)
    expect(isHealthDocument({ recordType: "MAINTENANCE", asset: { type: "PERSON", id: "p1" } })).toBe(true)
    expect(isHealthDocument({ recordType: "WARRANTY", asset: { type: "PERSON", id: "p1" } })).toBe(true)
    expect(isHealthDocument({ recordType: "MEDICATION", asset: null })).toBe(true)
    expect(isHealthDocument({ recordType: "SERVICE", asset: { type: "VEHICLE", id: "v1" } })).toBe(false)
    expect(isHealthDocument({ recordType: "INSURANCE", asset: null })).toBe(false)
  })

  it("treats a medical, dental or vision policy's card as health, and a home or life policy's file as not", () => {
    for (const insuranceKind of ["MEDICAL", "DENTAL", "VISION", "OTHER"]) {
      expect(isHealthDocument({ recordType: "INSURANCE", asset: null, insuranceKind })).toBe(true)
    }
    for (const insuranceKind of ["HOME", "AUTO", "LIFE", "UMBRELLA", "RENTERS", "PROPERTY_OTHER"]) {
      expect(isHealthDocument({ recordType: "INSURANCE", asset: null, insuranceKind })).toBe(false)
    }
  })
})

describe("listedDocument", () => {
  const ref = {
    attachmentId: "a1",
    fileName: "Manual.pdf",
    fileHref: "/api/files/warranty/w1/x.pdf",
    record: { type: "warranty", title: "Furnace", href: "/assets/equipment/e1" },
    asset: { type: "EQUIPMENT" as const, id: "e1" },
    uploadedAt: new Date("2026-09-01T15:30:00Z"),
  }

  it("shows a searchable file with its asset name, day and page count", () => {
    expect(listedDocument({ ...ref, text: { status: "DONE", pageCount: 12 } }, "Gas Furnace")).toEqual({
      attachmentId: "a1",
      fileName: "Manual.pdf",
      fileHref: "/api/files/warranty/w1/x.pdf",
      record: { type: "warranty", title: "Furnace", href: "/assets/equipment/e1" },
      asset: "Gas Furnace",
      uploaded: "2026-09-01",
      pages: 12,
    })
  })

  it("says why a file isn't searchable, and leaves out single-page counts", () => {
    expect(listedDocument({ ...ref, text: { status: "PENDING", pageCount: null } }, undefined)).toMatchObject({ searchable: "not yet — waiting to be read" })
    expect(listedDocument({ ...ref, text: { status: "UNSUPPORTED", pageCount: null } }, undefined).searchable).toBe("no — file type can't be read")
    expect(listedDocument({ ...ref, text: { status: "DONE", pageCount: 1 } }, undefined)).not.toHaveProperty("pages")
  })

  it("only mentions medical files in the list description when they're included", () => {
    expect(listDocumentsDescription(false)).not.toMatch(/medical/i)
    expect(listDocumentsDescription(true)).toMatch(/medical/i)
  })
})

describe("record type rules", () => {
  it("tells the model the search understands meaning", () => {
    expect(searchDocumentsDescription(false)).toMatch(/meaning/i)
  })

  it("hides exactly the five health types unless health documents are on", () => {
    expect(hiddenRecordTypes(false)).toEqual(["CONDITION", "OBSERVATION", "MEDICATION", "ALLERGY", "IMMUNIZATION"])
    expect(hiddenRecordTypes(true)).toEqual([])
    expect(visibleRecordTypes(false)).toEqual(["SERVICE", "WARRANTY", "MAINTENANCE", "INSURANCE", "DOCUMENT", "INBOX", "ROOM"])
  })

  it("accepts the loose names models use", () => {
    expect(toRecordType("warranties", false)).toBe("WARRANTY")
    expect(toRecordType("Service records", false)).toBe("SERVICE")
    expect(toRecordType("insurance_policy", false)).toBe("INSURANCE")
    expect(toRecordType("vaccines", true)).toBe("IMMUNIZATION")
    expect(toRecordType("ALLERGY", true)).toBe("ALLERGY")
    expect(toRecordType("intake", false)).toBe("INBOX")
    expect(toRecordType("Intake items", false)).toBe("INBOX")
    expect(toRecordType("inbox", false)).toBe("INBOX")
  })

  it("rejects unknown types and health types while they're hidden, listing what's allowed", () => {
    expect(() => toRecordType("receipts", false)).toThrow(/Use one of: SERVICE, WARRANTY, MAINTENANCE, INSURANCE/)
    expect(() => toRecordType("medications", false)).toThrow(/Unknown recordType/)
  })

  it("hides room files with Rooms off", () => {
    expect(hiddenRecordTypes(true, false)).toEqual(["ROOM"])
    expect(hiddenRecordTypes(false, false)).toEqual(["CONDITION", "OBSERVATION", "MEDICATION", "ALLERGY", "IMMUNIZATION", "ROOM"])
    expect(visibleRecordTypes(false, false)).not.toContain("ROOM")
    expect(visibleRecordTypes(false, true)).toContain("ROOM")
    expect(toRecordType("rooms", false, true)).toBe("ROOM")
    expect(() => toRecordType("rooms", false, false)).toThrow(/Unknown recordType/)
  })

  it("narrows an unfiltered listing to the visible types only while Rooms is off", () => {
    expect(recordTypeFilter(undefined, false, true)).toBeNull()
    expect(recordTypeFilter("warranties", false, false)).toEqual(["WARRANTY"])
    expect(recordTypeFilter(undefined, true, false)).toEqual(visibleRecordTypes(true, false))
    expect(recordTypeFilter(undefined, true, false)).not.toContain("ROOM")
  })

  it("only mentions medical documents in the description when they're included", () => {
    expect(searchDocumentsDescription(false)).not.toMatch(/medical/i)
    expect(searchDocumentsDescription(true)).toMatch(/medical/i)
  })
})

describe("groupHits", () => {
  const hit = (attachmentId: string, score: number, page = 1) => ({ chunkId: Math.round(score * -100), attachmentId, score, page, text: `${attachmentId}@${score}` })

  it("groups by file in best-score order and keeps each file's best chunks", () => {
    const groups = groupHits([hit("b", -2), hit("a", -5), hit("a", -4), hit("a", -3), hit("a", -1), hit("c", -0.5)], 2)
    expect(groups.map((g) => g.attachmentId)).toEqual(["a", "b"])
    expect(groups[0].hits.map((h) => h.score)).toEqual([-5, -4, -3])
  })
})

describe("documentAccess", () => {
  it("needs indexing and assistant access; health needs both plus its own switch", () => {
    const llm = { documentsEnabled: true, healthDocumentsEnabled: true }
    expect(documentAccess({ indexingEnabled: true }, llm)).toEqual({ enabled: true, includeHealth: true })
    expect(documentAccess({ indexingEnabled: false }, llm)).toEqual({ enabled: false, includeHealth: false })
    expect(documentAccess({ indexingEnabled: true }, { ...llm, documentsEnabled: false })).toEqual({ enabled: false, includeHealth: false })
    expect(documentAccess({ indexingEnabled: true }, { ...llm, healthDocumentsEnabled: false })).toEqual({ enabled: true, includeHealth: false })
  })
})
