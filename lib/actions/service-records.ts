"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { assetHref } from "@/lib/assets"
import type { AssetType } from "@/app/generated/prisma/client"
import { redirect } from "next/navigation"
import { removeUploadDir } from "@/lib/upload-fs"
import {
  cleanServiceRecord, newServiceRecordWrites, prepareNewServiceRecord, revalidateNewServiceRecord, serviceRecordSchema,
  withProviderVendor, type ServiceRecordInput,
} from "@/lib/service-record-server"

export async function createServiceRecord(data: ServiceRecordInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const prepared = await prepareNewServiceRecord(data, session.user.id)
  if ("error" in prepared) return { error: prepared.error }

  const [record] = await prisma.$transaction([...newServiceRecordWrites(prepared.ok)])
  revalidateNewServiceRecord(prepared.ok)
  return { success: true, id: record.id }
}

export async function updateServiceRecord(id: string, data: ServiceRecordInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = serviceRecordSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  await prisma.serviceRecord.update({ where: { id }, data: await withProviderVendor(cleanServiceRecord(parsed.data, session.user.id)) })
  revalidatePath(assetHref(parsed.data.assetType, parsed.data.assetId))
  revalidatePath("/records")
  return { success: true }
}

export async function deleteServiceRecord(id: string, assetType: AssetType, assetId: string) {
  const session = await auth()
  if (!session) redirect("/login")

  // Look the record up first: the id arrives from the client and must be proven
  // real before it is used to build a directory path.
  const record = await prisma.serviceRecord.findUnique({ where: { id }, select: { id: true } })
  if (!record) return { error: "Not found" }

  await prisma.serviceRecord.delete({ where: { id: record.id } })
  await removeUploadDir("service", record.id)

  revalidatePath(assetHref(assetType, assetId))
  revalidatePath("/records")
  return { success: true }
}
