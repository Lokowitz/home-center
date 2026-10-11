import { describe, expect, it } from "vitest"
import { archiveName, innerName, protectionOfName, stamp } from "./format"

describe("archive names", () => {
  const d = new Date(2026, 9, 11, 3, 5) // local time
  it("stamps local date and time", () => expect(stamp(d)).toBe("2026-10-11-0305"))
  it("names backups by protection", () => {
    expect(archiveName("backup", d, "none")).toBe("homecenter-2026-10-11-0305.hcbackup")
    expect(archiveName("backup", d, "key")).toBe("homecenter-2026-10-11-0305.hcbackup.age")
    expect(archiveName("backup", d, "password")).toBe("homecenter-2026-10-11-0305.hcbackup.zip")
  })
  it("names exports as zips", () => {
    expect(archiveName("export", d, "none")).toBe("homecenter-export-2026-10-11-0305.zip")
    expect(archiveName("export", d, "password")).toBe("homecenter-export-2026-10-11-0305.zip")
  })
  it("derives the inner name of a protected file", () => {
    expect(innerName("homecenter-2026-10-11-0305.hcbackup.age")).toBe("homecenter-2026-10-11-0305.hcbackup")
    expect(innerName("homecenter-2026-10-11-0305.hcbackup.zip")).toBe("homecenter-2026-10-11-0305.hcbackup")
    expect(innerName("homecenter-export-2026-10-11-0305.zip")).toBe("homecenter-export-2026-10-11-0305-inner.zip")
  })
  it("reads protection from a backup name", () => {
    expect(protectionOfName("a.hcbackup")).toBe("none")
    expect(protectionOfName("a.hcbackup.age")).toBe("key")
    expect(protectionOfName("a.hcbackup.zip")).toBe("password")
    expect(protectionOfName("a.txt")).toBeNull()
  })
})
