import { DEFAULT_FORMAT, type Formatter } from "@/lib/regional"
import { chunkPages } from "@/lib/documents/chunk"
import { paintLabel } from "@/lib/rooms"
import { insuranceKindLabel, isHealthInsuranceKind } from "@/lib/insurance"

// The text each database record is embedded as, so global search can find
// records by meaning. Rules:
//
// - Everything that means something in words goes in, as labelled sentences:
//   kinds, categories, statuses, names, descriptions, notes, places, and the
//   records it's tied to (owner, property, provider, condition, members).
// - Numbers are written so they read as amounts ("about 28 years old",
//   "2,150 sq ft"), since a bare number carries no meaning for the model.
// - Pure identifiers stay out — VINs, serial, model, policy, group and member
//   numbers, phone numbers, emails, ids, file names. They mean nothing to the
//   model, dilute the vector, and keyword search already finds them exactly.
// - The summary comes first and stays short; long notes or descriptions get
//   chunks of their own (prefixed with what they belong to), so they don't
//   push the summary past the model's input limit.
//
// Relative facts ("about 28 years old", "expired") are worked out against
// `now`, so a record's text changes when one ticks over and it is re-embedded.

export type EntityKind =
  | "PROPERTY" | "VEHICLE" | "EQUIPMENT" | "PERSON" | "ROOM"
  | "SERVICE" | "MAINTENANCE" | "WARRANTY" | "INSURANCE" | "PROVIDER"
  | "CONDITION" | "MEDICATION" | "ALLERGY" | "IMMUNIZATION" | "OBSERVATION"

export type EntityDoc = { kind: EntityKind; id: string; chunks: string[] }

/** Owner of a record as written in its text, e.g. "Gas Furnace (equipment at Maple Street House)". */
export type OwnerRef = { kind: "property" | "vehicle" | "equipment" | "person"; name: string; at?: string | null } | null

/** Longer than this and a note gets its own chunk(s) instead of riding in the summary. */
export const INLINE_NOTE_CHARS = 400
const NOTE_CHUNK_SIZE = 900
const NOTE_CHUNK_OVERLAP = 120

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** Stored days are UTC midnight (see lib/health.ts), so read UTC fields. */
export const monthYear = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
export const fullDay = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`

export function yearsBetween(from: Date, to: Date): number {
  let y = to.getUTCFullYear() - from.getUTCFullYear()
  const m = to.getUTCMonth() - from.getUTCMonth()
  if (m < 0 || (m === 0 && to.getUTCDate() < from.getUTCDate())) y--
  return Math.max(0, y)
}

export function ageWords(from: Date, now: Date): string {
  const y = yearsBetween(from, now)
  if (y >= 1) return `about ${y} year${y === 1 ? "" : "s"} old`
  const months = Math.max(0, (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + now.getUTCMonth() - from.getUTCMonth())
  return months <= 1 ? "new" : `about ${months} months old`
}

export const num = (n: number) => Math.round(n).toLocaleString("en-US")

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

/** Joins sentences, dropping empty ones and adding the full stop each one lacks. */
export function sentences(parts: (string | null | false | 0 | undefined)[]): string {
  return parts
    .map((p) => clean(p || ""))
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(" ")
}

export function ownerPhrase(o: OwnerRef): string | null {
  if (!o) return null
  return o.at ? `${o.name} (${o.kind} at ${o.at})` : `${o.name} (${o.kind})`
}

export const list = (items: (string | null | undefined)[]) => items.map(clean).filter(Boolean).join(", ")

/**
 * The summary, plus the long texts as chunks of their own. A short text is
 * added to the summary instead, with its label.
 */
export function compose(summary: string, longTexts: { label: string; text: string | null | undefined; of: string }[]): string[] {
  const extra: string[] = []
  let head = summary
  for (const t of longTexts) {
    const text = clean(t.text)
    if (!text) continue
    if (text.length <= INLINE_NOTE_CHARS) {
      head = sentences([head, `${t.label}: ${text}`])
      continue
    }
    const parts = chunkPages([text], NOTE_CHUNK_SIZE, NOTE_CHUNK_OVERLAP).map((c) => `${t.label} for ${t.of}: ${c.text}`)
    extra.push(...parts)
  }
  return [head, ...extra]
}

// ─── Assets ────────────────────────────────────────────────────────────────

export type PropertyInput = {
  id: string; name: string; type: string; address: string
  purchaseDate: Date | null; purchasePrice: number | null; yearBuilt: number | null; sqFt: number | null; notes: string | null
  equipment: { name: string; category: string }[]
}

export function propertyDoc(p: PropertyInput, now: Date, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const age = p.yearBuilt ? now.getUTCFullYear() - p.yearBuilt : null
  const summary = sentences([
    `Property: ${clean(p.name)}`,
    `A ${p.type.toLowerCase()} at ${clean(p.address)}`,
    p.yearBuilt && `Built in ${p.yearBuilt}${age != null && age >= 0 ? ` (about ${age} years old)` : ""}`,
    p.sqFt && `${num(p.sqFt)} ${fmt.areaWords}`,
    p.purchaseDate && `Purchased ${monthYear(p.purchaseDate)}${p.purchasePrice ? ` for about ${fmt.moneyWhole(p.purchasePrice)}` : ""}`,
    !p.purchaseDate && p.purchasePrice && `Purchased for about ${fmt.moneyWhole(p.purchasePrice)}`,
    p.equipment.length > 0 && `Equipment here: ${list(p.equipment.map((e) => `${e.name} (${e.category.toLowerCase()})`))}`,
  ])
  return { kind: "PROPERTY", id: p.id, chunks: compose(summary, [{ label: "Notes", text: p.notes, of: `property ${clean(p.name)}` }]) }
}

export type VehicleInput = {
  id: string; name: string; make: string; model: string; year: number; color: string | null
  purchaseDate: Date | null; purchasePrice: number | null; currentMileage: number | null; meterUnit: "MILES" | "HOURS"; notes: string | null
}

export function vehicleDoc(v: VehicleInput, now: Date, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const age = now.getUTCFullYear() - v.year
  const meter = v.currentMileage == null ? null
    : v.meterUnit === "HOURS" ? `About ${num(v.currentMileage)} engine hours on it` : `About ${num(v.currentMileage)} ${fmt.distanceWords} on it`
  const summary = sentences([
    `Vehicle: ${clean(v.name)}`,
    `A ${v.year} ${clean(v.make)} ${clean(v.model)}${v.color ? `, ${clean(v.color).toLowerCase()}` : ""}${age >= 0 ? ` (about ${age} years old)` : ""}`,
    meter,
    v.purchaseDate && `Purchased ${monthYear(v.purchaseDate)}${v.purchasePrice ? ` for about ${fmt.moneyWhole(v.purchasePrice)}` : ""}`,
  ])
  return { kind: "VEHICLE", id: v.id, chunks: compose(summary, [{ label: "Notes", text: v.notes, of: `vehicle ${clean(v.name)}` }]) }
}

export type EquipmentInput = {
  id: string; name: string; category: string; manufacturer: string | null; location: string | null
  purchaseDate: Date | null; purchasePrice: number | null; installDate: Date | null; notes: string | null
  propertyName: string | null
}

export function equipmentDoc(e: EquipmentInput, now: Date, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const since = e.installDate ?? e.purchaseDate
  const summary = sentences([
    `Equipment: ${clean(e.name)}`,
    `Category: ${e.category}`,
    e.manufacturer && `Made by ${clean(e.manufacturer)}`,
    (e.location || e.propertyName) && `Located ${[e.location && `in the ${clean(e.location).toLowerCase()}`, e.propertyName && `at ${clean(e.propertyName)}`].filter(Boolean).join(" ")}`,
    e.installDate && `Installed ${monthYear(e.installDate)}`,
    e.purchaseDate && `Purchased ${monthYear(e.purchaseDate)}${e.purchasePrice ? ` for about ${fmt.moneyWhole(e.purchasePrice)}` : ""}`,
    since && `It is ${ageWords(since, now)}`,
  ])
  return { kind: "EQUIPMENT", id: e.id, chunks: compose(summary, [{ label: "Notes", text: e.notes, of: `equipment ${clean(e.name)}` }]) }
}

export type RoomInput = {
  id: string; name: string; level: string | null; area: number | null; dimensions: string | null
  flooringType: string | null; flooringProduct: string | null; notes: string | null
  property: { name: string }
  paints: { surface: string; brand: string | null; colorName: string | null; colorCode: string | null; finish: string | null }[]
}

export function roomDoc(r: RoomInput, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const size = [r.area != null && `${num(r.area)} ${fmt.areaWords}`, r.dimensions && `(${clean(r.dimensions)})`].filter(Boolean).join(" ")
  const summary = sentences([
    `Room: ${clean(r.name)} at ${clean(r.property.name)}`,
    r.level && `Level: ${clean(r.level)}`,
    size,
    (r.flooringType || r.flooringProduct) && `Flooring: ${list([r.flooringType, r.flooringProduct])}`,
    r.paints.length > 0 && `Paint: ${r.paints.map((p) => clean(paintLabel(p))).join("; ")}`,
  ])
  return { kind: "ROOM", id: r.id, chunks: compose(summary, [{ label: "Notes", text: r.notes, of: `room ${clean(r.name)}` }]) }
}

export type PersonInput = {
  id: string; name: string; relationship: string; dateOfBirth: Date | null; sex: string | null; notes: string | null
  primaryProvider: { name: string; specialty: string | null } | null
  conditions: { name: string; status: string }[]
  medications: string[]
  allergies: string[]
}

export function personDoc(p: PersonInput, now: Date): EntityDoc {
  const summary = sentences([
    `Person: ${clean(p.name)}`,
    `Household relationship: ${p.relationship.toLowerCase()}`,
    p.dateOfBirth && `Age ${yearsBetween(p.dateOfBirth, now)}`,
    p.sex && `Sex: ${clean(p.sex)}`,
    p.primaryProvider && `Primary care: ${clean(p.primaryProvider.name)}${p.primaryProvider.specialty ? ` (${clean(p.primaryProvider.specialty)})` : ""}`,
    p.conditions.length > 0 && `Health conditions: ${list(p.conditions.map((c) => `${c.name} (${c.status.toLowerCase()})`))}`,
    p.medications.length > 0 && `Current medications: ${list(p.medications)}`,
    p.allergies.length > 0 && `Allergies: ${list(p.allergies)}`,
  ])
  return { kind: "PERSON", id: p.id, chunks: compose(summary, [{ label: "Notes", text: p.notes, of: `${clean(p.name)}` }]) }
}

// ─── Records ───────────────────────────────────────────────────────────────

export type ServiceInput = {
  id: string; title: string; description: string | null; date: Date; vendor: string | null; cost: number | null
  category: string | null; mileageAtService: number | null; meterUnit: "MILES" | "HOURS" | null
  isPerson: boolean; owner: OwnerRef
  provider: { name: string; specialty: string | null } | null
  condition: string | null
}

export function serviceDoc(r: ServiceInput, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const what = r.isPerson ? "Health visit" : "Service record"
  const of = r.isPerson ? `${what} for ${r.owner?.name ?? "someone"}` : `${what} for ${ownerPhrase(r.owner) ?? "an asset"}`
  const summary = sentences([
    `${of} on ${fullDay(r.date)}: ${clean(r.title)}`,
    r.provider && `Seen by ${clean(r.provider.name)}${r.provider.specialty ? ` (${clean(r.provider.specialty)})` : ""}`,
    r.vendor && (r.isPerson ? `Facility: ${clean(r.vendor)}` : `Done by ${clean(r.vendor)}`),
    r.category && `Type: ${r.category}`,
    r.condition && `For the condition ${clean(r.condition)}`,
    r.cost != null && r.cost > 0 && `Cost about ${fmt.moneyWhole(r.cost)}`,
    r.mileageAtService != null && `At about ${num(r.mileageAtService)} ${r.meterUnit === "HOURS" ? "engine hours" : fmt.distanceWords}`,
  ])
  return { kind: "SERVICE", id: r.id, chunks: compose(summary, [{ label: "Details", text: r.description, of: `${of.toLowerCase()} "${clean(r.title)}"` }]) }
}

export type MaintenanceInput = {
  id: string; title: string; description: string | null; owner: OwnerRef; isPerson: boolean
  intervalDays: number | null; intervalMiles: number | null; meterUnit: "MILES" | "HOURS" | null
  lastCompletedDate: Date | null; nextDueDate: Date | null; nextDueMileage: number | null; isActive: boolean
}

export function intervalWords(days: number | null, miles: number | null, unit: "MILES" | "HOURS" | null, fmt: Formatter = DEFAULT_FORMAT): string | null {
  const parts: string[] = []
  if (days) {
    if (days % 365 === 0) parts.push(days === 365 ? "every year" : `every ${days / 365} years`)
    else if (days % 30 === 0) parts.push(days === 30 ? "every month" : `every ${days / 30} months`)
    else if (days % 7 === 0) parts.push(days === 7 ? "every week" : `every ${days / 7} weeks`)
    else parts.push(`every ${days} days`)
  }
  if (miles) parts.push(`every ${num(miles)} ${unit === "HOURS" ? "engine hours" : fmt.distanceWords}`)
  return parts.length ? `Repeats ${parts.join(" or ")}` : null
}

export function maintenanceDoc(m: MaintenanceInput, now: Date, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const what = m.isPerson ? "Health reminder" : "Maintenance reminder"
  const overdue = m.isActive && m.nextDueDate != null && m.nextDueDate.getTime() < now.getTime()
  const summary = sentences([
    `${what} for ${ownerPhrase(m.owner) ?? "an asset"}: ${clean(m.title)}`,
    intervalWords(m.intervalDays, m.intervalMiles, m.meterUnit, fmt),
    m.lastCompletedDate && `Last done ${fullDay(m.lastCompletedDate)}`,
    m.nextDueDate && `Next due ${fullDay(m.nextDueDate)}${overdue ? " (overdue)" : ""}`,
    m.nextDueMileage != null && `Due at about ${num(m.nextDueMileage)} ${m.meterUnit === "HOURS" ? "engine hours" : fmt.distanceWords}`,
    !m.isActive && "Paused, not currently scheduled",
  ])
  return { kind: "MAINTENANCE", id: m.id, chunks: compose(summary, [{ label: "Details", text: m.description, of: `reminder "${clean(m.title)}"` }]) }
}

export type WarrantyInput = {
  id: string; productName: string; owner: OwnerRef; vendor: string | null
  purchaseDate: Date | null; expirationDate: Date | null; notes: string | null
}

export function warrantyDoc(w: WarrantyInput, now: Date): EntityDoc {
  const expired = w.expirationDate != null && w.expirationDate.getTime() < now.getTime()
  const summary = sentences([
    `Warranty for ${ownerPhrase(w.owner) ?? "an asset"}: ${clean(w.productName)}`,
    w.vendor && `From ${clean(w.vendor)}`,
    w.purchaseDate && `Purchased ${monthYear(w.purchaseDate)}`,
    w.expirationDate && (expired ? `Expired ${fullDay(w.expirationDate)}` : `Coverage runs until ${fullDay(w.expirationDate)}`),
    !w.expirationDate && "No expiration date recorded",
  ])
  return { kind: "WARRANTY", id: w.id, chunks: compose(summary, [{ label: "Notes", text: w.notes, of: `warranty "${clean(w.productName)}"` }]) }
}

export type InsuranceInput = {
  id: string; carrier: string; planName: string | null; kind: string
  startDate: Date | null; endDate: Date | null; deductible: number | null; outOfPocketMax: number | null
  notes: string | null; members: string[]
  /** Names of the properties and vehicles it covers. */
  assets: string[]
}

export function insuranceDoc(p: InsuranceInput, now: Date, fmt: Formatter = DEFAULT_FORMAT): EntityDoc {
  const ended = p.endDate != null && p.endDate.getTime() < now.getTime()
  const summary = sentences([
    `${insuranceKindLabel(p.kind)} insurance policy from ${clean(p.carrier)}${p.planName ? `, plan ${clean(p.planName)}` : ""}`,
    p.assets.length > 0 && `Covers ${list(p.assets)}`,
    // People on a life policy are health data too: only health kinds put them in text semantic search matches on.
    isHealthInsuranceKind(p.kind) && p.members.length > 0 && `Covers ${list(p.members)}`,
    p.deductible != null && `Deductible about ${fmt.moneyWhole(p.deductible)}`,
    p.outOfPocketMax != null && `Out-of-pocket maximum about ${fmt.moneyWhole(p.outOfPocketMax)}`,
    p.startDate && `Started ${fullDay(p.startDate)}`,
    p.endDate && (ended ? `Ended ${fullDay(p.endDate)}` : `Runs until ${fullDay(p.endDate)}`),
  ])
  return { kind: "INSURANCE", id: p.id, chunks: compose(summary, [{ label: "Notes", text: p.notes, of: `insurance from ${clean(p.carrier)}` }]) }
}

export type ProviderInput = {
  id: string; name: string; specialty: string | null; practice: string | null; address: string | null; notes: string | null
  primaryFor: string[]
}

export function providerDoc(p: ProviderInput): EntityDoc {
  const summary = sentences([
    `Healthcare provider: ${clean(p.name)}`,
    p.specialty && `Specialty: ${clean(p.specialty)}`,
    p.practice && `Practice: ${clean(p.practice)}`,
    p.address && `Located at ${clean(p.address)}`,
    p.primaryFor.length > 0 && `Primary care provider for ${list(p.primaryFor)}`,
  ])
  return { kind: "PROVIDER", id: p.id, chunks: compose(summary, [{ label: "Notes", text: p.notes, of: `provider ${clean(p.name)}` }]) }
}

// ─── Health records ──────────────────────────────────────────────────────────

export type ConditionInput = {
  id: string; name: string; status: string; person: string; provider: string | null
  diagnosedDate: Date | null; resolvedDate: Date | null; notes: string | null
}

export function conditionDoc(c: ConditionInput): EntityDoc {
  const summary = sentences([
    `Health condition of ${clean(c.person)}: ${clean(c.name)}`,
    `Status: ${c.status.toLowerCase()}`,
    c.diagnosedDate && `Diagnosed ${monthYear(c.diagnosedDate)}`,
    c.resolvedDate && `Resolved ${monthYear(c.resolvedDate)}`,
    c.provider && `Treated by ${clean(c.provider)}`,
  ])
  return { kind: "CONDITION", id: c.id, chunks: compose(summary, [{ label: "Notes", text: c.notes, of: `${clean(c.person)}'s ${clean(c.name)}` }]) }
}

export type MedicationInput = {
  id: string; name: string; dosage: string | null; frequency: string | null; pharmacy: string | null
  startDate: Date | null; endDate: Date | null; person: string; prescriber: string | null; condition: string | null; notes: string | null
}

export function medicationDoc(m: MedicationInput, now: Date): EntityDoc {
  const stopped = m.endDate != null && m.endDate.getTime() < now.getTime()
  const summary = sentences([
    `Medication for ${clean(m.person)}: ${clean(m.name)}${m.dosage ? ` ${clean(m.dosage)}` : ""}`,
    m.frequency && `Taken ${clean(m.frequency)}`,
    m.condition && `For ${clean(m.condition)}`,
    m.prescriber && `Prescribed by ${clean(m.prescriber)}`,
    m.pharmacy && `Filled at ${clean(m.pharmacy)}`,
    m.startDate && `Started ${monthYear(m.startDate)}`,
    stopped ? `Stopped ${monthYear(m.endDate!)}` : "Currently taking it",
  ])
  return { kind: "MEDICATION", id: m.id, chunks: compose(summary, [{ label: "Notes", text: m.notes, of: `${clean(m.person)}'s ${clean(m.name)}` }]) }
}

export type AllergyInput = { id: string; substance: string; reaction: string | null; severity: string; person: string; notes: string | null }

export function allergyDoc(a: AllergyInput): EntityDoc {
  const summary = sentences([
    `Allergy: ${clean(a.person)} is allergic to ${clean(a.substance)}`,
    a.reaction && `Reaction: ${clean(a.reaction)}`,
    `Severity: ${a.severity.toLowerCase()}`,
  ])
  return { kind: "ALLERGY", id: a.id, chunks: compose(summary, [{ label: "Notes", text: a.notes, of: `${clean(a.person)}'s ${clean(a.substance)} allergy` }]) }
}

export type ImmunizationInput = {
  id: string; vaccine: string; dateGiven: Date; dose: string | null; givenBy: string | null; nextDueDate: Date | null
  person: string; notes: string | null
}

export function immunizationDoc(i: ImmunizationInput): EntityDoc {
  const summary = sentences([
    `Immunization for ${clean(i.person)}: ${clean(i.vaccine)} vaccine${i.dose ? `, ${clean(i.dose)}` : ""}`,
    `Given ${fullDay(i.dateGiven)}${i.givenBy ? ` by ${clean(i.givenBy)}` : ""}`,
    i.nextDueDate && `Next dose due ${fullDay(i.nextDueDate)}`,
  ])
  return { kind: "IMMUNIZATION", id: i.id, chunks: compose(summary, [{ label: "Notes", text: i.notes, of: `${clean(i.person)}'s ${clean(i.vaccine)} vaccine` }]) }
}

export type ObservationInput = {
  id: string; type: string; date: Date; time: string | null; severity: number | null; durationMinutes: number | null
  tags: string | null; person: string; condition: string | null; notes: string | null
}

const SEVERITY = ["", "very mild", "mild", "moderate", "severe", "very severe"]

export function observationDoc(o: ObservationInput): EntityDoc {
  const tags = (o.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)
  const summary = sentences([
    `Observation about ${clean(o.person)} on ${fullDay(o.date)}${o.time ? ` at ${o.time}` : ""}: ${clean(o.type)}`,
    o.severity && `Severity ${o.severity} of 5 (${SEVERITY[o.severity] ?? ""})`,
    o.durationMinutes && `Lasted about ${o.durationMinutes} minutes`,
    tags.length > 0 && `Tags: ${tags.join(", ")}`,
    o.condition && `Related to ${clean(o.condition)}`,
  ])
  return { kind: "OBSERVATION", id: o.id, chunks: compose(summary, [{ label: "Notes", text: o.notes, of: `${clean(o.person)}'s ${clean(o.type)} observation` }]) }
}
