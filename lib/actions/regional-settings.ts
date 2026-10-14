"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { REGIONAL_SETTINGS_ID } from "@/lib/regional-server"
import { isValidCurrency } from "@/lib/regional"
import { syncEntities } from "@/lib/search/entities/sync-server"

const schema = z.object({
  currency: z.string().refine(isValidCurrency, "Unknown currency code."),
  distanceUnit: z.enum(["MILES", "KM"]),
  areaUnit: z.enum(["SQFT", "SQM"]),
  dateFormat: z.enum(["MDY_SHORT", "DMY_SHORT", "MDY_NUM", "DMY_NUM", "ISO"]),
  hour12: z.boolean(),
})

export async function saveRegionalSettings(data: z.infer<typeof schema>): Promise<{ error: string } | { success: true }> {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  await prisma.regionalSettings.upsert({
    where: { id: REGIONAL_SETTINGS_ID },
    create: { id: REGIONAL_SETTINGS_ID, ...parsed.data },
    update: parsed.data,
  })
  // Every page writes money, units or dates.
  revalidatePath("/", "layout")
  // Search text carries money and unit words; only records whose text changed re-embed.
  void syncEntities().catch(() => {})
  return { success: true }
}
