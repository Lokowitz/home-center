// Engine file: relative imports and npm packages only.
// Recovery key = age X25519 (the server only ever holds the public half).
// Password = an AES-256 zip holding one inner archive, so file names stay hidden.
import { createReadStream, createWriteStream } from "node:fs"
import { open, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { Decrypter, Encrypter } from "age-encryption"
import { ArchiveReader, ArchiveWriter } from "./archive"
import { innerName, MANIFEST_ENTRY, MIN_PASSWORD, type Protection } from "./format"
import type { ProtectionConfig } from "./backup"

const AGE_MAGIC = "age-encryption.org/v1"

export type UnlockSecret = { key?: string; password?: string }

export function passwordProblem(pw: string): string | null {
  return pw.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : null
}

export function parseIdentity(text: string): string | null {
  return /AGE-SECRET-KEY-1[0-9A-Z]+/i.exec(text)?.[0].toUpperCase() ?? null
}

/** Short, readable id of a recipient so a backup can say which kit opens it. */
export async function fingerprintOf(recipient: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(recipient)))
  const hex = [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return hex.match(/.{4}/g)!.join("-")
}

export async function protectFile(plainPath: string, destPath: string, cfg: ProtectionConfig, destName: string): Promise<void> {
  try {
    if (cfg.mode === "key") {
      const e = new Encrypter()
      e.addRecipient(cfg.recipient)
      const enc = await e.encrypt(Readable.toWeb(createReadStream(plainPath)) as ReadableStream<Uint8Array>)
      await pipeline(Readable.fromWeb(enc as never), createWriteStream(destPath))
      return
    }
    if (cfg.mode === "password") {
      const problem = passwordProblem(cfg.password)
      if (problem) throw new Error(problem)
      const w = await ArchiveWriter.create(destPath, { password: cfg.password })
      try {
        await w.addFile(innerName(destName), plainPath)
        // finish() would add a plaintext manifest.json to the outer zip; close it without one.
        await w.closeWithoutManifest()
      } catch (e) {
        await w.abort()
        throw e
      }
      return
    }
    throw new Error("protectFile called without protection")
  } catch (e) {
    await rm(destPath, { force: true })
    await rm(destPath + ".partial", { force: true })
    throw e
  }
}

export async function detectProtection(p: string): Promise<Protection | "unknown"> {
  const fh = await open(p)
  const head = Buffer.alloc(32)
  try {
    await fh.read(head, 0, 32, 0)
  } finally {
    await fh.close()
  }
  if (head.toString("latin1").startsWith(AGE_MAGIC)) return "key"
  if (head[0] !== 0x50 || head[1] !== 0x4b) return "unknown" // not "PK"
  try {
    const r = await ArchiveReader.open(p)
    try {
      const names = r.entries()
      if (names.includes(MANIFEST_ENTRY)) return "none"
      if (names.length === 1 && /\.(hcbackup|zip)$/.test(names[0]) && r.isEncrypted(names[0])) return "password"
    } finally {
      await r.close()
    }
  } catch {
    // truncated or damaged zip
    return "unknown"
  }
  return "unknown"
}

const WRONG_KEY = "That recovery key doesn't open this backup."
const WRONG_PASSWORD = "That password doesn't open this backup."

/** A plain, secret-free sentence for a failure that isn't a wrong key or password. */
function failureText(e: unknown): string {
  const code = (e as { code?: unknown })?.code
  if (code === "ENOSPC") return "Not enough disk space to unlock this backup."
  if (typeof code === "string") return `Couldn't read this backup file (${code}).`
  return "Couldn't unlock this backup. The file may be damaged."
}

export async function unprotectFile(src: string, destPlain: string, secret: UnlockSecret): Promise<{ ok: true } | { ok: false; error: string; needs?: "key" | "password" }> {
  let kind: Protection | "unknown"
  try {
    kind = await detectProtection(src)
  } catch (e) {
    return { ok: false, error: failureText(e) }
  }
  if (kind === "unknown") return { ok: false, error: "This isn't a HomeCenter backup." }
  if (kind === "none") return { ok: false, error: "This backup isn't protected." }
  const id = kind === "key" && secret.key ? parseIdentity(secret.key) : null
  if (kind === "key" && !id) return { ok: false, error: "This backup needs its recovery key.", needs: "key" }
  if (kind === "password" && !secret.password) return { ok: false, error: "This backup needs its password.", needs: "password" }
  try {
    if (kind === "key") {
      const d = new Decrypter()
      d.addIdentity(id!)
      const out = await d.decrypt(Readable.toWeb(createReadStream(src)) as ReadableStream<Uint8Array>)
      await pipeline(Readable.fromWeb(out as never), createWriteStream(destPlain))
      return { ok: true }
    }
    const r = await ArchiveReader.open(src, secret.password)
    try {
      const [inner] = r.entries()
      await r.extract(inner, destPlain)
    } finally {
      await r.close()
    }
    return { ok: true }
  } catch (e) {
    await rm(destPlain, { force: true })
    const msg = e instanceof Error ? e.message : ""
    if (kind === "key" && /no identity matched/i.test(msg)) return { ok: false, error: WRONG_KEY, needs: "key" }
    if (kind === "password" && /invalid password|invalid signature|hmac/i.test(msg)) return { ok: false, error: WRONG_PASSWORD, needs: "password" }
    return { ok: false, error: failureText(e) }
  }
}

/** CLI: --key <kit file> or --passphrase-env <VAR> (never a password on the command line, where it lands in shell history). */
export async function unlockArgs(args: string[]): Promise<UnlockSecret> {
  const k = args.indexOf("--key")
  const p = args.indexOf("--passphrase-env")
  if (k >= 0 && !args[k + 1]) throw new Error("--key needs the path of your recovery kit file.")
  if (p >= 0 && !args[p + 1]) throw new Error("--passphrase-env needs the name of an environment variable.")
  return {
    key: k >= 0 ? await readFile(path.resolve(args[k + 1]), "utf8") : undefined,
    password: p >= 0 ? process.env[args[p + 1]] : undefined,
  }
}
