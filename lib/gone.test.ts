import { describe, expect, it } from "vitest"
import { GONE_MESSAGE, ignoreGone, isRecordGone, orGone } from "./gone"

const p2025 = () => Object.assign(new Error("Record to delete does not exist."), { code: "P2025" })

describe("isRecordGone", () => {
  it("matches only Prisma's P2025", () => {
    expect(isRecordGone(p2025())).toBe(true)
    expect(isRecordGone(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false)
    expect(isRecordGone(new Error("x"))).toBe(false)
    expect(isRecordGone(null)).toBe(false)
    expect(isRecordGone("P2025")).toBe(false)
  })
})

describe("orGone", () => {
  it("returns nothing when the write works", async () => {
    expect(await orGone(async () => ({ id: "a" }))).toBeUndefined()
  })
  it("turns P2025 into an error to show", async () => {
    expect(await orGone(async () => { throw p2025() })).toEqual({ error: GONE_MESSAGE })
  })
  it("rethrows anything else", async () => {
    await expect(orGone(async () => { throw new Error("disk full") })).rejects.toThrow("disk full")
  })
})

describe("ignoreGone", () => {
  it("treats a missing row as already deleted", async () => {
    await expect(ignoreGone(async () => { throw p2025() })).resolves.toBeUndefined()
  })
  it("rethrows anything else", async () => {
    await expect(ignoreGone(async () => { throw new Error("locked") })).rejects.toThrow("locked")
  })
})
