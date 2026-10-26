"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { assetHref } from "@/lib/assets"
import type { AssetType } from "@/app/generated/prisma/client"
import { redirect } from "next/navigation"
import { removeUploadDir } from "@/lib/upload-fs"
import { orGone } from "@/lib/gone"
import { warrantySchema, type WarrantyInput } from "@/lib/warranty-input"
import { parseDateOnly } from "@/lib/input-limits"

function clean(v: WarrantyInput) {
  return {
    assetId: v.assetId,
    assetType: v.assetType,
    productName: v.productName,
    purchaseDate: v.purchaseDate ? parseDateOnly(v.purchaseDate) : null,
    expirationDate: v.expirationDate ? parseDateOnly(v.expirationDate) : null,
    vendor: v.vendor || null,
    vendorPhone: v.vendorPhone || null,
    vendorEmail: v.vendorEmail || null,
    notes: v.notes || null,
  }
}

export async function createWarranty(data: WarrantyInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = warrantySchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const warranty = await prisma.warranty.create({ data: clean(parsed.data) })
  revalidatePath(assetHref(parsed.data.assetType, parsed.data.assetId))
  revalidatePath("/warranties")
  return { success: true, id: warranty.id }
}

export async function updateWarranty(id: string, data: WarrantyInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = warrantySchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const saved = await orGone(() => prisma.warranty.update({ where: { id }, data: clean(parsed.data) }))
  if (saved) return { error: saved.error }
  revalidatePath(assetHref(parsed.data.assetType, parsed.data.assetId))
  revalidatePath("/warranties")
  return { success: true }
}

export async function deleteWarranty(id: string, assetType: AssetType, assetId: string) {
  const session = await auth()
  if (!session) redirect("/login")

  const warranty = await prisma.warranty.findUnique({ where: { id }, select: { id: true } })
  if (!warranty) return { error: "Not found" }

  await prisma.warranty.delete({ where: { id: warranty.id } })
  await removeUploadDir("warranty", warranty.id)

  revalidatePath(assetHref(assetType, assetId))
  revalidatePath("/warranties")
  return { success: true }
}
