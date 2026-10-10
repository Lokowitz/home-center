"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce.number().int().min(1900).max(2100),
  vin: z.string().optional(),
  color: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.coerce.number().optional().or(z.literal("")),
  currentMileage: z.coerce.number().int().min(0).optional().or(z.literal("")),
  meterUnit: z.enum(["MILES", "HOURS"]).default("MILES"),
  notes: z.string().optional(),
})

function clean(v: z.infer<typeof schema>) {
  return {
    name: v.name,
    make: v.make,
    model: v.model,
    year: Number(v.year),
    vin: v.vin || null,
    color: v.color || null,
    purchaseDate: v.purchaseDate ? new Date(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice === "" || v.purchasePrice === undefined ? null : Number(v.purchasePrice),
    currentMileage: v.currentMileage === "" || v.currentMileage === undefined ? null : Number(v.currentMileage),
    meterUnit: v.meterUnit,
    notes: v.notes || null,
  }
}

export async function createVehicle(data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const row = await prisma.vehicle.create({ data: clean(parsed.data) })
  revalidatePath("/assets/vehicles")
  return { success: true, id: row.id }
}

export async function updateVehicle(id: string, data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.vehicle.update({ where: { id }, data: clean(parsed.data) })
  revalidatePath("/assets/vehicles")
  revalidatePath(`/assets/vehicles/${id}`)
  return { success: true }
}

export async function deleteVehicle(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  await deleteAssetWithRecords("VEHICLE", id)

  revalidatePath("/assets/vehicles")
  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/maintenance")
  return { success: true }
}
