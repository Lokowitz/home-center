import {
  AllergySeverity, AssetType, ConditionStatus, EquipmentCategory, EquipmentValueClass, InsuranceKind, MeterUnit,
  NotificationType, PremiumPeriod, PropertyType, Relationship, ServiceCategory,
} from "@/app/generated/prisma/enums"
import { HEALTH_INSURANCE_KINDS } from "@/lib/insurance"
import { assetHref } from "@/lib/assets"
import { observationHref } from "@/lib/observations"

// The assistant's map of the data. Everything the LLM can reach is declared
// here once — fields, enum values, relations, links — and the query compiler,
// the serializer, the aggregator and the system prompt all read from it.
// Anything not declared is unreachable, which is how users, secrets and
// attachments stay out.

export type FieldType = "string" | "int" | "number" | "money" | "date" | "boolean" | "enum"
export type FieldDef = { type: FieldType; values?: readonly string[]; description?: string }
export type Row = Record<string, unknown>

export const ENTITY_KEYS = [
  "property", "vehicle", "equipment", "person", "provider", "serviceRecord", "warranty",
  "maintenanceSchedule", "healthCondition", "medication", "allergy", "immunization",
  "insurancePolicy", "insurancePremium", "insuranceCoverage", "notification", "observation", "room", "roomPaint",
] as const
export type EntityKey = (typeof ENTITY_KEYS)[number]

/** Health's entities: out of reach, and out of the prompt, while Health is off (Settings → Features). */
export const HEALTH_ENTITIES: ReadonlySet<EntityKey> = new Set<EntityKey>([
  "person", "provider", "healthCondition", "medication", "allergy", "immunization", "observation",
])

/** Rooms' entities: out of reach, and out of the prompt, while Rooms is off (Settings → Features). */
export const ROOM_ENTITIES: ReadonlySet<EntityKey> = new Set<EntityKey>(["room", "roomPaint"])

/** The entities the assistant can reach. */
export const entityKeysFor = (health: boolean, rooms = true): EntityKey[] =>
  ENTITY_KEYS.filter((k) => (health || !HEALTH_ENTITIES.has(k)) && (rooms || !ROOM_ENTITIES.has(k)))

/** Relation names equal the Prisma relation field names for one/many. */
export type RelationDef =
  | { kind: "one" | "many"; entity: EntityKey }
  /** The polymorphic owner of a service record / warranty / schedule. */
  | { kind: "asset" }
  /** Polymorphic rows pointing at this asset via assetType + assetId. */
  | { kind: "assetChildren"; entity: "serviceRecord" | "warranty" | "maintenanceSchedule" }

export type EntityDef = {
  /** Prisma delegate name, e.g. "serviceRecord". */
  model: string
  label: string
  plural: string
  description: string
  /** Field that names a row in lists and group labels. */
  nameField: string
  /** Fields the search tool matches words against. */
  searchFields: string[]
  /** Foreign keys always selected (for links and chaining); filterable with eq/in, but not sortable or listed in fields. */
  keys: string[]
  polymorphic?: boolean
  /** Set on the four asset entities; their assetChildren match on it. */
  assetType?: AssetType
  fields: Record<string, FieldDef>
  relations: Record<string, RelationDef>
  defaultSort: { field: string; dir: "asc" | "desc" }
  href?: (row: Row) => string | null
  /** ANDed into every query of this entity while Health is off. */
  healthOff?: Row
  /** Always ANDed into the where clause; the model cannot override it. */
  scope?: (ctx: { userId: string }) => Row
}

const s: FieldDef = { type: "string" }
const int: FieldDef = { type: "int" }
const money: FieldDef = { type: "money" }
const date: FieldDef = { type: "date" }
const bool: FieldDef = { type: "boolean" }
const enumOf = (o: Record<string, string>, description?: string): FieldDef => ({ type: "enum", values: Object.values(o), description })

const assetChildren = {
  serviceRecords: { kind: "assetChildren", entity: "serviceRecord" },
  warranties: { kind: "assetChildren", entity: "warranty" },
  maintenanceSchedules: { kind: "assetChildren", entity: "maintenanceSchedule" },
} as const satisfies Record<string, RelationDef>

const assetLink = (type: AssetType) => (row: Row) => assetHref(type, String(row.id))
const personLink = (row: Row) => (row.personId ? assetHref("PERSON", String(row.personId)) : null)
const ownerLink = (row: Row) =>
  row.assetType && row.assetId ? assetHref(row.assetType as AssetType, String(row.assetId)) : null
const polymorphic = {
  polymorphic: true,
  keys: ["assetType", "assetId"],
  href: ownerLink,
} satisfies Partial<EntityDef>

export const ENTITIES: Record<EntityKey, EntityDef> = {
  property: {
    model: "property", label: "Property", plural: "properties",
    description: "Houses, condos, land.",
    nameField: "name", searchFields: ["name", "address"], keys: [], assetType: "PROPERTY",
    fields: {
      name: s, type: enumOf(PropertyType), address: s, purchaseDate: date, purchasePrice: money,
      yearBuilt: int, sqFt: { type: "int", description: "Floor area in the household area unit (field name is historical)" }, notes: s,
    },
    relations: { equipment: { kind: "many", entity: "equipment" }, rooms: { kind: "many", entity: "room" }, ...assetChildren },
    defaultSort: { field: "name", dir: "asc" },
    href: assetLink("PROPERTY"),
  },
  vehicle: {
    model: "vehicle", label: "Vehicle", plural: "vehicles",
    description: "Cars, trucks, boats, mowers — anything with an odometer or hour meter.",
    nameField: "name", searchFields: ["name", "make", "model"], keys: [], assetType: "VEHICLE",
    fields: {
      name: s, make: s, model: s, year: int, vin: s, color: s, purchaseDate: date, purchasePrice: money,
      currentMileage: { type: "int", description: "Current odometer (household distance unit) or hour-meter reading" },
      meterUnit: enumOf(MeterUnit), notes: s,
    },
    relations: { ...assetChildren },
    defaultSort: { field: "name", dir: "asc" },
    href: assetLink("VEHICLE"),
  },
  equipment: {
    model: "equipment", label: "Equipment", plural: "equipment",
    description: "Appliances, HVAC, tools, electronics, usually tied to a property, with optional expected life and replacement cost.",
    nameField: "name", searchFields: ["name", "manufacturer", "modelNumber", "location"], keys: ["propertyId", "roomId"],
    assetType: "EQUIPMENT",
    fields: {
      name: s, category: enumOf(EquipmentCategory), manufacturer: s, modelNumber: s, serialNumber: s,
      location: s, purchaseDate: date, purchasePrice: money, installDate: date, notes: s,
      valueClass: enumOf(EquipmentValueClass, "Part of the home (FIXTURE) or belongings (CONTENTS). Null means the category default: HVAC, WATER and SECURITY are FIXTURE, the rest CONTENTS. To select by class, do not filter on this field alone: list the equipment and classify null rows by category, or combine valueClass with category."),
      expectedLifeYears: { type: "int", description: "Years it should last, counted from installDate, else purchaseDate" },
      replacementCost: money,
    },
    relations: { property: { kind: "one", entity: "property" }, room: { kind: "one", entity: "room" }, ...assetChildren },
    defaultSort: { field: "name", dir: "asc" },
    href: assetLink("EQUIPMENT"),
  },
  person: {
    model: "person", label: "Person", plural: "people",
    description: "Household members and their health records.",
    nameField: "name", searchFields: ["name"], keys: ["primaryProviderId"], assetType: "PERSON",
    fields: {
      name: s, relationship: enumOf(Relationship), dateOfBirth: date, sex: s, bloodType: s, notes: s,
    },
    relations: {
      primaryProvider: { kind: "one", entity: "provider" },
      conditions: { kind: "many", entity: "healthCondition" },
      medications: { kind: "many", entity: "medication" },
      allergies: { kind: "many", entity: "allergy" },
      immunizations: { kind: "many", entity: "immunization" },
      insurancePolicies: { kind: "many", entity: "insurancePolicy" },
      observations: { kind: "many", entity: "observation" },
      ...assetChildren,
    },
    defaultSort: { field: "name", dir: "asc" },
    href: assetLink("PERSON"),
  },
  provider: {
    model: "provider", label: "Provider", plural: "providers",
    description: "Doctors, dentists and other care providers (shared directory).",
    nameField: "name", searchFields: ["name", "specialty", "practice"], keys: [],
    fields: { name: s, specialty: s, practice: s, phone: s, email: s, address: s, notes: s },
    relations: {
      primaryFor: { kind: "many", entity: "person" },
      conditions: { kind: "many", entity: "healthCondition" },
      prescriptions: { kind: "many", entity: "medication" },
      serviceRecords: { kind: "many", entity: "serviceRecord" },
    },
    defaultSort: { field: "name", dir: "asc" },
    href: () => "/providers",
  },
  serviceRecord: {
    model: "serviceRecord", label: "Service record", plural: "service records",
    description: "Repairs, maintenance, doctor visits and other dated work, usually with a cost. Belongs to an asset (property, vehicle, equipment or person).",
    nameField: "title", searchFields: ["title", "vendor", "description"],
    ...polymorphic, keys: ["assetType", "assetId", "providerId", "conditionId", "roomId"],
    fields: {
      date: date, title: s, description: s, vendor: s, cost: money, category: enumOf(ServiceCategory),
      mileageAtService: { type: "int", description: "Odometer (household distance unit) or hour meter at the time (vehicles)" },
      assetType: enumOf(AssetType, "Kind of asset this belongs to"),
    },
    relations: {
      asset: { kind: "asset" },
      provider: { kind: "one", entity: "provider" },
      condition: { kind: "one", entity: "healthCondition" },
      room: { kind: "one", entity: "room" },
    },
    defaultSort: { field: "date", dir: "desc" },
  },
  warranty: {
    model: "warranty", label: "Warranty", plural: "warranties",
    description: "Warranty coverage on an asset.",
    nameField: "productName", searchFields: ["productName", "vendor"], ...polymorphic,
    fields: {
      productName: s, purchaseDate: date, expirationDate: date, vendor: s, vendorPhone: s, vendorEmail: s,
      notes: s, assetType: enumOf(AssetType, "Kind of asset this belongs to"),
    },
    relations: { asset: { kind: "asset" } },
    defaultSort: { field: "expirationDate", dir: "asc" },
  },
  maintenanceSchedule: {
    model: "maintenanceSchedule", label: "Maintenance schedule", plural: "maintenance schedules",
    description: "Recurring, seasonal (set months) or one-time maintenance or checkups for an asset. For due/overdue status use the maintenance_status tool.",
    nameField: "title", searchFields: ["title", "description"], ...polymorphic, keys: ["assetType", "assetId", "roomId", "referenceAttachmentId"],
    fields: {
      title: s, description: s, intervalDays: int,
      intervalMiles: { type: "int", description: "Interval in the vehicle's meter unit" },
      estimatedCost: money,
      dueMonths: { type: "string", description: "Seasonal schedule: months 1-12, comma-separated, e.g. 4,10" },
      dueDay: { type: "int", description: "Day of the month for a seasonal schedule" },
      referencePage: { type: "int", description: "Page of the reminder's linked manual. To read it, call read_document with attachmentId = referenceAttachmentId and fromPage = referencePage." },
      lastCompletedDate: date, lastCompletedMileage: int, nextDueDate: date, nextDueMileage: int,
      reminderDaysBefore: int, reminderMilesBefore: int, isActive: bool,
      assetType: enumOf(AssetType, "Kind of asset this belongs to"),
    },
    relations: { asset: { kind: "asset" }, room: { kind: "one", entity: "room" } },
    defaultSort: { field: "nextDueDate", dir: "asc" },
  },
  healthCondition: {
    model: "healthCondition", label: "Health condition", plural: "health conditions",
    description: "Diagnoses for a person.",
    nameField: "name", searchFields: ["name"], keys: ["personId", "providerId"],
    fields: { name: s, status: enumOf(ConditionStatus), diagnosedDate: date, resolvedDate: date, notes: s },
    relations: {
      person: { kind: "one", entity: "person" },
      provider: { kind: "one", entity: "provider" },
      medications: { kind: "many", entity: "medication" },
      serviceRecords: { kind: "many", entity: "serviceRecord" },
      observations: { kind: "many", entity: "observation" },
    },
    defaultSort: { field: "name", dir: "asc" },
    href: personLink,
  },
  observation: {
    model: "observation", label: "Observation", plural: "observations",
    description:
      "Things noticed about a person on a day — meltdowns, bad nights, symptoms, moods — logged by the family. " +
      "type is free text (e.g. Meltdown); severity 1 (mild) to 5 (severe); time is HH:MM when known. For counts and patterns prefer observation_log.",
    nameField: "type", searchFields: ["type", "notes", "tags"], keys: ["personId", "conditionId"],
    fields: { date: date, time: s, type: s, severity: int, durationMinutes: int, tags: s, notes: s },
    relations: {
      person: { kind: "one", entity: "person" },
      condition: { kind: "one", entity: "healthCondition" },
    },
    defaultSort: { field: "date", dir: "desc" },
    href: (row) => (row.personId ? observationHref(String(row.personId), String(row.id)) : null),
  },
  medication: {
    model: "medication", label: "Medication", plural: "medications",
    description:
      "A person's medications, one row per dose period: a dose change ends one row and starts the next, so one drug can have many rows. " +
      "No endDate (or a future one) means still taken. For a person's medication history prefer medication_history.",
    nameField: "name", searchFields: ["name", "pharmacy"], keys: ["personId", "prescriberId", "conditionId"],
    fields: {
      name: s, dosage: s, frequency: s, pharmacy: s, startDate: date, endDate: date,
      refillIntervalDays: int, nextRefillDate: date, notes: s,
    },
    relations: {
      person: { kind: "one", entity: "person" },
      prescriber: { kind: "one", entity: "provider" },
      condition: { kind: "one", entity: "healthCondition" },
    },
    defaultSort: { field: "startDate", dir: "desc" },
    href: personLink,
  },
  allergy: {
    model: "allergy", label: "Allergy", plural: "allergies",
    description: "A person's allergies.",
    nameField: "substance", searchFields: ["substance", "reaction"], keys: ["personId"],
    fields: { substance: s, reaction: s, severity: enumOf(AllergySeverity), notes: s },
    relations: { person: { kind: "one", entity: "person" } },
    defaultSort: { field: "substance", dir: "asc" },
    href: personLink,
  },
  immunization: {
    model: "immunization", label: "Immunization", plural: "immunizations",
    description: "Vaccine doses given to a person.",
    nameField: "vaccine", searchFields: ["vaccine"], keys: ["personId"],
    fields: { vaccine: s, dateGiven: date, dose: s, givenBy: s, nextDueDate: date, notes: s },
    relations: { person: { kind: "one", entity: "person" } },
    defaultSort: { field: "dateGiven", dir: "desc" },
    href: personLink,
  },
  insurancePolicy: {
    model: "insurancePolicy", label: "Insurance policy", plural: "insurance policies",
    description: "Insurance policies: home, renters, auto, umbrella, life and other; with Health on also medical, dental and vision. What each covers, its coverage lines and premium history.",
    nameField: "carrier", searchFields: ["carrier", "planName"], keys: [],
    fields: {
      carrier: s, planName: s, kind: enumOf(InsuranceKind), policyNumber: s, groupNumber: s, memberId: s,
      phone: s, startDate: date, endDate: date, deductible: money, outOfPocketMax: money, notes: s,
    },
    relations: {
      members: { kind: "many", entity: "person" },
      properties: { kind: "many", entity: "property" },
      vehicles: { kind: "many", entity: "vehicle" },
      premiums: { kind: "many", entity: "insurancePremium" },
      coverages: { kind: "many", entity: "insuranceCoverage" },
    },
    healthOff: { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } },
    defaultSort: { field: "carrier", dir: "asc" },
    // Stays the plain page: "/insurance?open=id" would be flagged by impossibleLinks (lib/llm/link-check.ts).
    href: () => "/insurance",
  },
  insurancePremium: {
    model: "insurancePremium", label: "Insurance premium", plural: "insurance premiums",
    description: "One premium on a policy, effective from a date. The newest one already in effect is the current premium.",
    nameField: "effectiveDate", searchFields: ["notes"], keys: ["policyId"],
    fields: {
      effectiveDate: date,
      amount: { type: "money", description: "Per billing period. Multiply MONTHLY by 12 and SEMIANNUAL by 2 for the yearly cost." },
      period: enumOf(PremiumPeriod), notes: s,
    },
    relations: { policy: { kind: "one", entity: "insurancePolicy" } },
    healthOff: { policy: { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } } },
    defaultSort: { field: "effectiveDate", dir: "desc" },
    href: () => "/insurance",
  },
  insuranceCoverage: {
    model: "insuranceCoverage", label: "Insurance coverage line", plural: "insurance coverage lines",
    description: "One line of a policy's coverage: what is covered, its limit and its deductible.",
    nameField: "label", searchFields: ["label"], keys: ["policyId"],
    fields: { label: s, limit: money, deductible: money, sortOrder: int },
    relations: { policy: { kind: "one", entity: "insurancePolicy" } },
    healthOff: { policy: { kind: { notIn: [...HEALTH_INSURANCE_KINDS] } } },
    defaultSort: { field: "sortOrder", dir: "asc" },
    href: () => "/insurance",
  },
  notification: {
    model: "notification", label: "Notification", plural: "notifications",
    description: "The signed-in user's own reminders and alerts.",
    nameField: "title", searchFields: ["title", "message"], keys: [],
    fields: { type: enumOf(NotificationType), title: s, message: s, isRead: bool, createdAt: date },
    relations: {},
    defaultSort: { field: "createdAt", dir: "desc" },
    href: () => "/notifications",
    scope: (ctx) => ({ userId: ctx.userId }),
  },
  room: {
    model: "room", label: "Room", plural: "rooms",
    description: "Rooms of a property: level, size, flooring, paint (see paints), notes. Equipment, service records and schedules can name the room they're in.",
    nameField: "name", searchFields: ["name", "level", "flooringType", "flooringProduct", "notes"], keys: ["propertyId"],
    fields: {
      name: s, level: s, area: { type: "number", description: "Floor area in the household area unit" },
      dimensions: s, flooringType: s, flooringProduct: s, flooringInstalled: date, notes: s,
    },
    relations: {
      property: { kind: "one", entity: "property" },
      paints: { kind: "many", entity: "roomPaint" },
      equipment: { kind: "many", entity: "equipment" },
    },
    defaultSort: { field: "name", dir: "asc" },
    href: (row) => (row.propertyId ? `${assetHref("PROPERTY", String(row.propertyId))}?tab=rooms&open=${String(row.id)}` : null),
  },
  roomPaint: {
    model: "roomPaint", label: "Room paint", plural: "room paints",
    description: "The paint on one surface of a room (walls, ceiling, trim…): brand, color name, color code, finish.",
    nameField: "surface", searchFields: ["surface", "brand", "colorName", "colorCode"], keys: ["roomId"],
    fields: { surface: s, brand: s, colorName: s, colorCode: s, finish: s, sortOrder: int },
    relations: { room: { kind: "one", entity: "room" } },
    defaultSort: { field: "sortOrder", dir: "asc" },
  },
}

function describeField(name: string, f: FieldDef) {
  return f.type === "enum" ? `${name}(${f.values!.join("|")})` : `${name}(${f.type})`
}

function describeRelation(name: string, r: RelationDef, health: boolean) {
  if (r.kind === "asset") return health ? "asset→property|vehicle|equipment|person" : "asset→property|vehicle|equipment"
  return `${name}→${r.entity}${r.kind === "one" ? "" : "[]"}`
}

/** One line per entity, for the system prompt. */
export function describeOntology(health = true, rooms = true): string {
  return entityKeysFor(health, rooms).map((key) => {
    const d = ENTITIES[key]
    const fields = Object.entries(d.fields).map(([n, f]) => describeField(n, f)).join(", ")
    const rels = Object.entries(d.relations)
      .filter(([, r]) => health || !("entity" in r) || !HEALTH_ENTITIES.has(r.entity))
      .filter(([, r]) => rooms || !("entity" in r) || !ROOM_ENTITIES.has(r.entity))
      .map(([n, r]) => describeRelation(n, r, health))
    return `- ${key}: ${d.description} Fields: ${fields}.${rels.length ? ` Relations: ${rels.join(", ")}.` : ""}`
  }).join("\n")
}
