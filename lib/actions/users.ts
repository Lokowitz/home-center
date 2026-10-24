"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import { emailAddress } from "@/lib/email-address"
import { checkPasswordChange, PASSWORD_ERROR_FIELD, PASSWORD_ERROR_TEXT } from "@/lib/password-change"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/")
  return session
}

function generateTempPassword() {
  return randomBytes(6).toString("hex") // 12 char hex string
}

/**
 * Name and email of the signed-in user. A new email needs the current
 * password: whoever controls the email controls password reset, so a signed-in
 * browser alone must not be able to move it (same rule as changeOwnPassword).
 */
export async function updateSelf(data: { name: string; email: string; currentPassword?: string }) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = z.object({
    name: z.string().min(1),
    email: emailAddress,
    currentPassword: z.string().optional(),
  }).safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, passwordHash: true },
  })
  if (!account) redirect("/login")
  if (parsed.data.email !== account.email) {
    const current = parsed.data.currentPassword ?? ""
    if (!current || !(await bcrypt.compare(current, account.passwordHash))) {
      return { error: { currentPassword: ["Your current password is not correct."] } }
    }
  }

  const conflict = await prisma.user.findFirst({
    where: { email: parsed.data.email, NOT: { id: session.user.id } },
  })
  if (conflict) return { error: { email: ["That email is already in use."] } }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name, email: parsed.data.email },
  })
  revalidatePath("/settings")
  return { success: true }
}

export async function updateEmailDigest(digest: string) {
  const session = await auth()
  if (!session) redirect("/login")

  // Anyone can set their own cadence — it only ever affects their own mail.
  const parsed = z.enum(["OFF", "ASAP", "DAILY", "WEEKLY"]).safeParse(digest)
  if (!parsed.success) return { error: "Invalid option." }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { emailDigest: parsed.data },
  })
  revalidatePath("/settings")
  return { success: true }
}

export async function updateNotificationRepeat(repeat: string) {
  const session = await auth()
  if (!session) redirect("/login")

  // Like the email cadence, this only ever affects the caller's own reminders.
  const parsed = z.enum(["ONCE", "REACHED_AND_DUE", "UNTIL_DISMISSED"]).safeParse(repeat)
  if (!parsed.success) return { error: "Invalid option." }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { notificationRepeat: parsed.data },
  })
  revalidatePath("/settings")
  return { success: true }
}

/** Admin-only: whether an account gets notifications (the bell and digest emails). */
export async function setReceivesNotifications(id: string, receives: boolean) {
  await requireAdmin()

  const parsed = z.object({ id: z.string().min(1), receives: z.boolean() }).safeParse({ id, receives })
  if (!parsed.success) return { error: "Invalid request." }

  const updated = await prisma.user.updateMany({
    where: { id: parsed.data.id },
    data: { receivesNotifications: parsed.data.receives },
  })
  if (updated.count === 0) return { error: "That user no longer exists." }
  revalidatePath("/settings")
  return { success: true }
}

export async function createUser(data: { name: string; email: string; role: string }) {
  await requireAdmin()

  const parsed = z.object({
    name: z.string().min(1),
    email: emailAddress,
    role: z.enum(["ADMIN", "USER"]),
  }).safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (exists) return { error: { email: ["A user with this email already exists."] } }

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  await prisma.user.create({
    data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, passwordHash, mustResetPassword: true },
  })
  revalidatePath("/settings")
  return { success: true, tempPassword }
}

export async function updateUserRole(id: string, role: string) {
  const session = await requireAdmin()
  if (id === session.user.id) return { error: "Cannot change your own role." }

  const parsed = z.enum(["ADMIN", "USER"]).safeParse(role)
  if (!parsed.success) return { error: "Invalid role." }

  await prisma.user.update({ where: { id }, data: { role: parsed.data } })
  revalidatePath("/settings")
  return { success: true }
}

/**
 * The signed-in user changing their own password from Settings. Same rules as
 * /change-password: the current password is required, and the version bump
 * signs this account out everywhere — the caller then signs this browser out.
 */
export async function changeOwnPassword(input: { current: string; next: string; confirm: string }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mustResetPassword: true, passwordHash: true },
  })
  if (!account) redirect("/login")

  const next = String(input.next ?? "")
  const error = await checkPasswordChange(
    { current: String(input.current ?? ""), next, confirm: String(input.confirm ?? "") },
    account,
    (password, hash) => bcrypt.compare(password, hash)
  )
  if (error) return { error: PASSWORD_ERROR_TEXT[error], field: PASSWORD_ERROR_FIELD[error] }

  const passwordHash = await bcrypt.hash(next, 12)
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash, mustResetPassword: false, sessionVersion: { increment: 1 } },
  })
  return { success: true }
}

export async function resetUserPassword(id: string) {
  const session = await requireAdmin()
  if (id === session.user.id) return { error: "Use Change Password instead." }

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)
  // Ends that user's sessions everywhere: the old password is no longer theirs.
  await prisma.user.update({ where: { id }, data: { passwordHash, mustResetPassword: true, sessionVersion: { increment: 1 } } })
  revalidatePath("/settings")
  return { success: true, tempPassword }
}

export async function deleteUser(id: string) {
  const session = await requireAdmin()
  if (id === session.user.id) return { error: "Cannot delete your own account." }

  await prisma.user.delete({ where: { id } })
  revalidatePath("/settings")
  return { success: true }
}
