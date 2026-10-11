import { describe, expect, it } from "vitest"
import { INBOX_HREF, INBOX_TOOL_DESCRIPTION, inboxFollowUpQuestion, inboxNoticeText, inboxToolResult, type InboxToolRow } from "./inbox"

const row = (over: Partial<InboxToolRow> = {}): InboxToolRow => ({
  createdAt: new Date("2026-10-09T15:30:00Z"),
  status: "READY",
  parsedDate: new Date("2026-10-01T00:00:00Z"),
  parsedTotal: 84.5,
  parsedVendor: "Jiffy Lube",
  error: null,
  suggestedAssetType: "VEHICLE",
  suggestedAsset: { name: "Civic", href: "/assets/vehicles/v1" },
  suggestedReason: null,
  files: ["receipt.pdf"],
  ...over,
})

describe("inboxToolResult", () => {
  it("lists unfiled items with what was read, and links Intake", () => {
    const out = inboxToolResult([row()], { includeHealth: true })
    expect(out.href).toBe("/intake")
    expect(out.count).toBe(1)
    expect(out.items).toEqual([
      {
        files: ["receipt.pdf"],
        added: "2026-10-09",
        status: "read, ready to file",
        date: "2026-10-01",
        total: 84.5,
        vendor: "Jiffy Lube",
        suggestedAsset: { type: "VEHICLE", name: "Civic", href: "/assets/vehicles/v1" },
      },
    ])
    expect(out.note).toMatch(/not filed/i)
  })

  it("leaves out what wasn't read, and says why an item failed", () => {
    const out = inboxToolResult(
      [row({ status: "PENDING", parsedDate: null, parsedTotal: null, parsedVendor: null, suggestedAssetType: null, suggestedAsset: null })],
      { includeHealth: true }
    )
    expect(out.items[0]).toEqual({ files: ["receipt.pdf"], added: "2026-10-09", status: "still being read" })
    const failed = inboxToolResult([row({ status: "FAILED", error: "Couldn't read this file" })], { includeHealth: true })
    expect(failed.items[0]).toMatchObject({ status: "couldn't be read", error: "Couldn't read this file" })
  })

  it("says why the asset was suggested", () => {
    const out = inboxToolResult([row({ suggestedReason: "VIN on the receipt" })], { includeHealth: true })
    expect(out.items[0].suggestedAsset).toEqual({ type: "VEHICLE", name: "Civic", href: "/assets/vehicles/v1", why: "VIN on the receipt" })
    // No reason stored (older items): no "why" key at all.
    expect(inboxToolResult([row()], { includeHealth: true }).items[0].suggestedAsset).not.toHaveProperty("why")
  })

  it("drops the reason with a hidden suggestion", () => {
    const out = inboxToolResult([row({ suggestedAsset: null, suggestedReason: "Name on the receipt" })], { includeHealth: true })
    expect(JSON.stringify(out)).not.toContain("Name on the receipt")
  })

  it("keeps a person's reason out while health documents aren't allowed", () => {
    const person = row({ suggestedAssetType: "PERSON", suggestedAsset: { name: "Ann", href: "/assets/people/p1" }, suggestedReason: "Name on the receipt" })
    expect(JSON.stringify(inboxToolResult([person], { includeHealth: false }))).not.toContain("Name on the receipt")
    expect(inboxToolResult([person], { includeHealth: true }).items[0].suggestedAsset).toMatchObject({ why: "Name on the receipt" })
  })

  it("keeps the suggestion's type even when its name is hidden", () => {
    const out = inboxToolResult([row({ suggestedAsset: null })], { includeHealth: true })
    expect(out.items[0].suggestedAsset).toBeUndefined()
  })

  it("leaves out items suggested for a person unless health documents are allowed", () => {
    const person = row({ suggestedAssetType: "PERSON", suggestedAsset: { name: "Ann", href: "/assets/people/p1" }, files: ["lab.pdf"] })
    const off = inboxToolResult([row(), person], { includeHealth: false })
    expect(off.count).toBe(1)
    expect(JSON.stringify(off)).not.toContain("lab.pdf")
    expect(JSON.stringify(off)).not.toContain("Ann")
    // A hidden person's name never reaches the row, but the type alone is enough to drop it.
    expect(inboxToolResult([row({ suggestedAssetType: "PERSON", suggestedAsset: null })], { includeHealth: false }).count).toBe(0)
    expect(inboxToolResult([row(), person], { includeHealth: true }).count).toBe(2)
  })

  it("skips items whose upload never arrived", () => {
    expect(inboxToolResult([row({ files: [] })], { includeHealth: true }).count).toBe(0)
  })

  it("says Intake is empty", () => {
    const out = inboxToolResult([], { includeHealth: true })
    expect(out).toMatchObject({ href: "/intake", count: 0, items: [] })
    expect(out.note).toMatch(/empty/i)
  })

  it("caps the list and says how many more there are", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ files: [`r${i}.pdf`] }))
    const out = inboxToolResult(rows, { includeHealth: true, limit: 20 })
    expect(out.count).toBe(30)
    expect(out.items).toHaveLength(20)
    expect(out.note).toContain("20 newest of 30")
  })
})

describe("INBOX_TOOL_DESCRIPTION", () => {
  it("says the assistant can't file anything", () => {
    expect(INBOX_TOOL_DESCRIPTION).toMatch(/can't file/i)
    expect(INBOX_HREF).toBe("/intake")
    expect(INBOX_TOOL_DESCRIPTION).toMatch(/^List the files waiting in Intake/)
    expect(INBOX_TOOL_DESCRIPTION).not.toMatch(/inbox/i)
  })
})

describe("chat notice", () => {
  it("names one file", () => {
    expect(inboxNoticeText(["receipt.pdf"])).toBe("Added receipt.pdf to Intake — reading it now.")
  })
  it("names two, then counts", () => {
    expect(inboxNoticeText(["a.pdf", "b.jpg"])).toBe("Added a.pdf and b.jpg to Intake — reading them now.")
    expect(inboxNoticeText(["a.pdf", "b.jpg", "c.png"])).toBe("Added a.pdf and 2 more files to Intake — reading them now.")
  })
  it("asks what was read", () => {
    expect(inboxFollowUpQuestion(["receipt.pdf"])).toBe("What did you read from receipt.pdf?")
    expect(inboxFollowUpQuestion(["a.pdf", "b.jpg"])).toBe("What did you read from the files I just added?")
  })
})
