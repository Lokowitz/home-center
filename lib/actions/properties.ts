"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"
import { propertySchema as schema, propertyData as clean, type PropertyInput } from "@/lib/asset-input"

export async function createProperty(data: PropertyInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const row = await prisma.property.create({ data: clean(parsed.data) })
  revalidatePath("/assets/properties")
  return { success: true, id: row.id }
}

export async function updateProperty(id: string, data: PropertyInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.property.update({ where: { id }, data: clean(parsed.data) })
  revalidatePath("/assets/properties")
  revalidatePath(`/assets/properties/${id}`)
  return { success: true }
}

export async function deleteProperty(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  await deleteAssetWithRecords("PROPERTY", id)

  revalidatePath("/assets/properties")
  revalidatePath("/assets/equipment")
  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/maintenance")
  return { success: true }
}
