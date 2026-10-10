"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["HOUSE", "CONDO", "TOWNHOUSE", "LOT", "OTHER"]),
  address: z.string().min(1, "Address is required"),
  purchaseDate: z.string().optional(),
  purchasePrice: z.coerce.number().positive().optional().or(z.literal("")),
  yearBuilt: z.coerce.number().int().min(1800).max(2100).optional().or(z.literal("")),
  sqFt: z.coerce.number().int().positive().optional().or(z.literal("")),
  notes: z.string().optional(),
})

function clean(v: z.infer<typeof schema>) {
  return {
    name: v.name,
    type: v.type,
    address: v.address,
    purchaseDate: v.purchaseDate ? new Date(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice === "" || v.purchasePrice === undefined ? null : Number(v.purchasePrice),
    yearBuilt: v.yearBuilt === "" || v.yearBuilt === undefined ? null : Number(v.yearBuilt),
    sqFt: v.sqFt === "" || v.sqFt === undefined ? null : Number(v.sqFt),
    notes: v.notes || null,
  }
}

export async function createProperty(data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.property.create({ data: clean(parsed.data) })
  revalidatePath("/assets/properties")
  return { success: true }
}

export async function updateProperty(id: string, data: z.infer<typeof schema>) {
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
