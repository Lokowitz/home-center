import { describe, expect, it, vi } from "vitest"
import {
  EMPTY_ITEM_MAX_AGE_MS, chooseParser, filedAttachmentData, inboxText, isStaleEmptyItem, moveWithRollback, parsedFields,
} from "./inbox"

describe("isStaleEmptyItem", () => {
  const now = new Date("2026-10-10T12:00:00Z")
  it("removes items with no files once they're over an hour old", () => {
    expect(isStaleEmptyItem({ createdAt: new Date(now.getTime() - EMPTY_ITEM_MAX_AGE_MS - 1), attachmentCount: 0 }, now)).toBe(true)
  })
  it("keeps recent empty items (an upload may still be running) and anything with files", () => {
    expect(isStaleEmptyItem({ createdAt: new Date(now.getTime() - 60_000), attachmentCount: 0 }, now)).toBe(false)
    expect(isStaleEmptyItem({ createdAt: new Date(0), attachmentCount: 1 }, now)).toBe(false)
  })
})

describe("inboxText", () => {
  it("waits while any file is unread, or there are no files yet", () => {
    expect(inboxText([])).toEqual({ kind: "wait" })
    expect(inboxText([{ status: "DONE", text: "a", error: null }, { status: "PENDING", text: null, error: null }])).toEqual({ kind: "wait" })
  })
  it("joins the text of every read file", () => {
    expect(inboxText([{ status: "DONE", text: "one", error: null }, { status: "EMPTY", text: null, error: null }, { status: "DONE", text: "two", error: null }]))
      .toEqual({ kind: "text", text: "one\ftwo" })
  })
  it("fails only when nothing was read and something failed", () => {
    expect(inboxText([{ status: "FAILED", text: null, error: "Password-protected PDF" }])).toEqual({ kind: "failed", error: "Password-protected PDF" })
    expect(inboxText([{ status: "FAILED", text: null, error: null }])).toEqual({ kind: "failed", error: "Couldn't read this file" })
    expect(inboxText([{ status: "FAILED", text: null, error: "x" }, { status: "DONE", text: "ok", error: null }])).toEqual({ kind: "text", text: "ok" })
  })
  it("with indexing off, unread files will never be read: settle with what there is", () => {
    const pending = { status: "PENDING" as const, text: null, error: null }
    expect(inboxText([pending], { indexing: false })).toEqual({ kind: "text", text: "" })
    expect(inboxText([pending, { status: "DONE", text: "old", error: null }], { indexing: false })).toEqual({ kind: "text", text: "old" })
    expect(inboxText([], { indexing: false })).toEqual({ kind: "wait" })
  })
  it("treats files with no text as an empty read, not a failure", () => {
    expect(inboxText([{ status: "EMPTY", text: null, error: null }, { status: "UNSUPPORTED", text: null, error: null }])).toEqual({ kind: "text", text: "" })
  })
})

describe("chooseParser", () => {
  const base = { mode: "LLM" as const, llmReady: true, suggestedAssetType: null, healthDocumentsEnabled: false }
  it("follows the setting", () => {
    expect(chooseParser({ ...base, mode: "OFF" })).toBe("none")
    expect(chooseParser({ ...base, mode: "BASIC" })).toBe("basic")
    expect(chooseParser(base)).toBe("llm")
  })
  it("falls back to basic when the LLM isn't ready", () => {
    expect(chooseParser({ ...base, llmReady: false })).toBe("basic")
  })
  it("keeps a person's file away from the LLM unless health documents are allowed", () => {
    expect(chooseParser({ ...base, suggestedAssetType: "PERSON" })).toBe("basic")
    expect(chooseParser({ ...base, suggestedAssetType: "PERSON", healthDocumentsEnabled: true })).toBe("llm")
    expect(chooseParser({ ...base, suggestedAssetType: "VEHICLE" })).toBe("llm")
  })
})

describe("parsedFields", () => {
  it("turns a parsed receipt into the item's columns", () => {
    expect(parsedFields({ date: "2026-10-05", total: 108.25, vendor: "Acme" }, "basic")).toEqual({
      parsedDate: new Date("2026-10-05T00:00:00Z"), parsedTotal: 108.25, parsedVendor: "Acme", parseMethod: "basic",
    })
  })
  it("clears everything when nothing was parsed", () => {
    expect(parsedFields(null, null)).toEqual({ parsedDate: null, parsedTotal: null, parsedVendor: null, parseMethod: null })
  })
  it("drops a malformed date rather than storing Invalid Date", () => {
    expect(parsedFields({ date: "2026-13-40", total: null, vendor: null }, "llm").parsedDate).toBeNull()
  })
})

describe("filedAttachmentData", () => {
  it("points an inbox file at a service record", () => {
    expect(filedAttachmentData({ kind: "SERVICE", recordId: "s1" })).toEqual({
      recordType: "SERVICE", serviceRecordId: "s1", assetType: null, assetId: null, inboxItemId: null,
    })
  })
  it("points an inbox file at an asset as a document", () => {
    expect(filedAttachmentData({ kind: "DOCUMENT", assetType: "VEHICLE", assetId: "v1" })).toEqual({
      recordType: "DOCUMENT", serviceRecordId: null, assetType: "VEHICLE", assetId: "v1", inboxItemId: null,
    })
  })
})

describe("moveWithRollback", () => {
  const plans = [
    { fromPath: "/u/inbox/i/a.pdf", toPath: "/u/service/s/a.pdf", toDir: "/u/service/s" },
    { fromPath: "/u/inbox/i/b.pdf", toPath: "/u/service/s/b.pdf", toDir: "/u/service/s" },
  ]
  function fakeFs(failOn?: string) {
    const log: string[] = []
    return {
      log,
      fs: {
        mkdir: vi.fn(async (dir: string) => void log.push(`mkdir ${dir}`)),
        rename: vi.fn(async (from: string, to: string) => {
          if (from === failOn) throw new Error("EBUSY")
          log.push(`mv ${from} ${to}`)
        }),
      },
    }
  }

  it("moves every file, then commits", async () => {
    const f = fakeFs()
    const commit = vi.fn(async () => "ok")
    expect(await moveWithRollback(plans, f.fs, commit)).toBe("ok")
    expect(f.log).toEqual(["mkdir /u/service/s", "mv /u/inbox/i/a.pdf /u/service/s/a.pdf", "mv /u/inbox/i/b.pdf /u/service/s/b.pdf"])
    expect(commit).toHaveBeenCalledOnce()
  })

  it("moves files back and never commits when a rename fails", async () => {
    const f = fakeFs("/u/inbox/i/b.pdf")
    const commit = vi.fn(async () => "ok")
    await expect(moveWithRollback(plans, f.fs, commit)).rejects.toThrow("EBUSY")
    expect(commit).not.toHaveBeenCalled()
    expect(f.log.slice(-1)).toEqual(["mv /u/service/s/a.pdf /u/inbox/i/a.pdf"])
  })

  it("moves files back when the commit fails", async () => {
    const f = fakeFs()
    await expect(moveWithRollback(plans, f.fs, async () => { throw new Error("SQLITE_BUSY") })).rejects.toThrow("SQLITE_BUSY")
    expect(f.log.slice(-2)).toEqual(["mv /u/service/s/b.pdf /u/inbox/i/b.pdf", "mv /u/service/s/a.pdf /u/inbox/i/a.pdf"])
  })

  it("keeps going when moving one file back fails, and reports the original error", async () => {
    const f = fakeFs()
    f.fs.rename.mockImplementation(async (from: string, to: string) => {
      if (from === "/u/service/s/b.pdf") throw new Error("gone")
      f.log.push(`mv ${from} ${to}`)
    })
    const onUndoError = vi.fn()
    await expect(moveWithRollback(plans, f.fs, async () => { throw new Error("db") }, onUndoError)).rejects.toThrow("db")
    expect(f.log.slice(-1)).toEqual(["mv /u/service/s/a.pdf /u/inbox/i/a.pdf"])
    expect(onUndoError).toHaveBeenCalledOnce()
  })
})
