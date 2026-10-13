import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { ArchiveReader } from "./archive"
import { detectProtection, fingerprintOf, parseIdentity, passwordProblem, protectFile, unprotectFile } from "./protect"
import { tempDir } from "./test-support"

async function plain(dir: string) {
  const p = path.join(dir, "plain.hcbackup")
  await writeFile(p, "PK-pretend-archive-bytes")
  return p
}

describe("recovery key", () => {
  it("round-trips and is detected", async () => {
    const dir = await tempDir()
    const id = await generateX25519Identity()
    const recipient = await identityToRecipient(id)
    const dest = path.join(dir, "b.hcbackup.age")
    await protectFile(await plain(dir), dest, { mode: "key", recipient, fingerprint: await fingerprintOf(recipient) }, "b.hcbackup.age")
    expect(await detectProtection(dest)).toBe("key")
    expect(await unprotectFile(dest, path.join(dir, "o1"), {})).toMatchObject({ ok: false, needs: "key" })
    const other = await generateX25519Identity()
    expect(await unprotectFile(dest, path.join(dir, "o2"), { key: other })).toMatchObject({ ok: false, needs: "key", error: expect.stringContaining("doesn't open") })
    expect(existsSync(path.join(dir, "o2"))).toBe(false)
    expect(await unprotectFile(dest, path.join(dir, "o3"), { key: `# kit\n${id}\n` })).toEqual({ ok: true })
    expect(await readFile(path.join(dir, "o3"), "utf8")).toBe("PK-pretend-archive-bytes")
  })
})

describe("password zip", () => {
  it("double-wraps so inner names are hidden, and round-trips", async () => {
    const dir = await tempDir()
    const dest = path.join(dir, "homecenter-2026-10-11-0300.hcbackup.zip")
    await protectFile(await plain(dir), dest, { mode: "password", password: "abcdef" }, "homecenter-2026-10-11-0300.hcbackup.zip")
    expect(await detectProtection(dest)).toBe("password")
    const outer = await ArchiveReader.open(dest)
    expect(outer.entries()).toEqual(["homecenter-2026-10-11-0300.hcbackup"]) // the only visible name
    await outer.close()
    expect(await unprotectFile(dest, path.join(dir, "o"), { password: "wrong1" })).toMatchObject({ ok: false, needs: "password", error: expect.stringContaining("doesn't open") })
    expect(existsSync(path.join(dir, "o"))).toBe(false)
    expect(await unprotectFile(dest, path.join(dir, "o"), { password: "abcdef" })).toEqual({ ok: true })
    expect(await readFile(path.join(dir, "o"), "utf8")).toBe("PK-pretend-archive-bytes")
  })
})

describe("failure", () => {
  it("leaves no dest or partial file behind", async () => {
    const dir = await tempDir()
    const dest = path.join(dir, "x.hcbackup.zip")
    await expect(protectFile(await plain(dir), dest, { mode: "password", password: "abc" }, "x.hcbackup.zip")).rejects.toThrow("at least 6")
    await expect(protectFile(path.join(dir, "missing"), dest, { mode: "password", password: "abcdef" }, "x.hcbackup.zip")).rejects.toThrow()
    expect(await readdir(dir)).toEqual(["plain.hcbackup"])
  })
})

describe("non-credential failures", () => {
  it("do not claim a wrong key or password", async () => {
    const dir = await tempDir()
    const dest = path.join(dir, "b.hcbackup.zip")
    await protectFile(await plain(dir), dest, { mode: "password", password: "abcdef" }, "b.hcbackup.zip")
    const blocker = path.join(dir, "blocker")
    await writeFile(blocker, "x")
    const bad = await unprotectFile(dest, path.join(blocker, "sub", "out"), { password: "abcdef" })
    expect(bad).toMatchObject({ ok: false })
    expect(JSON.stringify(bad)).not.toContain("doesn't open")
    expect(JSON.stringify(bad)).not.toContain("abcdef")
    const missing = await unprotectFile(path.join(dir, "nope"), path.join(dir, "o"), { password: "abcdef" })
    expect(missing).toMatchObject({ ok: false })
    expect(JSON.stringify(missing)).not.toContain("doesn't open")
  })
  it("does not detect an unencrypted single-entry zip or a truncated zip as password", async () => {
    const dir = await tempDir()
    const { ArchiveWriter } = await import("./archive")
    const p = path.join(dir, "one.hcbackup")
    const w = await ArchiveWriter.create(p)
    await w.addFile("only.hcbackup", await plain(dir))
    await w.closeWithoutManifest()
    expect(await detectProtection(p)).toBe("unknown")
    const enc = path.join(dir, "e.hcbackup.zip")
    await protectFile(await plain(dir), enc, { mode: "password", password: "abcdef" }, "e.hcbackup.zip")
    const bytes = await readFile(enc)
    const cut = path.join(dir, "cut.zip")
    await writeFile(cut, bytes.subarray(0, bytes.length - 30))
    expect(await detectProtection(cut)).toBe("unknown")
  })
})

describe("helpers", () => {
  it("detects a plain HomeCenter archive and junk", async () => {
    const dir = await tempDir()
    const { ArchiveWriter } = await import("./archive")
    const p = path.join(dir, "p.hcbackup")
    const w = await ArchiveWriter.create(p)
    await w.finish({ formatVersion: 1, kind: "backup", scope: null, appVersion: "t", migration: "m", createdAt: "", protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false })
    expect(await detectProtection(p)).toBe("none")
    await writeFile(path.join(dir, "j"), "junk")
    expect(await detectProtection(path.join(dir, "j"))).toBe("unknown")
  })
  it("fingerprints are stable and short", async () => {
    expect(await fingerprintOf("age1abc")).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/)
    expect(await fingerprintOf("age1abc")).toBe(await fingerprintOf("age1abc"))
  })
  it("finds the key in a recovery kit", () => {
    expect(parseIdentity("HomeCenter recovery key\nAGE-SECRET-KEY-1QQQ\nmore")).toBe("AGE-SECRET-KEY-1QQQ")
    expect(parseIdentity("nothing here")).toBeNull()
    expect(parseIdentity("key: age-secret-key-1qqq9")).toBe("AGE-SECRET-KEY-1QQQ9")
  })
  it("password rule is 6 characters, nothing else", () => {
    expect(passwordProblem("12345")).toBe("Use at least 6 characters.")
    expect(passwordProblem("aaaaaa")).toBeNull()
    expect(passwordProblem("      ")).toBeNull()
  })
})
