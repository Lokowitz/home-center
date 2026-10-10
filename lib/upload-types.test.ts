import { describe, expect, it } from "vitest"
import { extensionForFilename, mimeForFilename } from "./upload-types"

describe("upload types", () => {
  it("maps allowed extensions case-insensitively", () => {
    expect(mimeForFilename("receipt.PDF")).toBe("application/pdf")
    expect(mimeForFilename("card.jpeg")).toBe("image/jpeg")
    expect(extensionForFilename("Scan.HEIC")).toBe(".heic")
    expect(mimeForFilename("manual.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
  })

  it("accepts email and other common document formats", () => {
    expect(mimeForFilename("Warranty claim.MSG")).toBe("application/vnd.ms-outlook")
    expect(mimeForFilename("quote.eml")).toBe("message/rfc822")
    expect(extensionForFilename("notes.md")).toBe(".md")
    expect(extensionForFilename("scan.tif")).toBe(".tif")
    expect(extensionForFilename("budget.xlsm")).toBe(".xlsm")
    expect(extensionForFilename("backup.7z")).toBe(".7z")
  })

  it("rejects anything not on the list", () => {
    expect(mimeForFilename("page.html")).toBeNull()
    expect(mimeForFilename("receipt.pdf.exe")).toBeNull()
    expect(extensionForFilename("noextension")).toBeNull()
    expect(extensionForFilename(".")).toBeNull()
  })
})
