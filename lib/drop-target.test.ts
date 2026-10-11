import { describe, expect, it } from "vitest"
import {
  BLOCKED_LABEL, dragCarriesFiles, intakeAddedMessage, intakeLabel, rejectedFilesMessage, resolveDrop, splitDroppedFiles, type DropInput,
} from "./drop-target"

const civic = { assetType: "VEHICLE" as const, assetId: "v1", name: "Blue Civic" }
const ann = { assetType: "PERSON" as const, assetId: "p1", name: "Ann" }
const none: DropInput = { dialogTargets: [], modalOpen: false, zone: null, pageAsset: null, healthEnabled: true }

describe("resolveDrop", () => {
  it("sends files to Intake when nothing more specific is there", () => {
    expect(resolveDrop(none)).toEqual({ kind: "intake", asset: null, label: "Add to Intake" })
  })

  it("an open dialog that takes files gets them, even over a zone or an asset page", () => {
    const d = resolveDrop({
      ...none,
      modalOpen: true,
      dialogTargets: [{ id: "d1", label: "Add to this record's files", order: 1 }],
      zone: { id: "z1", label: "Attach to this record" },
      pageAsset: civic,
    })
    expect(d).toEqual({ kind: "dialog", targetId: "d1", label: "Add to this record's files" })
  })

  it("the most recently opened dialog wins", () => {
    const d = resolveDrop({
      ...none,
      modalOpen: true,
      dialogTargets: [
        { id: "late", label: "Late", order: 7 },
        { id: "early", label: "Early", order: 2 },
      ],
    })
    expect(d).toMatchObject({ kind: "dialog", targetId: "late" })
  })

  it("a dialog without attachments opened on top of one that has them blocks the drop", () => {
    const d = resolveDrop({
      ...none,
      modalOpen: true,
      dialogTargets: [{ id: "under", label: "Add to this record's files", order: 3, isTop: false }],
    })
    expect(d).toEqual({ kind: "blocked", label: BLOCKED_LABEL })
  })

  it("the dialog known to be on top wins over a more recently registered one underneath", () => {
    const d = resolveDrop({
      ...none,
      modalOpen: true,
      dialogTargets: [
        { id: "top", label: "Top", order: 2, isTop: true },
        { id: "under", label: "Under", order: 5, isTop: false },
      ],
    })
    expect(d).toMatchObject({ kind: "dialog", targetId: "top" })
  })

  it("ignores dialog targets when no dialog is actually open (a closed one still registered)", () => {
    const d = resolveDrop({
      ...none,
      modalOpen: false,
      dialogTargets: [{ id: "stale", label: "Add to this record's files", order: 9 }],
      zone: { id: "z1", label: "Attach to this record" },
    })
    expect(d).toEqual({ kind: "zone", targetId: "z1", label: "Attach to this record" })
  })

  it("an open dialog without attachments blocks the drop", () => {
    expect(resolveDrop({ ...none, modalOpen: true, zone: { id: "z1", label: "x" }, pageAsset: civic })).toEqual({
      kind: "blocked",
      label: BLOCKED_LABEL,
    })
    expect(BLOCKED_LABEL).toBe("This form doesn't take files")
  })

  it("a zone under the pointer beats the page's asset", () => {
    expect(resolveDrop({ ...none, zone: { id: "z1", label: "Attach to this record" }, pageAsset: civic })).toEqual({
      kind: "zone",
      targetId: "z1",
      label: "Attach to this record",
    })
  })

  it("on an asset's page, Intake with that asset", () => {
    expect(resolveDrop({ ...none, pageAsset: civic })).toEqual({ kind: "intake", asset: civic, label: "Add to Intake — for Blue Civic" })
  })

  it("a person's page counts only while Health is on", () => {
    expect(resolveDrop({ ...none, pageAsset: ann })).toMatchObject({ kind: "intake", asset: ann })
    expect(resolveDrop({ ...none, pageAsset: ann, healthEnabled: false })).toEqual({ kind: "intake", asset: null, label: "Add to Intake" })
  })
})

describe("intakeLabel", () => {
  it("names the asset, or falls back when the name is blank", () => {
    expect(intakeLabel(null)).toBe("Add to Intake")
    expect(intakeLabel({ ...civic, name: "  " })).toBe("Add to Intake")
  })
})

describe("dragCarriesFiles", () => {
  it("is true only for file drags", () => {
    expect(dragCarriesFiles(["Files"])).toBe(true)
    expect(dragCarriesFiles(["application/x-moz-file", "Files"])).toBe(true)
    expect(dragCarriesFiles(["text/plain"])).toBe(false)
    expect(dragCarriesFiles(["text/uri-list", "text/html"])).toBe(false)
    expect(dragCarriesFiles([])).toBe(false)
    expect(dragCarriesFiles(null)).toBe(false)
  })
})

describe("splitDroppedFiles", () => {
  it("keeps the types HomeCenter accepts and lists the rest", () => {
    const files = [{ name: "receipt.PDF" }, { name: "photo.jpg" }, { name: "script.exe" }, { name: "noext" }, { name: "page.html" }]
    const { accepted, rejected } = splitDroppedFiles(files)
    expect(accepted.map((f) => f.name)).toEqual(["receipt.PDF", "photo.jpg"])
    expect(rejected.map((f) => f.name)).toEqual(["script.exe", "noext", "page.html"])
  })
  it("handles an empty drop", () => {
    expect(splitDroppedFiles([])).toEqual({ accepted: [], rejected: [] })
  })
})

describe("messages", () => {
  it("counts what landed in Intake", () => {
    expect(intakeAddedMessage(1)).toBe("Added 1 file to Intake")
    expect(intakeAddedMessage(3)).toBe("Added 3 files to Intake")
  })
  it("lists rejected files, shortening a long list", () => {
    expect(rejectedFilesMessage(["a.exe"])).toBe(`HomeCenter doesn't accept "a.exe".`)
    expect(rejectedFilesMessage(["a.exe", "b.html"])).toBe(`HomeCenter doesn't accept "a.exe" and "b.html".`)
    expect(rejectedFilesMessage(["a", "b", "c", "d", "e"])).toBe(`HomeCenter doesn't accept "a", "b", "c" and 2 more.`)
  })
})
