"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(["APPLIANCE", "HVAC", "WATER", "ELECTRONICS", "TOOL", "OUTDOOR", "SECURITY", "OTHER"]),
  manufacturer: z.string().optional(),
  modelNumber: z.string().optional(),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  propertyId: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.coerce.number().min(0).optional().or(z.literal("")),
  installDate: z.string().optional(),
  notes: z.string().optional(),
})

function clean(v: z.infer<typeof schema>) {
  return {
    name: v.name,
    category: v.category,
    manufacturer: v.manufacturer || null,
    modelNumber: v.modelNumber || null,
    serialNumber: v.serialNumber || null,
    location: v.location || null,
    propertyId: v.propertyId || null,
    purchaseDate: v.purchaseDate ? new Date(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice === "" || v.purchasePrice === undefined ? null : Number(v.purchasePrice),
    installDate: v.installDate ? new Date(v.installDate) : null,
    notes: v.notes || null,
  }
}

export async function createEquipment(data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.equipment.create({ data: clean(parsed.data) })
  revalidatePath("/assets/equipment")
  return { success: true }
}

export async function updateEquipment(id: string, data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.equipment.update({ where: { id }, data: clean(parsed.data) })
  revalidatePath("/assets/equipment")
  revalidatePath(`/assets/equipment/${id}`)
  return { success: true }
}

export async function deleteEquipment(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  await deleteAssetWithRecords("EQUIPMENT", id)

  revalidatePath("/assets/equipment")
  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/maintenance")
  return { success: true }
}
