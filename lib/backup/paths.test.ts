import { describe, expect, it } from "vitest"
import path from "node:path"
import { dataDir, dbPathFromUrl, defaultBackupFolder, safeJoin, searchIndexFile } from "./paths"

describe("paths", () => {
  const env = { DATABASE_URL: "file:/data/homecenter.db" }
  it("reads the db path from DATABASE_URL", () => expect(dbPathFromUrl(env.DATABASE_URL)).toBe(path.resolve("/data/homecenter.db")))
  it("puts backups next to the db", () => expect(defaultBackupFolder(env)).toBe(path.join(dataDir(env), "backups")))
  it("finds the search index like index-db does", () => {
    expect(searchIndexFile(env)).toBe(path.join(path.resolve("/data"), "search-index.db"))
    expect(searchIndexFile({ ...env, SEARCH_INDEX_PATH: "/x/s.db" })).toBe(path.resolve("/x/s.db"))
  })
  it("throws without DATABASE_URL", () => expect(() => dbPathFromUrl("")).toThrow("DATABASE_URL"))
})

describe("safeJoin rejects escapes", () => {
  const root = path.resolve("/data/uploads")
  it("joins a normal relative path", () => expect(safeJoin(root, "service/s1/a.pdf")).toBe(path.join(root, "service", "s1", "a.pdf")))
  it.each(["../x", "a/../../x", "/etc/passwd", "C:\\x", "a\\..\\..\\x", "", "a//b/../../.."])("rejects %s", (rel) =>
    expect(safeJoin(root, rel)).toBeNull())
})
