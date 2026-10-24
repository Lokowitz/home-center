import type { LoginThrottle } from "./login-throttle"
import { isEmailAddress } from "./email-address"
import { MIN_PASSWORD_LENGTH } from "./password-change"

// "Forgot password": an emailed one-time link to /reset-password. Kept free of
// Prisma, nodemailer and next so it can be tested directly, like
// lib/auth-credentials.ts.
//
// The link carries a random token; only its hash is stored. Asking for a link
// changes nothing about the account, so nobody can lock someone out by typing
// their address — the password changes only when the link is used.

/** How long an emailed link works. */
export const RESET_TOKEN_MINUTES = 15
export const RESET_TOKEN_MS = RESET_TOKEN_MINUTES * 60_000

// Per address and per visitor, to stop the inbox being flooded with links.
export const RESET_REQUEST_LIMITS = { perEmail: 3, perIp: 10, windowMs: 60 * 60_000 }
// Failed token attempts per visitor. The token is 256 random bits, so this is housekeeping.
export const RESET_USE_LIMITS = { perEmail: 10, perIp: 10, windowMs: 15 * 60_000 }

export type RequestDeps = {
  mailReady(): Promise<boolean>
  findUser(email: string): Promise<{ id: string; email: string; name: string | null } | null>
  /** Replaces any link the user already has. Stores the hash, never the token. */
  storeToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>
  send(message: { to: string; subject: string; text: string; html: string }): Promise<void>
  generateToken(): string
  hashToken(token: string): string
  /** The address people reach HomeCenter at, from AUTH_URL; null when it isn't set. */
  appUrl(): Promise<string | null>
  now(): Date
  throttle: LoginThrottle
}

/**
 * "sent" is also the answer for an address with no account, so the page can't be
 * used to find out who has one.
 */
export type RequestResult = "sent" | "throttled" | "unavailable" | "invalid"

export function resetEmail(name: string | null, token: string, appUrl: string | null) {
  const link = appUrl ? `${appUrl}/reset-password?token=${encodeURIComponent(token)}` : null
  const greeting = name ? `Hi ${name},` : "Hi,"
  const how = link
    ? `Choose a new password here:\n${link}`
    : `Open HomeCenter's reset page (Sign in, then "Reset password") and paste this code:\n${token}`
  const text = [
    greeting,
    "",
    "A password reset was requested for your HomeCenter account.",
    how,
    "",
    `It works once and expires in ${RESET_TOKEN_MINUTES} minutes.`,
    "If you didn't ask for this, ignore this email — your password hasn't changed.",
  ].join("\n")
  // The name is user-entered; the link and token are URL-safe.
  const safeName = name?.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const html =
    `<p>${safeName ? `Hi ${safeName},` : "Hi,"}</p>` +
    "<p>A password reset was requested for your HomeCenter account.</p>" +
    (link
      ? `<p><a href="${link}">Choose a new password</a></p>`
      : `<p>Open HomeCenter's reset page (Sign in, then &quot;Reset password&quot;) and paste this code:<br><code>${token}</code></p>`) +
    `<p>It works once and expires in ${RESET_TOKEN_MINUTES} minutes.</p>` +
    "<p>If you didn't ask for this, ignore this email — your password hasn't changed.</p>"
  return { subject: "Reset your HomeCenter password", text, html }
}

export async function requestPasswordReset(emailInput: unknown, ip: string, deps: RequestDeps): Promise<RequestResult> {
  if (!(await deps.mailReady())) return "unavailable"
  const email = typeof emailInput === "string" ? emailInput.trim() : ""
  if (!isEmailAddress(email)) return "invalid"

  if (deps.throttle.isBlocked(email, ip)) return "throttled"
  // Every request counts, found or not.
  deps.throttle.recordFailure(email, ip)

  const user = await deps.findUser(email)
  if (!user) return "sent"

  // Not awaited: waiting on the mail server would make a real account answer
  // measurably slower than an unknown address, and give away who has one.
  void sendResetLink(user, deps)
  return "sent"
}

async function sendResetLink(user: { id: string; email: string; name: string | null }, deps: RequestDeps) {
  const token = deps.generateToken()
  try {
    await deps.send({ to: user.email, ...resetEmail(user.name, token, await deps.appUrl()) })
  } catch (error) {
    console.error("[password-reset] could not send the email:", error instanceof Error ? error.message : error)
    return
  }
  try {
    await deps.storeToken(user.id, deps.hashToken(token), new Date(deps.now().getTime() + RESET_TOKEN_MS))
  } catch (error) {
    console.error("[password-reset] could not store the link:", error instanceof Error ? error.message : error)
  }
}

export type CompleteDeps = {
  hashToken(token: string): string
  /** Removes the link if it exists and hasn't expired, and says whose it was. Atomic, so a link works once. */
  consumeToken(tokenHash: string, now: Date): Promise<{ userId: string } | null>
  /** Hashes and stores it, clears the must-change flag, ends the account's sessions and removes its other links. */
  setPassword(userId: string, password: string): Promise<void>
  now(): Date
  throttle: LoginThrottle
}

export type CompleteResult = "ok" | "invalid" | "short" | "mismatch" | "throttled"

export async function completePasswordReset(
  input: { token: unknown; next: unknown; confirm: unknown },
  ip: string,
  deps: CompleteDeps
): Promise<CompleteResult> {
  if (deps.throttle.isBlocked(ip, ip)) return "throttled"

  const token = typeof input.token === "string" ? input.token.trim() : ""
  const next = typeof input.next === "string" ? input.next : ""
  const confirm = typeof input.confirm === "string" ? input.confirm : ""

  // Checked before the link is used up, so a typo doesn't cost the user their link.
  if (next.length < MIN_PASSWORD_LENGTH) return "short"
  if (next !== confirm) return "mismatch"

  const found = token ? await deps.consumeToken(deps.hashToken(token), deps.now()) : null
  if (!found) {
    deps.throttle.recordFailure(ip, ip)
    return "invalid"
  }
  await deps.setPassword(found.userId, next)
  return "ok"
}
