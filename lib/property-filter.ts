import type { AssetType, Prisma } from "@/app/generated/prisma/client"

export type PropertyScope = {
  propertyId: string
  propertyName: string
  /** Equipment assigned to some other property. */
  hiddenEquipmentIds: string[]
  /** Linked-only rule; empty when no vehicle is linked to the property. */
  hiddenVehicleIds: string[]
  /** Linked-only rule; empty when no person is linked to the property. */
  hiddenPersonIds: string[]
}

type Linked = { id: string; propertyId: string | null }

export const PROPERTY_FILTER_COOKIE = "hc-property"

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The selected property id from the cookie value, or null for "All properties". */
export function readPropertyFilter(value: string | undefined): string | null {
  if (!value || value === "all" || !ID_PATTERN.test(value)) return null
  return value
}

export function propertyFilterCookie(propertyId: string | null): string {
  if (propertyId === null) return `${PROPERTY_FILTER_COOKIE}=; path=/; max-age=0; samesite=lax`
  return `${PROPERTY_FILTER_COOKIE}=${propertyId}; path=/; max-age=31536000; samesite=lax`
}

/**
 * Linked-only rule for vehicles and people: when none is linked to the
 * property nothing is hidden; once any is, every row not linked to it is.
 */
export function linkedOnlyHidden(rows: Linked[], propertyId: string): string[] {
  if (!rows.some((r) => r.propertyId === propertyId)) return []
  return rows.filter((r) => r.propertyId !== propertyId).map((r) => r.id)
}

export function buildScope(input: {
  property: { id: string; name: string }
  equipment: Linked[]
  vehicles: Linked[]
  people: Linked[]
}): PropertyScope {
  const { property } = input
  return {
    propertyId: property.id,
    propertyName: property.name,
    hiddenEquipmentIds: input.equipment
      .filter((e) => e.propertyId !== null && e.propertyId !== property.id)
      .map((e) => e.id),
    hiddenVehicleIds: linkedOnlyHidden(input.vehicles, property.id),
    hiddenPersonIds: linkedOnlyHidden(input.people, property.id),
  }
}

export function assetInScope(scope: PropertyScope | null, assetType: AssetType, assetId: string): boolean {
  if (!scope) return true
  switch (assetType) {
    case "PROPERTY":
      return assetId === scope.propertyId
    case "EQUIPMENT":
      return !scope.hiddenEquipmentIds.includes(assetId)
    case "VEHICLE":
      return !scope.hiddenVehicleIds.includes(assetId)
    case "PERSON":
      return !scope.hiddenPersonIds.includes(assetId)
  }
}

type ScopeClause = { OR: ({ assetType: { not: AssetType } } | { assetId: string | { notIn: string[] } })[] }

/** Where fragment for rows that point at an asset (assetType + assetId). Empty id lists drop their clause. */
export function ownedScopeWhere(scope: PropertyScope | null): { AND?: ScopeClause[] } {
  if (!scope) return {}
  const clauses: ScopeClause[] = [
    { OR: [{ assetType: { not: "PROPERTY" } }, { assetId: scope.propertyId }] },
  ]
  const lists: [AssetType, string[]][] = [
    ["EQUIPMENT", scope.hiddenEquipmentIds],
    ["VEHICLE", scope.hiddenVehicleIds],
    ["PERSON", scope.hiddenPersonIds],
  ]
  for (const [type, ids] of lists) {
    if (ids.length > 0) clauses.push({ OR: [{ assetType: { not: type } }, { assetId: { notIn: ids } }] })
  }
  return { AND: clauses }
}

export function propertyScopeWhere(scope: PropertyScope | null): Prisma.PropertyWhereInput {
  return scope ? { id: scope.propertyId } : {}
}

export function equipmentScopeWhere(scope: PropertyScope | null): Prisma.EquipmentWhereInput {
  return scope && scope.hiddenEquipmentIds.length > 0 ? { id: { notIn: scope.hiddenEquipmentIds } } : {}
}

export function vehicleScopeWhere(scope: PropertyScope | null): Prisma.VehicleWhereInput {
  return scope && scope.hiddenVehicleIds.length > 0 ? { id: { notIn: scope.hiddenVehicleIds } } : {}
}

export function personScopeWhere(scope: PropertyScope | null): Prisma.PersonWhereInput {
  return scope && scope.hiddenPersonIds.length > 0 ? { id: { notIn: scope.hiddenPersonIds } } : {}
}

/** Health records (conditions, medications, allergies, immunizations, observations) follow their person. */
export function personChildScopeWhere(scope: PropertyScope | null): { personId?: { notIn: string[] } } {
  return scope && scope.hiddenPersonIds.length > 0 ? { personId: { notIn: scope.hiddenPersonIds } } : {}
}

export function roomScopeWhere(scope: PropertyScope | null): Prisma.RoomWhereInput {
  return scope ? { propertyId: scope.propertyId } : {}
}

/** Policies linked to nothing stay visible; otherwise one visible link is enough. */
export function policyScopeWhere(scope: PropertyScope | null): Prisma.InsurancePolicyWhereInput {
  if (!scope) return {}
  return {
    OR: [
      { properties: { none: {} }, vehicles: { none: {} }, members: { none: {} } },
      { properties: { some: { id: scope.propertyId } } },
      { vehicles: { some: { id: { notIn: scope.hiddenVehicleIds } } } },
      { members: { some: { id: { notIn: scope.hiddenPersonIds } } } },
    ],
  }
}

/** Attachments to hide: documents on hidden assets, files on hidden owners, rooms elsewhere, hidden policies and hidden people's health records. */
export function attachmentOutOfScopeWhere(scope: PropertyScope): Prisma.AttachmentWhereInput {
  const owned = ownedScopeWhere(scope)
  const hiddenPeople = { personId: { in: scope.hiddenPersonIds } }
  const or: Prisma.AttachmentWhereInput[] = [
    { recordType: "DOCUMENT", NOT: owned },
    { serviceRecord: { is: { NOT: owned } } },
    { warranty: { is: { NOT: owned } } },
    { maintenanceSchedule: { is: { NOT: owned } } },
    { room: { is: { propertyId: { not: scope.propertyId } } } },
    { insurancePolicy: { is: { NOT: policyScopeWhere(scope) } } },
  ]
  if (scope.hiddenPersonIds.length > 0) {
    or.push(
      { healthCondition: { is: hiddenPeople } },
      { medication: { is: hiddenPeople } },
      { allergy: { is: hiddenPeople } },
      { immunization: { is: hiddenPeople } },
      { observation: { is: hiddenPeople } },
    )
  }
  return { OR: or }
}

/** notIn alone drops SQL NULL, so rows without a related entity are kept explicitly. */
export function notificationScopeWhere(hiddenEntityIds: string[]): Prisma.NotificationWhereInput {
  if (hiddenEntityIds.length === 0) return {}
  return { OR: [{ relatedEntityId: null }, { relatedEntityId: { notIn: hiddenEntityIds } }] }
}

/** Chosen ids plus every current id the user couldn't see, so saving a filtered list doesn't drop hidden links. */
export function keepHiddenLinks(currentIds: string[], chosenIds: string[], visibleIds: string[]): string[] {
  const hidden = currentIds.filter((id) => !visibleIds.includes(id))
  return [...new Set([...chosenIds, ...hidden])]
}

export function filteredEmptyText(scope: PropertyScope | null): string | null {
  if (!scope) return null
  return `Nothing here for ${scope.propertyName}. Switch to All properties to see everything.`
}

/**
 * Property a new vehicle or person starts on: the selected one, but only once
 * something is already linked to it. Linking the first one would turn on the
 * linked-only rule and hide every other row.
 */
export function newItemPropertyId(scope: PropertyScope | null, rows: { propertyId: string | null }[]): string | null {
  return scope && rows.some((r) => r.propertyId === scope.propertyId) ? scope.propertyId : null
}

/** undefined: field not sent, leave the link alone. "": clear it. An id: set it. */
export function propertyLinkWrite(value: string | undefined): { propertyId?: string | null } {
  if (value === undefined) return {}
  return { propertyId: value === "" ? null : value }
}
