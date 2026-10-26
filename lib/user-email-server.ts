import { prisma } from "@/lib/prisma"
import { normalizeEmail } from "@/lib/email-address"

/**
 * The address as stored for an account that matches this one ignoring case,
 * else the normalised address. Rows saved before emails were lower-cased may
 * be mixed case, and SQLite's unique index treats them as different values,
 * so lookups go through here instead of matching the typed text exactly.
 */
export async function storedEmail(email: string): Promise<string> {
  const lower = normalizeEmail(email)
  const rows = await prisma.$queryRaw<{ email: string }[]>`SELECT email FROM User WHERE lower(email) = ${lower} ORDER BY email = ${lower} DESC LIMIT 1`
  return rows[0]?.email ?? lower
}

/** Whether another account already uses this address, ignoring case. */
export async function emailTaken(email: string, exceptId?: string): Promise<boolean> {
  const lower = normalizeEmail(email)
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM User WHERE lower(email) = ${lower} AND id != ${exceptId ?? ""} LIMIT 1`
  return rows.length > 0
}
