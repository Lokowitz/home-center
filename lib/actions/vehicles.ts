"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { assetPolicyLinks } from "@/lib/insurance-server"
import { vehicleSchema, vehicleData, type VehicleInput } from "@/lib/vehicle-input"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"

export async function createVehicle(data: VehicleInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = vehicleSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const row = await prisma.vehicle.create({ data: vehicleData(parsed.data) })
  revalidatePath("/assets/vehicles")
  return { success: true, id: row.id }
}

/** `policyIds` is the Insurance list ticked in the dialog; left out, the vehicle's policy links stay as they are. */
export async function updateVehicle(id: string, data: VehicleInput, policyIds?: string[]) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = vehicleSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const links = policyIds ? await assetPolicyLinks("vehicles", id, policyIds, false) : null
  await prisma.vehicle.update({
    where: { id },
    data: {
      ...vehicleData(parsed.data),
      ...(links ? { insurancePolicies: { connect: links.connect.map((p) => ({ id: p })), disconnect: links.disconnect.map((p) => ({ id: p })) } } : {}),
    },
  })
  revalidatePath("/assets/vehicles")
  revalidatePath(`/assets/vehicles/${id}`)
  if (links) revalidatePath("/insurance")
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
