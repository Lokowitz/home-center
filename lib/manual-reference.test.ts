import { describe, expect, it } from "vitest"
import {
  cleanReference,
  trustedTarget,
  isPdfFile,
  manualChoices,
  manualFileHref,
  manualLabel,
  manualText,
  referenceAllowed,
  resolveManual,
  type ManualOption,
} from "./manual-reference"

function doc(overrides: Partial<ManualOption> = {}): ManualOption {
  return {
    id: "a1",
    name: "Furnace manual.pdf",
    filename: "f1.pdf",
    recordType: "DOCUMENT",
    assetType: "EQUIPMENT",
    assetId: "e1",
    maintenanceScheduleId: null,
    hasText: true,
    ...overrides,
  }
}

function own(overrides: Partial<ManualOption> = {}): ManualOption {
  return {
    id: "a9",
    name: "Own file.pdf",
    filename: "o1.pdf",
    recordType: "MAINTENANCE",
    assetType: null,
    assetId: null,
    maintenanceScheduleId: "s1",
    hasText: false,
    ...overrides,
  }
}

const target = { assetType: "EQUIPMENT", assetId: "e1" }

describe("manual reference", () => {
  it("takes a saved reminder's own asset over the one the client sent", () => {
    const client = { assetType: "VEHICLE", assetId: "x" }
    expect(trustedTarget(client, { assetType: "PERSON", assetId: "h1" })).toEqual({ assetType: "PERSON", assetId: "h1" })
    expect(trustedTarget(client, null)).toEqual(client)
  })

  it("detects PDFs by file extension", () => {
    expect(isPdfFile("f1.pdf")).toBe(true)
    expect(isPdfFile("MANUAL.PDF")).toBe(true)
    expect(isPdfFile("scan.jpg")).toBe(false)
    expect(isPdfFile("pdf")).toBe(false)
  })

  it("builds the file URL and adds #page only for PDFs", () => {
    expect(manualFileHref(doc(), 42)).toBe("/api/files/document/e1/f1.pdf#page=42")
    expect(manualFileHref(own({ filename: "m.PDF" }), 3)).toBe("/api/files/maintenance/s1/m.PDF#page=3")
    expect(manualFileHref(doc({ filename: "scan.jpg" }), 4)).toBe("/api/files/document/e1/scan.jpg")
    expect(manualFileHref(doc(), null)).toBe("/api/files/document/e1/f1.pdf")
    expect(manualFileHref(doc({ assetId: null }), 1)).toBeNull()
    expect(manualFileHref(own({ maintenanceScheduleId: null }), 1)).toBeNull()
  })

  it("labels the link", () => {
    expect(manualLabel(42)).toBe("Manual, p. 42")
    expect(manualLabel(null)).toBe("Manual")
    expect(manualText("Furnace manual.pdf", 42)).toBe("Furnace manual.pdf, p. 42")
    expect(manualText("Furnace manual.pdf", null)).toBe("Furnace manual.pdf")
  })

  it("allows only the reminder's own asset documents and its own files", () => {
    expect(referenceAllowed(doc(), target, null, true)).toBe(true)
    expect(referenceAllowed(doc({ assetId: "e2" }), target, null, true)).toBe(false)
    expect(referenceAllowed(doc({ assetType: "PROPERTY" }), target, null, true)).toBe(false)
    expect(referenceAllowed(own(), target, "s1", true)).toBe(true)
    expect(referenceAllowed(own(), target, "s2", true)).toBe(false)
    expect(referenceAllowed(own(), target, null, true)).toBe(false)
    for (const recordType of ["SERVICE", "ROOM", "CONDITION"]) {
      expect(
        referenceAllowed({ recordType, assetType: null, assetId: null, maintenanceScheduleId: null }, target, null, true),
      ).toBe(false)
    }
  })

  it("refuses a person's files while Health is off", () => {
    const person = { assetType: "PERSON", assetId: "h1" }
    const file = doc({ assetType: "PERSON", assetId: "h1" })
    expect(referenceAllowed(file, person, null, true)).toBe(true)
    expect(referenceAllowed(file, person, null, false)).toBe(false)
    expect(referenceAllowed(own(), person, "s1", false)).toBe(false)
    expect(referenceAllowed(doc(), target, null, false)).toBe(true)
  })

  it("lists the choices for a target, sorted by name", () => {
    const options = [
      doc({ id: "a2", name: "Warranty card.pdf" }),
      doc({ id: "a1", name: "Owner manual.pdf" }),
      doc({ id: "a3", assetId: "e2" }),
      own({ id: "a4", name: "Filter sizes.jpg" }),
    ]
    expect(manualChoices(options, target, "s1").map((o) => o.id)).toEqual(["a4", "a1", "a2"])
    expect(manualChoices(options, target, null).map((o) => o.id)).toEqual(["a1", "a2"])
  })

  it("resolves a reminder's manual link", () => {
    expect(resolveManual({ referenceAttachmentId: "a1", referencePage: 42 }, [doc()])).toEqual({
      href: "/api/files/document/e1/f1.pdf#page=42",
      label: "Manual, p. 42",
      title: "Furnace manual.pdf, p. 42",
    })
    expect(resolveManual({ referenceAttachmentId: "gone", referencePage: 42 }, [doc()])).toBeNull()
    expect(resolveManual({ referenceAttachmentId: null, referencePage: 42 }, [doc()])).toBeNull()
  })

  it("cleans the posted reference", () => {
    expect(cleanReference({})).toEqual({ ok: true, value: undefined })
    expect(cleanReference({ attachmentId: "", page: "5" })).toEqual({
      ok: true,
      value: { referenceAttachmentId: null, referencePage: null },
    })
    const withFile = (page: number | null) => ({ ok: true, value: { referenceAttachmentId: "a1", referencePage: page } })
    expect(cleanReference({ attachmentId: "a1", page: "" })).toEqual(withFile(null))
    expect(cleanReference({ attachmentId: "a1" })).toEqual(withFile(null))
    expect(cleanReference({ attachmentId: "a1", page: " 7 " })).toEqual(withFile(7))
    expect(cleanReference({ attachmentId: "a1", page: 12 })).toEqual(withFile(12))
    expect(cleanReference({ attachmentId: "a1", page: "9999" })).toEqual(withFile(9999))
    for (const page of ["0", "-1", "2.5", "abc", "1e3", "10000", 0, 1.5]) {
      expect(cleanReference({ attachmentId: "a1", page })).toEqual({
        ok: false,
        error: "Page must be a whole number from 1 to 9999.",
      })
    }
  })
})
