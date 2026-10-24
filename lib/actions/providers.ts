"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireHealth } from "@/lib/features-server"
import { providerSchema } from "@/lib/health-schemas"
import type { ActionResult, FormValues } from "@/lib/form-types"

// Provider names appear on every person page, so changes revalidate the whole
// people subtree, not just the directory.
function revalidateProviders() {
  revalidatePath("/providers")
  revalidatePath("/assets/people", "layout")
}

export async function createProvider(values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const parsed = providerSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const provider = await prisma.provider.create({ data: parsed.data })
  revalidateProviders()
  return { success: true, id: provider.id }
}

export async function updateProvider(id: string, values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const parsed = providerSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.provider.update({ where: { id }, data: parsed.data })
  revalidateProviders()
  return { success: true }
}

export async function deleteProvider(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const provider = await prisma.provider.findUnique({ where: { id }, select: { id: true } })
  if (!provider) return { error: "Not found" }

  // Every reference is onDelete: SetNull, so visits, conditions and
  // prescriptions keep their history and just lose the link.
  await prisma.provider.delete({ where: { id: provider.id } })
  revalidateProviders()
  return { success: true }
}
