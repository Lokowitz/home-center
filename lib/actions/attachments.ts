"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { attachmentDir } from "@/lib/attachment-location"
import { removeUploadDir } from "@/lib/upload-fs"
import { searchIndex } from "@/lib/documents/indexer-server"

export async function deleteAttachment(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  const attachment = await prisma.attachment.findUnique({ where: { id } })
  if (!attachment) return { error: "Not found" }

  await prisma.attachment.delete({ where: { id } })

  const dir = attachmentDir(attachment)
  if (dir) await removeUploadDir(...dir, attachment.filename)
  // Best effort: reconcile() removes anything left behind.
  await searchIndex().then((index) => index.remove([id])).catch(() => {})

  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/insurance")
  revalidatePath("/assets", "layout")
  return { success: true }
}
