import { prisma } from "@/lib/prisma"
import type { AssetType, Prisma } from "@/app/generated/prisma/client"
import { assetHref } from "@/lib/assets"
import { categoryLabel as equipmentCategoryLabel } from "@/components/equipment/categories"
import { categoryLabel as serviceCategoryLabel } from "@/lib/costs"
import {
  ageFrom, ALLERGY_SEVERITIES, CONDITION_STATUSES, INSURANCE_KINDS, insuranceExpiring, isMedicationActive,
  labelFor, RELATIONSHIPS,
} from "@/lib/health"
import { dueBadge, scheduleDue, type MileageIndex } from "@/lib/maintenance-due"
import { warrantyState } from "@/lib/llm/warranty-status"
import { observationHref } from "@/lib/observations"
import { locationLabel, paintLabel } from "@/lib/rooms"
import { searchIndex, semanticSearchModel } from "@/lib/documents/indexer-server"
import { embedderFor } from "@/lib/documents/embed/server"
import { parseSearch } from "@/lib/documents/fts-query"
import { passage } from "@/lib/documents/passage"
import { groupHits } from "@/lib/documents/tool-helpers"
import { healthAttachmentIds, loadDocumentRefs, outOfScopeAttachmentIds } from "@/lib/documents/scope"
import {
  assetInScope, equipmentScopeWhere, ownedScopeWhere, personChildScopeWhere, personScopeWhere, policyScopeWhere, propertyScopeWhere,
  roomScopeWhere, vehicleScopeWhere, type PropertyScope,
} from "@/lib/property-filter"
import { loadFeatures } from "@/lib/features-server"
import { getFormat } from "@/lib/regional-server"
import type { Formatter } from "@/lib/regional"
import type { Features } from "@/lib/features"
import { HEALTH_INSURANCE_KINDS, renewalWindowDays } from "@/lib/insurance"
import type { Hit } from "@/lib/documents/index-db"
import {
  bestPerKey, byTier, idsNamed, matchKind, MAX_RECORD_DISTANCE, mergeSemantic, nearest, rankSections, RECORD_WINDOW, searchTerms,
  semanticOnly, termsWhere, wildcardTermsMatch,
} from "./query"
import type { EntityKind } from "./entities/text"
import type {
  AssetResult, AssetThumb, DocumentResult, Fact, RecordResult, SearchResults, Section, SemanticState, Status,
} from "./types"

// The search behind the header box: every kind of record by keyword, the
// text of uploaded files by keyword, and — unless turned off — records and
// files by meaning, leaving out anything the keyword pass already returned.

const PER_SECTION = 12
const DOC_POOL = 60
const DOC_LIMIT = 10
const WARRANTY_WINDOW_DAYS = 60
/** Record chunks fetched by meaning before grouping, and how many records to show. */
const ENTITY_POOL = 80
const SEMANTIC_RECORD_LIMIT = 24

const moneyWith = (fmt: Formatter) => (n: number | null | undefined) =>
  n == null ? null : Number.isInteger(n) ? fmt.moneyWhole(n) : fmt.money(n)
/** Stored days are shown in UTC: that is the day that was typed. */
const dayWith = (fmt: Formatter) => (d: Date | null | undefined) => (d ? fmt.date(d, { utc: true }) : null)
const clip = (s: string | null | undefined, n = 160) => {
  if (!s) return null
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

/** Facts with no value are left out rather than shown as "—". */
function facts(entries: [string, string | number | null | undefined][]): Fact[] {
  return entries.flatMap(([label, value]) => (value == null || value === "" ? [] : [{ label, value: String(value) }]))
}

const tabHref = (type: AssetType, id: string, tab: string, open?: string) =>
  `${assetHref(type, id)}?tab=${tab}${open ? `&open=${open}` : ""}`

/** Splits a take-one-extra result into the rows to show and whether more exist. */
function page<T>(rows: T[]): { items: T[]; more: boolean } {
  return { items: rows.slice(0, PER_SECTION), more: rows.length > PER_SECTION }
}
const TAKE = PER_SECTION + 1
/** Rows fetched per type when searching by words, so exact matches can be ranked ahead of partial ones. */
const KEYWORD_POOL = 60

async function loadOwners() {
  const select = { id: true, name: true, imageFilename: true } as const
  const [properties, vehicles, equipment, people] = await Promise.all([
    prisma.property.findMany({ select }),
    prisma.vehicle.findMany({ select }),
    prisma.equipment.findMany({ select }),
    prisma.person.findMany({ select }),
  ])
  const thumbs = new Map<string, AssetThumb>()
  const names: Record<AssetType, Record<string, string>> = { PROPERTY: {}, VEHICLE: {}, EQUIPMENT: {}, PERSON: {} }
  const add = (type: AssetType, rows: { id: string; name: string; imageFilename: string | null }[]) => {
    for (const r of rows) {
      thumbs.set(r.id, { type, id: r.id, name: r.name, imageFilename: r.imageFilename, href: assetHref(type, r.id) })
      names[type][r.id] = r.name
    }
  }
  add("PROPERTY", properties)
  add("VEHICLE", vehicles)
  add("EQUIPMENT", equipment)
  add("PERSON", people)
  const allNames = { ...names.PROPERTY, ...names.VEHICLE, ...names.EQUIPMENT, ...names.PERSON }
  return { thumbs, names, allNames }
}

type Owners = Awaited<ReturnType<typeof loadOwners>>

/** Maintenance and last-service facts shared by every asset card. */
async function assetUpkeep(ids: string[], mileage: MileageIndex, now: Date) {
  if (!ids.length) return { status: new Map<string, Status>(), lastService: new Map<string, Date>() }
  const [schedules, services] = await Promise.all([
    prisma.maintenanceSchedule.findMany({
      where: { assetId: { in: ids }, isActive: true },
      select: { assetType: true, assetId: true, nextDueDate: true, nextDueMileage: true, reminderDaysBefore: true, reminderMilesBefore: true },
    }),
    prisma.serviceRecord.groupBy({ by: ["assetId"], where: { assetId: { in: ids } }, _max: { date: true } }),
  ])
  const counts = new Map<string, { overdue: number; soon: number }>()
  for (const s of schedules) {
    const due = scheduleDue(s, mileage, now)
    const c = counts.get(s.assetId) ?? { overdue: 0, soon: 0 }
    if (due.overdue) c.overdue++
    else if (due.dueSoon) c.soon++
    counts.set(s.assetId, c)
  }
  const status = new Map<string, Status>()
  for (const [id, c] of counts) {
    if (c.overdue) status.set(id, { label: `${c.overdue} overdue`, tone: "destructive" })
    else if (c.soon) status.set(id, { label: `${c.soon} due soon`, tone: "secondary" })
  }
  const lastService = new Map(services.flatMap((s) => (s._max.date ? [[s.assetId, s._max.date] as const] : [])))
  return { status, lastService }
}

/** One filter per searchable model; the same card builders serve keyword and semantic results. */
type Wheres = {
  property: Prisma.PropertyWhereInput
  vehicle: Prisma.VehicleWhereInput
  equipment: Prisma.EquipmentWhereInput
  person: Prisma.PersonWhereInput
  service: Prisma.ServiceRecordWhereInput
  maintenance: Prisma.MaintenanceScheduleWhereInput
  warranty: Prisma.WarrantyWhereInput
  insurance: Prisma.InsurancePolicyWhereInput
  provider: Prisma.ProviderWhereInput
  condition: Prisma.HealthConditionWhereInput
  medication: Prisma.MedicationWhereInput
  allergy: Prisma.AllergyWhereInput
  immunization: Prisma.ImmunizationWhereInput
  observation: Prisma.ObservationWhereInput
  room: Prisma.RoomWhereInput
}

/** The text fields keyword search looks in, per model; also what decides an exact match. */
const FIELDS = {
  property: ["name", "address", "notes"],
  vehicle: ["name", "make", "model", "vin", "color", "notes"],
  equipment: ["name", "manufacturer", "modelNumber", "serialNumber", "location", "notes"],
  person: ["name", "notes"],
  service: ["title", "description", "vendor"],
  maintenance: ["title", "description"],
  warranty: ["productName", "vendor", "notes"],
  insurance: ["carrier", "planName", "policyNumber", "groupNumber", "memberId", "notes"],
  provider: ["name", "specialty", "practice", "phone", "email", "address", "notes"],
  condition: ["name", "notes"],
  medication: ["name", "dosage", "frequency", "pharmacy", "notes"],
  allergy: ["substance", "reaction", "notes"],
  immunization: ["vaccine", "dose", "givenBy", "notes"],
  observation: ["type", "notes", "tags"],
  room: ["name", "level", "flooringType", "flooringProduct", "notes"],
} as const

/** A room's paint fields keyword search also looks in. */
const PAINT_FIELDS = ["brand", "colorName", "colorCode"] as const

/** Like termsWhere, with `also(term)` as more places each term may match (fields of related rows). */
const termsWhereAlso = <W>(terms: string[], fields: readonly string[], also: (term: string) => Record<string, unknown>[]): W =>
  ({ AND: terms.map((t) => ({ OR: [...fields.map((f) => ({ [f]: { contains: t } })), ...also(t)] })) }) as W

export function keywordWheres(terms: string[], owners: Owners, health: boolean, scope: PropertyScope | null): Wheres {
  // Hidden owners' names don't find their policies.
  const named = (type: AssetType, t: string) => idsNamed(owners.names[type], t).filter((id) => assetInScope(scope, type, id))
  const onAsset = { ownerIds: (t: string) => idsNamed(owners.allNames, t), ownerClause: (ids: string[]) => ({ assetId: { in: ids } }) }
  const onPerson = { ownerIds: (t: string) => idsNamed(owners.names.PERSON, t), ownerClause: (ids: string[]) => ({ personId: { in: ids } }) }
  return {
    property: termsWhere(terms, FIELDS.property),
    vehicle: termsWhere(terms, FIELDS.vehicle),
    // Room-linked equipment has no location of its own; its room's name stands in.
    equipment: termsWhereAlso(terms, FIELDS.equipment, (t) => [{ room: { name: { contains: t } } }]),
    person: termsWhere(terms, FIELDS.person),
    service: termsWhere(terms, FIELDS.service, onAsset),
    maintenance: termsWhere(terms, FIELDS.maintenance, onAsset),
    warranty: termsWhere(terms, FIELDS.warranty, onAsset),
    insurance: termsWhere(
      terms,
      FIELDS.insurance,
      {
        // A policy is found by the property or vehicle it covers, and by its people only with Health on.
        ownerIds: (t: string) => [
          ...named("PROPERTY", t),
          ...named("VEHICLE", t),
          ...(health ? named("PERSON", t) : []),
        ],
        ownerClause: (ids: string[]) => ({
          OR: [
            { properties: { some: { id: { in: ids } } } },
            { vehicles: { some: { id: { in: ids } } } },
            { members: { some: { id: { in: ids } } } },
          ],
        }),
      }
    ),
    provider: termsWhere(terms, FIELDS.provider),
    condition: termsWhere(terms, FIELDS.condition, onPerson),
    medication: termsWhere(terms, FIELDS.medication, onPerson),
    allergy: termsWhere(terms, FIELDS.allergy, onPerson),
    immunization: termsWhere(terms, FIELDS.immunization, onPerson),
    observation: termsWhere(terms, FIELDS.observation, onPerson),
    room: termsWhereAlso(terms, FIELDS.room, (t) => [{ paints: { some: { OR: PAINT_FIELDS.map((f) => ({ [f]: { contains: t } })) } } }]),
  }
}

/** A row's searched fields, plus any other text that can satisfy a term (its owner's name). */
const textsOf = <T, K extends keyof T>(row: T, fields: readonly K[], ...more: (string | null | undefined)[]) =>
  [...fields.map((f) => row[f] as unknown as string | null), ...more]

/**
 * Exact or partial match per row id, filled in by `rank` while searching by
 * words. Empty for the meaning pass, which marks its own results.
 */
function matchKinds(terms: string[]) {
  const kinds = new Map<string, "exact" | "partial">()
  return {
    /** Exact matches first, so partial ones don't push them past the section's limit. */
    rank<T extends { id: string }>(rows: T[], texts: (row: T) => (string | null | undefined)[]): T[] {
      if (!terms.length) return rows
      rows = rows.filter((r) => wildcardTermsMatch(terms, texts(r)))
      for (const r of rows) kinds.set(r.id, matchKind(terms, texts(r)))
      const tier = (r: T) => (kinds.get(r.id) === "exact" ? 0 : 1)
      return [...rows].sort((a, b) => tier(a) - tier(b))
    },
    mark(sections: Section[]): Section[] {
      if (!terms.length) return sections
      return sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, matchedBy: kinds.get((i as { id: string }).id) })) }) as Section)
    },
  }
}

const NOTHING = { id: { in: [] as string[] } }

/** Health's record kinds, as the search index names them. */
const HEALTH_KINDS = new Set<EntityKind>(["PERSON", "PROVIDER", "CONDITION", "MEDICATION", "ALLERGY", "IMMUNIZATION", "OBSERVATION"])

/**
 * With Health off: no people, providers, health insurance or health records, and nothing a person owns.
 * With Rooms off: no rooms.
 */
function withFeatures(all: Wheres, features: Features): Wheres {
  const w = features.rooms ? all : { ...all, room: NOTHING }
  if (features.health) return w
  const notPerson = { assetType: { not: "PERSON" as const } }
  return {
    ...w,
    person: NOTHING, provider: NOTHING, condition: NOTHING, medication: NOTHING,
    allergy: NOTHING, immunization: NOTHING, observation: NOTHING,
    insurance: { AND: [w.insurance, { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } }] },
    service: { AND: [w.service, notPerson] },
    maintenance: { AND: [w.maintenance, notPerson] },
    warranty: { AND: [w.warranty, notPerson] },
  }
}

/** With the property filter on: only what belongs to the selected property. Providers aren't tied to one. */
export function withPropertyScope(all: Wheres, scope: PropertyScope | null): Wheres {
  if (!scope) return all
  const owned = ownedScopeWhere(scope)
  const personChild = personChildScopeWhere(scope)
  return {
    ...all,
    property: { AND: [all.property, propertyScopeWhere(scope)] },
    vehicle: { AND: [all.vehicle, vehicleScopeWhere(scope)] },
    equipment: { AND: [all.equipment, equipmentScopeWhere(scope)] },
    person: { AND: [all.person, personScopeWhere(scope)] },
    service: { AND: [all.service, owned] },
    maintenance: { AND: [all.maintenance, owned] },
    warranty: { AND: [all.warranty, owned] },
    insurance: { AND: [all.insurance, policyScopeWhere(scope)] },
    condition: { AND: [all.condition, personChild] },
    medication: { AND: [all.medication, personChild] },
    allergy: { AND: [all.allergy, personChild] },
    immunization: { AND: [all.immunization, personChild] },
    observation: { AND: [all.observation, personChild] },
    // A room's paint is searched through its room, so this covers paint too.
    room: { AND: [all.room, roomScopeWhere(scope)] },
  }
}

/** Exactly these records, by the entity kinds the search index stores them under. */
function idWheres(ids: Map<EntityKind, string[]>): Wheres {
  const of = (kind: EntityKind) => ({ id: { in: ids.get(kind) ?? [] } })
  return {
    property: of("PROPERTY"), vehicle: of("VEHICLE"), equipment: of("EQUIPMENT"), person: of("PERSON"),
    service: of("SERVICE"), maintenance: of("MAINTENANCE"), warranty: of("WARRANTY"), insurance: of("INSURANCE"),
    provider: of("PROVIDER"), condition: of("CONDITION"), medication: of("MEDICATION"), allergy: of("ALLERGY"),
    immunization: of("IMMUNIZATION"), observation: of("OBSERVATION"), room: of("ROOM"),
  }
}

const RECORD_ENTITY: Record<RecordResult["kind"], EntityKind> = {
  service: "SERVICE", visit: "SERVICE", maintenance: "MAINTENANCE", warranty: "WARRANTY", insurance: "INSURANCE",
  provider: "PROVIDER", condition: "CONDITION", medication: "MEDICATION", allergy: "ALLERGY",
  immunization: "IMMUNIZATION", observation: "OBSERVATION", room: "ROOM",
}

/** "KIND:id" as the search index keys records; null for documents. */
function entityKeyOf(section: Section, item: Section["items"][number]): string | null {
  if (section.layout === "assets") return `${(item as AssetResult).type}:${(item as AssetResult).id}`
  if (section.layout === "records") return `${RECORD_ENTITY[(item as RecordResult).kind]}:${(item as RecordResult).id}`
  return null
}

/** Records by meaning: nearest record chunks, minus anything the keyword pass already showed, best first. */
async function semanticRecords(
  vector: number[], shown: Set<string>, owners: Owners, now: Date, features: Features, scope: PropertyScope | null,
): Promise<Section[]> {
  const all = await (await searchIndex()).entityVectorSearch(vector, ENTITY_POOL)
  // Dropped before ranking so hidden kinds don't take up places.
  const hits = all.filter((h) => (features.health || !HEALTH_KINDS.has(h.kind as EntityKind)) && (features.rooms || h.kind !== "ROOM"))
  const best = bestPerKey(hits.map((h) => ({ key: `${h.kind}:${h.entityId}`, score: h.score })))
  const kept = nearest(best, shown, MAX_RECORD_DISTANCE, RECORD_WINDOW).slice(0, SEMANTIC_RECORD_LIMIT)
  if (!kept.length) return []
  const rank = new Map(kept.map((h, i) => [h.key, i]))
  const ids = new Map<EntityKind, string[]>()
  for (const { key } of kept) {
    const at = key.indexOf(":")
    const kind = key.slice(0, at) as EntityKind
    ids.set(kind, [...(ids.get(kind) ?? []), key.slice(at + 1)])
  }
  const where = withPropertyScope(withFeatures(idWheres(ids), features), scope)
  const [assets, records] = await Promise.all([searchAssets(where, now, []), searchRecords(where, owners, now, [], features.health, scope)])
  const byRank = (section: Section) => (item: Section["items"][number]) => rank.get(entityKeyOf(section, item) ?? "") ?? Infinity
  return [...assets, ...records]
    .filter((sec) => sec.items.length > 0)
    .map((sec) => {
      const r = byRank(sec)
      const items = [...sec.items].sort((a, b) => r(a) - r(b)).map((item) => ({ ...item, matchedBy: "semantic" as const }))
      return { ...sec, items, more: false } as Section
    })
}

/** `terms` empty for the meaning pass; otherwise rows are ranked and marked exact or partial. */
async function searchAssets(where: Wheres, now: Date, terms: string[]): Promise<Section[]> {
  const fmt = await getFormat()
  const money = moneyWith(fmt)
  const day = dayWith(fmt)
  const take = terms.length ? KEYWORD_POOL : TAKE
  const kinds = matchKinds(terms)
  const [properties, vehicles, equipment, people] = await Promise.all([
    prisma.property.findMany({
      where: where.property,
      include: { _count: { select: { equipment: true } } },
      orderBy: { name: "asc" },
      take,
    }),
    prisma.vehicle.findMany({
      where: where.vehicle,
      orderBy: { name: "asc" },
      take,
    }),
    prisma.equipment.findMany({
      where: where.equipment,
      include: { property: { select: { name: true } }, room: { select: { name: true } } },
      orderBy: { name: "asc" },
      take,
    }),
    prisma.person.findMany({
      where: where.person,
      include: {
        primaryProvider: { select: { name: true } },
        medications: { select: { endDate: true } },
        conditions: { where: { status: { not: "RESOLVED" } }, select: { id: true } },
      },
      orderBy: { name: "asc" },
      take,
    }),
  ])

  const mileage: MileageIndex = new Map(
    vehicles.flatMap((v) => (v.currentMileage != null ? [[v.id, { value: v.currentMileage, unit: v.meterUnit }] as const] : []))
  )
  const upkeep = await assetUpkeep(
    [...properties, ...vehicles, ...equipment, ...people].map((a) => a.id),
    mileage,
    now
  )
  const last = (id: string) => day(upkeep.lastService.get(id))

  const p = page(kinds.rank(properties, (r) => textsOf(r, FIELDS.property)))
  const v = page(kinds.rank(vehicles, (r) => textsOf(r, FIELDS.vehicle)))
  const e = page(kinds.rank(equipment, (r) => textsOf(r, FIELDS.equipment, r.room?.name)))
  const pp = page(kinds.rank(people, (r) => textsOf(r, FIELDS.person)))

  const propertyCards: AssetResult[] = p.items.map((r) => ({
    type: "PROPERTY", id: r.id, href: assetHref("PROPERTY", r.id), name: r.name, imageFilename: r.imageFilename,
    badge: labelFor([
      { value: "HOUSE", label: "House" }, { value: "CONDO", label: "Condo" }, { value: "TOWNHOUSE", label: "Townhouse" },
      { value: "LOT", label: "Lot / Land" }, { value: "OTHER", label: "Other" },
    ], r.type),
    subtitle: r.address,
    facts: facts([
      ["Built", r.yearBuilt],
      ["Size", r.sqFt ? fmt.area(r.sqFt) : null],
      ["Purchased", money(r.purchasePrice)],
      ["Equipment", r._count.equipment || null],
      ["Last service", last(r.id)],
    ]),
    status: upkeep.status.get(r.id) ?? null,
  }))

  const vehicleCards: AssetResult[] = v.items.map((r) => ({
    type: "VEHICLE", id: r.id, href: assetHref("VEHICLE", r.id), name: r.name, imageFilename: r.imageFilename,
    badge: String(r.year),
    subtitle: `${r.year} ${r.make} ${r.model}`,
    facts: facts([
      [fmt.meterNoun(r.meterUnit), r.currentMileage != null ? `${r.currentMileage.toLocaleString()} ${fmt.meterShort(r.meterUnit)}` : null],
      ["Color", r.color],
      ["VIN", r.vin ? `…${r.vin.slice(-6)}` : null],
      ["Last service", last(r.id)],
    ]),
    status: upkeep.status.get(r.id) ?? null,
  }))

  const equipmentCards: AssetResult[] = e.items.map((r) => ({
    type: "EQUIPMENT", id: r.id, href: assetHref("EQUIPMENT", r.id), name: r.name, imageFilename: r.imageFilename,
    badge: equipmentCategoryLabel(r.category),
    subtitle: [r.manufacturer, r.modelNumber].filter(Boolean).join(" · ") || null,
    facts: facts([
      ["Property", r.property?.name],
      ["Location", locationLabel(r)],
      ["Serial", r.serialNumber],
      ["Installed", day(r.installDate)],
      ["Last service", last(r.id)],
    ]),
    status: upkeep.status.get(r.id) ?? null,
  }))

  const personCards: AssetResult[] = pp.items.map((r) => ({
    type: "PERSON", id: r.id, href: assetHref("PERSON", r.id), name: r.name, imageFilename: r.imageFilename,
    badge: labelFor(RELATIONSHIPS, r.relationship),
    subtitle: r.dateOfBirth ? `Age ${ageFrom(r.dateOfBirth, now)}` : null,
    facts: facts([
      ["Primary care", r.primaryProvider?.name],
      ["Blood type", r.bloodType],
      ["Medications", r.medications.filter((m) => isMedicationActive(m, now)).length || null],
      ["Open conditions", r.conditions.length || null],
      ["Last visit", last(r.id)],
    ]),
    status: upkeep.status.get(r.id) ?? null,
  }))

  return kinds.mark([
    { key: "properties", title: "Properties", layout: "assets", items: propertyCards, more: p.more },
    { key: "vehicles", title: "Vehicles", layout: "assets", items: vehicleCards, more: v.more },
    { key: "equipment", title: "Equipment", layout: "assets", items: equipmentCards, more: e.more },
    { key: "people", title: "People", layout: "assets", items: personCards, more: pp.more },
  ])
}

/** A policy's people, properties and vehicles, leaving out any the property filter hides. */
export function policyInclude(scope: PropertyScope | null) {
  const byName = { select: { name: true }, orderBy: { name: "asc" as const } }
  return {
    members: { ...byName, where: personScopeWhere(scope) },
    properties: { ...byName, where: propertyScopeWhere(scope) },
    vehicles: { ...byName, where: vehicleScopeWhere(scope) },
  } satisfies Prisma.InsurancePolicyInclude
}

/** `terms` empty for the meaning pass; otherwise rows are ranked and marked exact or partial. */
async function searchRecords(
  where: Wheres, owners: Owners, now: Date, terms: string[], showPeople: boolean, scope: PropertyScope | null,
): Promise<Section[]> {
  const fmt = await getFormat()
  const money = moneyWith(fmt)
  const day = dayWith(fmt)
  const thumb = (id: string) => owners.thumbs.get(id) ?? null
  const take = terms.length ? KEYWORD_POOL : TAKE
  const kinds = matchKinds(terms)
  // An owner's name can stand in for a term ("civic oil"), so it counts toward an exact match too.
  const assetName = (id: string) => owners.allNames[id]
  const personName = (id: string) => owners.names.PERSON[id]

  const [
    services, visits, schedules, warranties, policies, providers,
    conditions, medications, allergies, immunizations, observations, rooms, mileage,
  ] = await Promise.all([
    prisma.serviceRecord.findMany({
      where: { AND: [where.service, { assetType: { not: "PERSON" } }] },
      orderBy: { date: "desc" },
      take,
    }),
    prisma.serviceRecord.findMany({
      where: { AND: [where.service, { assetType: "PERSON" }] },
      include: { provider: { select: { name: true } }, condition: { select: { name: true } } },
      orderBy: { date: "desc" },
      take,
    }),
    prisma.maintenanceSchedule.findMany({
      where: where.maintenance,
      orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
      take,
    }),
    prisma.warranty.findMany({
      where: where.warranty,
      orderBy: { expirationDate: "desc" },
      take,
    }),
    prisma.insurancePolicy.findMany({
      where: where.insurance,
      include: policyInclude(scope),
      orderBy: { carrier: "asc" },
      take,
    }),
    prisma.provider.findMany({
      where: where.provider,
      orderBy: { name: "asc" },
      take,
    }),
    prisma.healthCondition.findMany({
      where: where.condition,
      include: { provider: { select: { name: true } } },
      orderBy: { name: "asc" },
      take,
    }),
    prisma.medication.findMany({
      where: where.medication,
      include: { prescriber: { select: { name: true } } },
      orderBy: { name: "asc" },
      take,
    }),
    prisma.allergy.findMany({
      where: where.allergy,
      orderBy: { substance: "asc" },
      take,
    }),
    prisma.immunization.findMany({
      where: where.immunization,
      orderBy: { dateGiven: "desc" },
      take,
    }),
    prisma.observation.findMany({
      where: where.observation,
      orderBy: { date: "desc" },
      take,
    }),
    prisma.room.findMany({
      where: where.room,
      include: { paints: { orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
      take,
    }),
    prisma.vehicle.findMany({ where: { currentMileage: { not: null } }, select: { id: true, currentMileage: true, meterUnit: true } }),
  ])
  const mileageIndex: MileageIndex = new Map(mileage.map((v) => [v.id, { value: v.currentMileage!, unit: v.meterUnit }]))
  const unitOf = (assetId: string) => mileageIndex.get(assetId)?.unit ?? "MILES"

  const s = page(kinds.rank(services, (r) => textsOf(r, FIELDS.service, assetName(r.assetId))))
  const serviceCards: RecordResult[] = s.items.map((r) => ({
    kind: "service", id: r.id, href: tabHref(r.assetType, r.assetId, "service", r.id),
    title: r.title, subtitle: clip(r.description), date: day(r.date), amount: money(r.cost),
    status: null,
    facts: facts([
      ["Vendor", r.vendor],
      ["Category", r.category ? serviceCategoryLabel(r.category) : null],
      [r.assetType === "VEHICLE" && unitOf(r.assetId) === "HOURS" ? "Hours" : "Odometer",
        r.mileageAtService != null ? `${r.mileageAtService.toLocaleString()} ${fmt.meterShort(unitOf(r.assetId))}` : null],
    ]),
    owner: thumb(r.assetId), people: null,
  }))

  const vi = page(kinds.rank(visits, (r) => textsOf(r, FIELDS.service, assetName(r.assetId))))
  const visitCards: RecordResult[] = vi.items.map((r) => ({
    kind: "visit", id: r.id, href: tabHref("PERSON", r.assetId, "visits", r.id),
    title: r.title, subtitle: clip(r.description), date: day(r.date), amount: money(r.cost),
    status: null,
    facts: facts([
      ["Provider", r.provider?.name ?? r.vendor],
      ["Type", r.category ? serviceCategoryLabel(r.category) : null],
      ["For", r.condition?.name],
    ]),
    owner: thumb(r.assetId), people: null,
  }))

  const m = page(kinds.rank(schedules, (r) => textsOf(r, FIELDS.maintenance, assetName(r.assetId))))
  const maintenanceCards: RecordResult[] = m.items.map((r) => {
    const due = scheduleDue(r, mileageIndex, now)
    const badge = dueBadge(due, Boolean(r.nextDueDate || r.nextDueMileage), fmt)
    const unit = fmt.meterShort(unitOf(r.assetId))
    const every = [
      r.intervalDays ? `${r.intervalDays} days` : null,
      r.intervalMiles ? `${r.intervalMiles.toLocaleString()} ${unit}` : null,
    ].filter(Boolean).join(" or ")
    return {
      kind: "maintenance", id: r.id,
      href: tabHref(r.assetType, r.assetId, r.assetType === "PERSON" ? "reminders" : "maintenance", r.id),
      title: r.title, subtitle: clip(r.description),
      date: r.nextDueDate ? `Due ${day(r.nextDueDate)}` : null, amount: null,
      status: !r.isActive ? { label: "Paused", tone: "outline" } : badge ? { label: badge.label, tone: badge.variant } : null,
      facts: facts([
        ["Every", every || null],
        ["Last done", day(r.lastCompletedDate)],
        ["Due at", r.nextDueMileage != null ? `${r.nextDueMileage.toLocaleString()} ${unit}` : null],
      ]),
      owner: thumb(r.assetId), people: null,
    }
  })

  const w = page(kinds.rank(warranties, (r) => textsOf(r, FIELDS.warranty, assetName(r.assetId))))
  const warrantyCards: RecordResult[] = w.items.map((r) => {
    const st = warrantyState(r.expirationDate, now, WARRANTY_WINDOW_DAYS)
    const status: Status | null = !r.expirationDate ? null
      : st.state === "expired" ? { label: "Expired", tone: "destructive" }
      : st.state === "expiring" ? { label: `${st.daysLeft}d left`, tone: "secondary" }
      : { label: "Active", tone: "outline" }
    return {
      kind: "warranty", id: r.id,
      href: r.assetType === "PERSON" ? assetHref("PERSON", r.assetId) : tabHref(r.assetType, r.assetId, "warranties", r.id),
      title: r.productName, subtitle: clip(r.notes),
      date: r.expirationDate ? `Expires ${day(r.expirationDate)}` : null, amount: null, status,
      facts: facts([["Vendor", r.vendor], ["Phone", r.vendorPhone], ["Purchased", day(r.purchaseDate)]]),
      owner: thumb(r.assetId), people: null,
    }
  })

  // People are health data: with Health off their names neither rank nor show.
  const peopleOf = (r: (typeof policies)[number]) => (showPeople ? r.members.map((x) => x.name) : [])
  const coversOf = (r: (typeof policies)[number]) => [...r.properties, ...r.vehicles].map((x) => x.name)
  const ins = page(kinds.rank(policies, (r) => textsOf(r, FIELDS.insurance, ...peopleOf(r), ...coversOf(r))))
  const insuranceCards: RecordResult[] = ins.items.map((r) => {
    const expired = r.endDate != null && r.endDate.getTime() < now.getTime() - 86_400_000
    const status: Status | null = expired ? { label: "Ended", tone: "outline" }
      : insuranceExpiring(r, now, renewalWindowDays(r.kind)) ? { label: "Ending soon", tone: "secondary" } : null
    return {
      kind: "insurance", id: r.id, href: `/insurance?open=${r.id}`,
      title: r.carrier, subtitle: r.planName, date: r.endDate ? `Ends ${day(r.endDate)}` : null, amount: null, status,
      facts: facts([
        ["Kind", labelFor(INSURANCE_KINDS, r.kind)],
        ["Covers", coversOf(r).join(", ") || null],
        ["Policy #", r.policyNumber],
        ["Group #", r.groupNumber],
        ["Deductible", money(r.deductible)],
        ["Phone", r.phone],
      ]),
      owner: null, people: peopleOf(r).join(", ") || null,
    }
  })

  const pr = page(kinds.rank(providers, (r) => textsOf(r, FIELDS.provider)))
  const providerCards: RecordResult[] = pr.items.map((r) => ({
    kind: "provider", id: r.id, href: `/providers?open=${r.id}`,
    title: r.name, subtitle: [r.specialty, r.practice].filter(Boolean).join(" · ") || null,
    date: null, amount: null, status: null,
    facts: facts([["Phone", r.phone], ["Email", r.email], ["Address", r.address]]),
    owner: null, people: null,
  }))

  const ro = page(kinds.rank(rooms, (r) => textsOf(r, FIELDS.room, ...r.paints.flatMap((p) => PAINT_FIELDS.map((f) => p[f])))))
  const roomCards: RecordResult[] = ro.items.map((r) => ({
    kind: "room", id: r.id, href: tabHref("PROPERTY", r.propertyId, "rooms", r.id),
    title: r.name, subtitle: r.level, date: null, amount: null, status: null,
    facts: facts([
      ["Size", [r.area != null ? fmt.area(r.area) : null, r.dimensions].filter(Boolean).join(" · ") || null],
      ["Flooring", [r.flooringType, r.flooringProduct].filter(Boolean).join(" · ") || null],
      ["Paint", r.paints.map(paintLabel).join("; ") || null],
      ["Notes", clip(r.notes, 80)],
    ]),
    owner: thumb(r.propertyId), people: null,
  }))

  const health: RecordResult[] = [
    ...kinds.rank(conditions, (r) => textsOf(r, FIELDS.condition, personName(r.personId))).slice(0, PER_SECTION).map((r): RecordResult => ({
      kind: "condition", id: r.id, href: tabHref("PERSON", r.personId, "conditions"),
      title: r.name, subtitle: clip(r.notes), date: r.diagnosedDate ? `Diagnosed ${day(r.diagnosedDate)}` : null, amount: null,
      status: { label: labelFor(CONDITION_STATUSES, r.status), tone: r.status === "RESOLVED" ? "outline" : "secondary" },
      facts: facts([["Provider", r.provider?.name], ["Resolved", day(r.resolvedDate)]]),
      owner: thumb(r.personId), people: null,
    })),
    ...kinds.rank(medications, (r) => textsOf(r, FIELDS.medication, personName(r.personId))).slice(0, PER_SECTION).map((r): RecordResult => ({
      kind: "medication", id: r.id, href: tabHref("PERSON", r.personId, "medications", r.id),
      title: r.name, subtitle: [r.dosage, r.frequency].filter(Boolean).join(" · ") || null,
      date: r.startDate ? `Started ${day(r.startDate)}` : null, amount: null,
      status: isMedicationActive(r, now) ? { label: "Active", tone: "secondary" } : { label: "Stopped", tone: "outline" },
      facts: facts([["Prescriber", r.prescriber?.name], ["Pharmacy", r.pharmacy], ["Next refill", day(r.nextRefillDate)]]),
      owner: thumb(r.personId), people: null,
    })),
    ...kinds.rank(allergies, (r) => textsOf(r, FIELDS.allergy, personName(r.personId))).slice(0, PER_SECTION).map((r): RecordResult => ({
      kind: "allergy", id: r.id, href: tabHref("PERSON", r.personId, "allergies"),
      title: r.substance, subtitle: r.reaction, date: null, amount: null,
      status: { label: labelFor(ALLERGY_SEVERITIES, r.severity), tone: r.severity === "SEVERE" ? "destructive" : "secondary" },
      facts: facts([["Notes", clip(r.notes, 80)]]),
      owner: thumb(r.personId), people: null,
    })),
    ...kinds.rank(immunizations, (r) => textsOf(r, FIELDS.immunization, personName(r.personId))).slice(0, PER_SECTION).map((r): RecordResult => ({
      kind: "immunization", id: r.id, href: tabHref("PERSON", r.personId, "immunizations", r.id),
      title: r.vaccine, subtitle: clip(r.notes), date: `Given ${day(r.dateGiven)}`, amount: null, status: null,
      facts: facts([["Dose", r.dose], ["Given by", r.givenBy], ["Next due", day(r.nextDueDate)]]),
      owner: thumb(r.personId), people: null,
    })),
    ...kinds.rank(observations, (r) => textsOf(r, FIELDS.observation, personName(r.personId))).slice(0, PER_SECTION).map((r): RecordResult => ({
      kind: "observation", id: r.id, href: observationHref(r.personId, r.id),
      title: r.type, subtitle: clip(r.notes), date: [day(r.date), r.time].filter(Boolean).join(" "), amount: null,
      status: r.severity ? { label: `Severity ${r.severity}/5`, tone: r.severity >= 4 ? "destructive" : "secondary" } : null,
      facts: facts([["Duration", r.durationMinutes ? `${r.durationMinutes} min` : null], ["Tags", r.tags]]),
      owner: thumb(r.personId), people: null,
    })),
  ]
  const healthMore = [conditions, medications, allergies, immunizations, observations].some((x) => x.length > PER_SECTION)

  return kinds.mark([
    { key: "service", title: "Service records", layout: "records", items: serviceCards, more: s.more },
    { key: "visits", title: "Health visits", layout: "records", items: visitCards, more: vi.more },
    { key: "maintenance", title: "Maintenance", layout: "records", items: maintenanceCards, more: m.more },
    { key: "warranties", title: "Warranties", layout: "records", items: warrantyCards, more: w.more },
    { key: "rooms", title: "Rooms", layout: "records", items: roomCards, more: ro.more },
    { key: "insurance", title: "Insurance", layout: "records", items: insuranceCards, more: ins.more },
    { key: "health", title: "Health records", layout: "records", items: health, more: healthMore },
    { key: "providers", title: "Providers", layout: "records", items: providerCards, more: pr.more },
  ])
}

/** Keyword files are exact or partial by the text of their matching passages. */
async function toDocuments(hits: Hit[], terms: string[], by: "keyword" | "semantic", owners: Owners) {
  // The whole pool, so exact files can be ranked ahead of partial ones before the limit.
  const groups = groupHits(hits, DOC_POOL)
  const refs = await loadDocumentRefs(groups.map((g) => g.attachmentId))
  const docs = groups.flatMap((g): DocumentResult[] => {
    const ref = refs.get(g.attachmentId)
    // Deleted since it was indexed.
    if (!ref) return []
    const pages = ref.text?.pageCount ?? 1
    return [{
      attachmentId: ref.attachmentId,
      fileName: ref.fileName,
      fileHref: ref.fileHref,
      record: ref.record,
      owner: ref.asset ? owners.thumbs.get(ref.asset.id) ?? null : null,
      pages: pages > 1 ? pages : null,
      passages: g.hits.slice(0, 2).map((h) => ({ page: pages > 1 ? h.page : null, text: passage(h.text, terms, 240) })),
      matchedBy: by === "semantic" ? "semantic" : matchKind(terms, g.hits.map((h) => h.text)),
    }]
  })
  const ranked = byTier(docs)
  return { items: ranked.slice(0, DOC_LIMIT), more: ranked.length > DOC_LIMIT }
}

export async function globalSearch(query: string, opts: { semantic: boolean; scope: PropertyScope | null }): Promise<SearchResults> {
  const q = query.trim()
  const terms = searchTerms(q)
  if (!q) return { query: q, terms, sections: [], semantic: { state: "off" }, total: 0 }

  const now = new Date()
  const [owners, features] = await Promise.all([loadOwners(), loadFeatures()])
  const parsed = parseSearch(q)
  // With Health off, its files never come back either; with Rooms off, neither do room files.
  // With the property filter on, neither do files on what it hides.
  const { scope } = opts
  const hidden = features.health && !scope ? null
    : new Set((await Promise.all([features.health ? [] : healthAttachmentIds(), outOfScopeAttachmentIds(scope)])).flat())
  const visibleHits = <H extends { attachmentId: string }>(hits: H[]) => (hidden ? hits.filter((h) => !hidden.has(h.attachmentId)) : hits)
  const excludeRecordTypes = features.rooms ? [] : ["ROOM"]

  const keywordDocs = async () => {
    if (!parsed) return { hits: [] as Hit[] }
    try {
      return { hits: visibleHits(await (await searchIndex()).search(parsed.match, { excludeRecordTypes, limit: DOC_POOL })) }
    } catch (error) {
      console.error("[search] document keyword search failed:", error instanceof Error ? error.name : typeof error)
      return { hits: [] as Hit[] }
    }
  }

  const where = terms.length ? withPropertyScope(withFeatures(keywordWheres(terms, owners, features.health, scope), features), scope) : null
  const [assetSections, recordSections, keyword] = await Promise.all([
    where ? searchAssets(where, now, terms) : Promise.resolve([]),
    where ? searchRecords(where, owners, now, terms, features.health, scope) : Promise.resolve([]),
    keywordDocs(),
  ])
  const kwDocs = await toDocuments(keyword.hits, parsed?.terms ?? terms, "keyword", owners)

  let semantic: SemanticState = { state: "off" }
  let bySemantic: Section[] = []
  if (opts.semantic) {
    const model = await semanticSearchModel().catch(() => null)
    if (!model) {
      semantic = { state: "unavailable" }
    } else {
      try {
        const vector = await embedderFor(model).embedQuery(q)
        const shown = new Set(
          [...assetSections, ...recordSections].flatMap((sec) => sec.items.map((item) => entityKeyOf(sec, item)).filter((k): k is string => k !== null))
        )
        const [records, docHits] = await Promise.all([
          semanticRecords(vector, shown, owners, now, features, scope),
          (await searchIndex()).vectorSearch(vector, { excludeRecordTypes, limit: DOC_POOL }),
        ])
        const fresh = semanticOnly(visibleHits(docHits), new Set(keyword.hits.map((h) => h.attachmentId)))
        const docs = await toDocuments(fresh, [], "semantic", owners)
        bySemantic = [
          ...records,
          ...(docs.items.length ? [{ key: "documents", title: "Documents", layout: "documents" as const, ...docs, more: false }] : []),
        ]
        semantic = { state: "ok", found: bySemantic.reduce((n, sec) => n + sec.items.length, 0) }
      } catch (error) {
        console.error("[search] semantic search failed:", error instanceof Error ? error.name : typeof error)
        semantic = { state: "failed" }
      }
    }
  }

  const keywordSections: Section[] = [
    ...assetSections,
    ...recordSections,
    { key: "documents", title: "Documents", layout: "documents" as const, ...kwDocs },
  ]
  const sections = rankSections(mergeSemantic(keywordSections, bySemantic).filter((s) => s.items.length > 0))
  const total = sections.reduce((n, sec) => n + sec.items.length, 0)
  return { query: q, terms: [...new Set([...terms, ...(parsed?.terms ?? [])])], sections, semantic, total }
}
