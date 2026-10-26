"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { assetPolicyLinks } from "@/lib/insurance-server"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { ignoreGone, orGone } from "@/lib/gone"
import { vehicleSchema, vehicleData, type VehicleInput } from "@/lib/vehicle-input"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"

/** A non-empty propertyId must name a real property. */
async function unknownProperty(propertyId: string | undefined) {
  if (!propertyId) return false
  return !(await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } }))
}

const BAD_PROPERTY = { error: { propertyId: ["Pick a property from the list."] } }

export async function createVehicle(data: VehicleInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = vehicleSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (await unknownProperty(parsed.data.propertyId)) return BAD_PROPERTY

  const row = await prisma.vehicle.create({ data: vehicleData(parsed.data) })
  revalidatePath("/assets/vehicles")
  return { success: true, id: row.id }
}

/** `policyIds` is the Insurance list ticked in the dialog; left out, the vehicle's policy links stay as they are. */
export async function updateVehicle(id: string, data: VehicleInput, policyIds?: string[]) {
  const session = await auth()
  if (!session) redirect("/login")
  const scope = await loadPropertyScope()

  const parsed = vehicleSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (await unknownProperty(parsed.data.propertyId)) return BAD_PROPERTY

  const links = policyIds ? await assetPolicyLinks("vehicles", id, policyIds, false, scope) : null
  const saved = await orGone(() => prisma.vehicle.update({
    where: { id },
    data: {
      ...vehicleData(parsed.data),
      ...(links ? { insurancePolicies: { connect: links.connect.map((p) => ({ id: p })), disconnect: links.disconnect.map((p) => ({ id: p })) } } : {}),
    },
  }))
  if (saved) return { error: saved.error }
  revalidatePath("/assets/vehicles")
  revalidatePath(`/assets/vehicles/${id}`)
  if (links) revalidatePath("/insurance")
  return { success: true }
}

export async function deleteVehicle(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  await ignoreGone(() => deleteAssetWithRecords("VEHICLE", id))

  revalidatePath("/assets/vehicles")
  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/maintenance")
  return { success: true }
}
