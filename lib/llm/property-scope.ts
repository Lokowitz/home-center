import type { AssetType } from "@/app/generated/prisma/client"
import {
  assetInScope, equipmentScopeWhere, notificationScopeWhere, ownedScopeWhere, personChildScopeWhere, personScopeWhere,
  policyScopeWhere, propertyScopeWhere, roomScopeWhere, vehicleScopeWhere, type PropertyScope,
} from "@/lib/property-filter"
import type { EntityKey, Row } from "./ontology"
import type { ToolContext } from "./query"
import type { AssetNames } from "./asset-ids"

// The property filter for the assistant's queries. The chat route loads the
// scope once per request and passes it in ToolContext; nothing here reads the cookie.

/** What the property filter adds to every query of an entity. {} without a scope. */
export function entityScopeWhere(entity: EntityKey, ctx: Pick<ToolContext, "scope" | "hiddenEntityIds">): Row {
  const scope = ctx.scope ?? null
  if (!scope) return {}
  switch (entity) {
    case "property":
      return propertyScopeWhere(scope)
    case "vehicle":
      return vehicleScopeWhere(scope)
    case "equipment":
      return equipmentScopeWhere(scope)
    case "person":
      return personScopeWhere(scope)
    case "room":
      return roomScopeWhere(scope)
    case "healthCondition":
    case "medication":
    case "allergy":
    case "immunization":
    case "observation":
      return personChildScopeWhere(scope)
    case "serviceRecord":
    case "warranty":
    case "maintenanceSchedule":
      return ownedScopeWhere(scope)
    case "insurancePolicy":
      return policyScopeWhere(scope)
    case "insurancePremium":
    case "insuranceCoverage":
      return { policy: { is: policyScopeWhere(scope) } }
    case "roomPaint":
      return { room: { is: roomScopeWhere(scope) } }
    case "notification":
      return notificationScopeWhere(ctx.hiddenEntityIds ?? [])
    case "provider":
      return {}
  }
}

/** A fragment as a list to spread into an AND: none when it's empty, so no scope means today's query. */
export const nonEmpty = (fragment: Row): Row[] => (Object.keys(fragment).length ? [fragment] : [])

/** where ANDed with a scope fragment; where itself when the fragment is empty, so no scope means today's query. */
export function withScope<W extends object, F extends object>(where: W, fragment: F): W | { AND: (W | F)[] } {
  return Object.keys(fragment).length ? { AND: [where, fragment] } : where
}

/** Asset names without the ones the scope hides, for name and id lookups. The same object without a scope. */
export function scopedNames(names: AssetNames, scope: PropertyScope | null | undefined): AssetNames {
  if (!scope) return names
  const keep = (type: AssetType) => Object.fromEntries(Object.entries(names[type]).filter(([id]) => assetInScope(scope, type, id)))
  return { PROPERTY: keep("PROPERTY"), VEHICLE: keep("VEHICLE"), EQUIPMENT: keep("EQUIPMENT"), PERSON: keep("PERSON") }
}
