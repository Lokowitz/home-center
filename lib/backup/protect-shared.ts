// Engine file: relative imports only. Browser-safe helpers (no node: modules), shared with the settings UI.
import { MIN_PASSWORD } from "./format"

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
