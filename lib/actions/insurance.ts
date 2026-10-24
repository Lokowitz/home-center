"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireHealth } from "@/lib/features-server"
import { insuranceSchema } from "@/lib/health-schemas"
import { removeUploadDir } from "@/lib/upload-fs"
import type { ActionResult, FormValues } from "@/lib/form-types"

// Policies show in every covered person's aside, so the people subtree is
// revalidated along with the insurance page.
function revalidateInsurance() {
  revalidatePath("/insurance")
  revalidatePath("/assets/people", "layout")
}

export async function createInsurancePolicy(values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const parsed = insuranceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const { memberIds, ...data } = parsed.data
  const policy = await prisma.insurancePolicy.create({
    data: { ...data, members: { connect: memberIds.map((id) => ({ id })) } },
  })
  revalidateInsurance()
  return { success: true, id: policy.id }
}

export async function updateInsurancePolicy(id: string, values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const parsed = insuranceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.insurancePolicy.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return { error: "Not found" }

  const { memberIds, ...data } = parsed.data
  await prisma.insurancePolicy.update({
    where: { id },
    data: { ...data, members: { set: memberIds.map((memberId) => ({ id: memberId })) } },
  })
  revalidateInsurance()
  return { success: true }
}

export async function deleteInsurancePolicy(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const existing = await prisma.insurancePolicy.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return { error: "Not found" }

  await prisma.insurancePolicy.delete({ where: { id: existing.id } })
  await removeUploadDir("insurance", existing.id)
  revalidateInsurance()
  return { success: true }
}
