import path from "path"
import { describe, expect, it } from "vitest"
import { planMove } from "./move"

const root = path.resolve("/data/uploads")

describe("planMove", () => {
  it("builds lowercase record-type paths under the root", () => {
    const plan = planMove(root, { recordType: "INBOX", recordId: "i1" }, { recordType: "SERVICE", recordId: "s1" }, "abc.pdf")
    expect(plan).toEqual({
      fromPath: path.join(root, "inbox", "i1", "abc.pdf"),
      toPath: path.join(root, "service", "s1", "abc.pdf"),
      toDir: path.join(root, "service", "s1"),
    })
  })
  it("resolves a relative root", () => {
    const plan = planMove("./uploads", { recordType: "INBOX", recordId: "i1" }, { recordType: "DOCUMENT", recordId: "v1" }, "f.jpg")
    expect(plan.toDir).toBe(path.resolve("./uploads", "document", "v1"))
  })
  it.each([
    [".."], ["../x"], ["a/b"], ["a\\b"], ["."], [""],
  ])("rejects record id %j", (bad) => {
    expect(() => planMove(root, { recordType: "INBOX", recordId: bad }, { recordType: "SERVICE", recordId: "s1" }, "f.pdf")).toThrow()
    expect(() => planMove(root, { recordType: "INBOX", recordId: "i1" }, { recordType: "SERVICE", recordId: bad }, "f.pdf")).toThrow()
  })
  it.each([[".."], ["../f.pdf"], ["x/f.pdf"], ["x\\f.pdf"], [""]])("rejects filename %j", (bad) => {
    expect(() => planMove(root, { recordType: "INBOX", recordId: "i1" }, { recordType: "SERVICE", recordId: "s1" }, bad)).toThrow()
  })
  it("rejects a record type with path characters", () => {
    expect(() => planMove(root, { recordType: "../INBOX", recordId: "i1" }, { recordType: "SERVICE", recordId: "s1" }, "f.pdf")).toThrow()
  })
})
