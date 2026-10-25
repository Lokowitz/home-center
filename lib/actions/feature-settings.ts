"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { FEATURE_SETTINGS_ID } from "@/lib/features-server"

const schema = z.object({ healthEnabled: z.boolean(), roomsEnabled: z.boolean(), equipmentTabEnabled: z.boolean(), propertyFilterEnabled: z.boolean() })

export async function updateFeatureSettings(data: z.infer<typeof schema>): Promise<{ error: string } | { success: true }> {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: "Invalid input." }
  await prisma.featureSettings.upsert({
    where: { id: FEATURE_SETTINGS_ID },
    create: { id: FEATURE_SETTINGS_ID, ...parsed.data },
    update: parsed.data,
  })
  // The nav, the dashboard and the bell all change with it.
  revalidatePath("/", "layout")
  return { success: true }
}
