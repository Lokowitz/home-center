import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { storedEmail } from "@/lib/user-email-server"
import { verifyLogin } from "@/lib/auth-credentials"
import { refreshClaims } from "@/lib/auth-session"
import { clientIp, createLoginThrottle } from "@/lib/login-throttle"

// One throttle per process, kept on globalThis because route handlers and
// server actions can each load their own copy of this module.
const g = globalThis as unknown as { __hcLoginThrottle?: ReturnType<typeof createLoginThrottle> }
const throttle = (g.__hcLoginThrottle ??= createLoginThrottle())

/** Shown on the login page as "too many attempts" rather than "wrong password". */
export class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited"
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const result = await verifyLogin(credentials, clientIp(request.headers), {
          findUser: async (email) => prisma.user.findUnique({ where: { email: await storedEmail(email) } }),
          compare: (password, hash) => bcrypt.compare(password, hash),
          throttle,
        })
        if (result.status === "throttled") throw new TooManyAttempts()
        return result.status === "ok" ? result.user : null
      },
    }),
  ],
  callbacks: {
    // Runs on every session read, not only at sign-in: the account is re-read
    // so a role change, a deleted account or a revoked session (password
    // change, admin reset) takes effect on the next request. Returning null
    // ends the session.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.sessionVersion = (user as { sessionVersion: number }).sessionVersion
      }
      if (typeof token.id !== "string") return null
      const account = await prisma.user.findUnique({
        where: { id: token.id },
        select: { role: true, mustResetPassword: true, sessionVersion: true },
      })
      return refreshClaims(token as typeof token & { sessionVersion?: number }, account)
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      session.user.mustResetPassword = token.mustResetPassword as boolean
      return session
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  trustHost: true,
})
