import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { ArchiveReader, ArchiveWriter, hashFile } from "./archive"
import { FORMAT_VERSION, type Manifest } from "./format"
import { tempDir, writeFiles } from "./test-support"

const meta = (): Omit<Manifest, "files"> => ({
  formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: "test", migration: "m1",
  createdAt: new Date(0).toISOString(), protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false,
})
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

describe("ArchiveWriter / ArchiveReader", () => {
  it("round-trips files and bytes with checksums in the manifest", async () => {
    const dir = await tempDir()
    await writeFiles(dir, { "src/a.txt": "alpha" })
    const out = path.join(dir, "x.hcbackup")
    const w = await ArchiveWriter.create(out)
    await w.addFile("files/a.txt", path.join(dir, "src/a.txt"))
    await w.addBytes("note.txt", "beta")
    const { manifest } = await w.finish(meta())
    expect(existsSync(out)).toBe(true)
    expect(existsSync(out + ".partial")).toBe(false)
    expect(manifest.files).toEqual([
      { path: "files/a.txt", size: 5, sha256: sha("alpha") },
      { path: "note.txt", size: 4, sha256: sha("beta") },
    ])

    const r = await ArchiveReader.open(out)
    expect(r.entries().sort()).toEqual(["files/a.txt", "manifest.json", "note.txt"])
    expect(await r.readText("note.txt")).toBe("beta")
    expect(await r.hash("files/a.txt")).toEqual({ size: 5, sha256: sha("alpha") })
    expect((await r.manifest()).files).toHaveLength(2)
    await r.extract("files/a.txt", path.join(dir, "out/a.txt"))
    expect(await readFile(path.join(dir, "out/a.txt"), "utf8")).toBe("alpha")
    await r.close()
  })

  it("abort removes the partial file and leaves no archive", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "y.hcbackup")
    const w = await ArchiveWriter.create(out)
    await w.addBytes("a", "a")
    await w.abort()
    expect(existsSync(out)).toBe(false)
    expect(existsSync(out + ".partial")).toBe(false)
  })

  it("writes and reads a password-protected zip", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "p.zip")
    const w = await ArchiveWriter.create(out, { password: "abcdef" })
    await w.addBytes("inner.hcbackup", "secret stuff")
    await w.finish(meta())
    await expect(ArchiveReader.open(out, "wrong1").then((r) => r.readText("inner.hcbackup"))).rejects.toThrow()
    const r = await ArchiveReader.open(out, "abcdef")
    expect(await r.readText("inner.hcbackup")).toBe("secret stuff")
    await r.close()
  })

  it("hashFile matches the content", async () => {
    const dir = await tempDir()
    await writeFiles(dir, { "f": "hello" })
    expect(await hashFile(path.join(dir, "f"))).toEqual({ size: 5, sha256: sha("hello") })
  })
})
