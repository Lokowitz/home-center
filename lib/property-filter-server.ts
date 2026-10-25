import { cookies } from "next/headers"
import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { loadPropertyFilterEnabled } from "@/lib/features-server"
import {
  PROPERTY_FILTER_COOKIE,
  buildScope,
  ownedScopeWhere,
  policyScopeWhere,
  readPropertyFilter,
  type PropertyScope,
} from "@/lib/property-filter"

/** The selected property's scope, or null (switch off, no cookie, deleted property). Once per request. */
export const loadPropertyScope = cache(async (): Promise<PropertyScope | null> => {
  if (!(await loadPropertyFilterEnabled())) return null
  const propertyId = readPropertyFilter((await cookies()).get(PROPERTY_FILTER_COOKIE)?.value)
  if (!propertyId) return null
  const [property, equipment, vehicles, people] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } }),
    prisma.equipment.findMany({ where: { propertyId: { not: null } }, select: { id: true, propertyId: true } }),
    prisma.vehicle.findMany({ select: { id: true, propertyId: true } }),
    prisma.person.findMany({ select: { id: true, propertyId: true } }),
  ])
  return property ? buildScope({ property, equipment, vehicles, people }) : null
})

/** Ids of schedules, warranties, policies and health records the scope hides (notifications point at them). */
export const loadHiddenEntityIds = cache(async (scope: PropertyScope | null): Promise<string[]> => {
  if (!scope) return []
  const hasHiddenPeople = scope.hiddenPersonIds.length > 0
  const hiddenPeople = { personId: { in: scope.hiddenPersonIds } }
  const lists = await Promise.all([
    prisma.maintenanceSchedule.findMany({ where: { NOT: ownedScopeWhere(scope) }, select: { id: true } }),
    prisma.warranty.findMany({ where: { NOT: ownedScopeWhere(scope) }, select: { id: true } }),
    prisma.insurancePolicy.findMany({ where: { NOT: policyScopeWhere(scope) }, select: { id: true } }),
    hasHiddenPeople ? prisma.medication.findMany({ where: hiddenPeople, select: { id: true } }) : [],
    hasHiddenPeople ? prisma.immunization.findMany({ where: hiddenPeople, select: { id: true } }) : [],
  ])
  return lists.flat().map((r) => r.id)
})

/** Options for the top-bar dropdown: null while the switch is off, only the selected property under a scope. */
export async function loadPropertyFilterChoices(
  scope: PropertyScope | null,
): Promise<{ id: string; name: string }[] | null> {
  if (!(await loadPropertyFilterEnabled())) return null
  return prisma.property.findMany({
    where: scope ? { id: scope.propertyId } : undefined,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })
}
