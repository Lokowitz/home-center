import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { createFormatter, DEFAULT_REGIONAL, type Formatter, type Regional } from "@/lib/regional"

export const REGIONAL_SETTINGS_ID = "singleton"

let warned = false

/** The household's regional settings, or the defaults when nobody has saved them. Once per request. */
export const loadRegionalSettings = cache(async (): Promise<Regional> => {
  try {
    const row = await prisma.regionalSettings.findUnique({ where: { id: REGIONAL_SETTINGS_ID } })
    if (!row) return DEFAULT_REGIONAL
    const { currency, distanceUnit, areaUnit, dateFormat, hour12 } = row
    return { currency, distanceUnit, areaUnit, dateFormat, hour12 }
  } catch (error) {
    if (!warned) console.error("[regional] settings unreadable, using defaults:", error instanceof Error ? error.name : typeof error)
    warned = true
    return DEFAULT_REGIONAL
  }
})

export async function getFormat(): Promise<Formatter> {
  return createFormatter(await loadRegionalSettings())
}
