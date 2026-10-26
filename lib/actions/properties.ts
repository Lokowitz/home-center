"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"
import { assetPolicyLinks } from "@/lib/insurance-server"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { ignoreGone, orGone } from "@/lib/gone"
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

/** `policyIds` is the Insurance list ticked in the dialog; left out, the property's policy links stay as they are. */
export async function updateProperty(id: string, data: PropertyInput, policyIds?: string[]) {
  const session = await auth()
  if (!session) redirect("/login")
  const scope = await loadPropertyScope()

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  // A property's policies never depend on Health, so this always looks them up as if it were off.
  const links = policyIds ? await assetPolicyLinks("properties", id, policyIds, false, scope) : null
  const saved = await orGone(() => prisma.property.update({
    where: { id },
    data: {
      ...clean(parsed.data),
      ...(links ? { insurancePolicies: { connect: links.connect.map((p) => ({ id: p })), disconnect: links.disconnect.map((p) => ({ id: p })) } } : {}),
    },
  }))
  if (saved) return { error: saved.error }
  revalidatePath("/assets/properties")
  revalidatePath(`/assets/properties/${id}`)
  if (links) revalidatePath("/insurance")
  return { success: true }
}

export async function deleteProperty(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  await ignoreGone(() => deleteAssetWithRecords("PROPERTY", id))

  revalidatePath("/assets/properties")
  revalidatePath("/assets/equipment")
  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/maintenance")
  return { success: true }
}
