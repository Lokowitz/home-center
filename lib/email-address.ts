import { z } from "zod"

// One address, nothing else. Mail libraries accept display names, groups and
// lists in a recipient string, so a loose "any text" field let an account add
// extra recipients to its own digest. New and changed addresses are stored in
// lower case so two spellings can't become two logins.
export const emailAddress = z.string().trim().max(254).email("Enter a valid email address.").transform((v) => v.toLowerCase())

/** The form an address is stored and looked up in. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Whether two addresses are the same login, ignoring case and surrounding spaces. */
export function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b)
}

export function isEmailAddress(value: string): boolean {
  return emailAddress.safeParse(value).success && value === value.trim()
}
