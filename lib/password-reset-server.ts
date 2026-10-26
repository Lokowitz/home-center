import { createHash, randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { createLoginThrottle } from "@/lib/login-throttle"
import { storedEmail } from "@/lib/user-email-server"
import { loadMailConfig } from "@/lib/notifications/mail-config"
import { isMailConfigured, sendMail } from "@/lib/notifications/mailer"
import {
  RESET_REQUEST_LIMITS, RESET_USE_LIMITS,
  type CompleteDeps, type RequestDeps,
} from "@/lib/password-reset"

// Kept on globalThis like the sign-in throttle, so every bundle shares one count.
const g = globalThis as unknown as {
  __hcResetRequestThrottle?: ReturnType<typeof createLoginThrottle>
  __hcResetUseThrottle?: ReturnType<typeof createLoginThrottle>
}
const requestThrottle = (g.__hcResetRequestThrottle ??= createLoginThrottle(RESET_REQUEST_LIMITS))
const useThrottle = (g.__hcResetUseThrottle ??= createLoginThrottle(RESET_USE_LIMITS))

/** Resetting needs a way to send the link. */
export async function passwordResetAvailable() {
  const config = await loadMailConfig()
  return isMailConfigured(config) && !config.passwordUnreadable
}

/** Settings → Mail server → Public address, else AUTH_URL. Never taken from the request: see normalizePublicUrl. */
async function appUrl() {
  return (await loadMailConfig()).publicUrl
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export const requestDeps: RequestDeps = {
  mailReady: passwordResetAvailable,
  findUser: async (email) => prisma.user.findFirst({ where: { email: await storedEmail(email) }, select: { id: true, email: true, name: true } }),
  storeToken: async (userId, tokenHash, expiresAt) => {
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } }),
    ])
  },
  send: async (message) => void (await sendMail(message)),
  generateToken: () => randomBytes(32).toString("base64url"),
  hashToken,
  appUrl,
  now: () => new Date(),
  throttle: requestThrottle,
}

export const completeDeps: CompleteDeps = {
  hashToken,
  consumeToken: async (tokenHash, now) => {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
    if (!row || row.expiresAt <= now) return null
    // The delete is the lock: of two simultaneous uses only one removes the row.
    const { count } = await prisma.passwordResetToken.deleteMany({ where: { id: row.id } })
    return count === 1 ? { userId: row.userId } : null
  },
  setPassword: async (userId, password) => {
    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.$transaction([
      // The version bump signs the account out everywhere.
      prisma.user.update({ where: { id: userId }, data: { passwordHash, mustResetPassword: false, sessionVersion: { increment: 1 } } }),
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
    ])
  },
  now: () => new Date(),
  throttle: useThrottle,
}
