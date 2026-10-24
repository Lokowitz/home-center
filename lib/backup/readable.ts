// Engine file: relative imports and npm packages only.
// The public, documented shape of an export (docs/export-format.md). Read with
// plain SQL from a snapshot so it never depends on the Prisma client's shape.
import { repeatsLabel } from "../maintenance-schedule"
import { effectiveValueClass, valueClassLabel, type ValueClass } from "../equipment-value"
import { manualText } from "../manual-reference"
import { annualPremium, currentAndPrevious, isHealthInsuranceKind } from "../insurance"
import path from "node:path"
import type { Client, Row } from "@libsql/client"
import { attachmentDir, type AttachmentLocation } from "../attachment-location"
import type { ExportScope } from "./format"
import { safeJoin } from "./paths"
import { openDb, releaseDbHandles } from "./snapshot"

export type FileRef = { name: string; path: string; size: number; mimeType: string }
type AssetType = "property" | "vehicle" | "equipment" | "person"
export type PublicAsset = { id: string; type: AssetType; name: string; details: Record<string, string | number | null>; photo: string | null; propertyId: string | null }
type Owned = { assetId: string; assetType: AssetType }
export type PublicRecord = Owned & { id: string; date: string | null; title: string; vendor: string | null; cost: number | null; category: string | null; mileage: number | null; notes: string | null; files: FileRef[] }
export type PublicWarranty = Owned & { id: string; product: string; purchased: string | null; expires: string | null; vendor: string | null; phone: string | null; email: string | null; notes: string | null; files: FileRef[] }
export type PublicReminder = Owned & { id: string; title: string; repeats: string; estimatedCost: number | null; manual: string | null; everyDays: number | null; everyMiles: number | null; lastDone: string | null; nextDue: string | null; nextDueMileage: number | null; active: boolean; files: FileRef[] }
export type PublicRoomPaint = { surface: string; brand: string | null; colorName: string | null; colorCode: string | null; finish: string | null }
export type PublicRoom = Owned & { id: string; name: string; level: string | null; area: number | null; dimensions: string | null; flooringType: string | null; flooringProduct: string | null; flooringInstalled: string | null; notes: string | null; paints: PublicRoomPaint[]; files: FileRef[] }
export type PublicDocument = Owned & FileRef & { id: string; uploaded: string | null }
type PersonOwned = { id: string; personId: string; files: FileRef[] }
export type PublicPremium = { id: string; policyId: string; effective: string | null; amount: number; period: string; annual: number; notes: string | null }
export type PublicCoverage = { id: string; policyId: string; label: string; limit: number | null; deductible: number | null }
export type PublicPolicy = {
  id: string; kind: string; carrier: string; plan: string | null; policyNumber: string | null; groupNumber: string | null; memberId: string | null; phone: string | null
  start: string | null; end: string | null; deductible: number | null; outOfPocketMax: number | null; notes: string | null
  personIds: string[]; propertyIds: string[]; vehicleIds: string[]; annualPremium: number | null; premiums: PublicPremium[]; coverages: PublicCoverage[]; files: FileRef[]
}
export type PublicHealth = {
  providers: { id: string; name: string; specialty: string | null; practice: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null }[]
  conditions: (PersonOwned & { name: string; status: string; diagnosed: string | null; resolved: string | null; notes: string | null })[]
  medications: (PersonOwned & { name: string; dosage: string | null; frequency: string | null; pharmacy: string | null; start: string | null; end: string | null; nextRefill: string | null; notes: string | null })[]
  allergies: (PersonOwned & { substance: string; reaction: string | null; severity: string; notes: string | null })[]
  immunizations: (PersonOwned & { vaccine: string; given: string | null; dose: string | null; givenBy: string | null; nextDue: string | null; notes: string | null })[]
  observations: (PersonOwned & { date: string | null; time: string | null; type: string; severity: number | null; minutes: number | null; tags: string | null; notes: string | null })[]
  insurance: PublicPolicy[]
}
export type ReadableData = {
  formatVersion: 1; generatedAt: string; scope: ExportScope
  assets: PublicAsset[]; serviceRecords: PublicRecord[]; warranties: PublicWarranty[]; reminders: PublicReminder[]; documents: PublicDocument[]; rooms: PublicRoom[]
  /** Home, renters, auto, umbrella, life and other non-health policies: exported with or without health records. */
  insurance: PublicPolicy[]
  health: PublicHealth | null
}
/** Household labels read from the snapshot itself (this engine file cannot import app code). */
export type ReadableRegional = { currency: string; areaUnit: "SQFT" | "SQM" }
export type PlannedFile = { rel: string; archivePath: string }
export type Place = (f: { rel: string; asset: PublicAsset | null; section: string; originalName: string }) => string

/** Prisma stores DateTime in SQLite as ms since epoch or ISO text depending on the path that wrote it; accept both. */
function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  const d = typeof v === "number" || typeof v === "bigint" ? new Date(Number(v)) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))
// Only a syntactic anchor so safeJoin can judge a relative path; nothing is read from it.
const SAFE_ROOT = path.resolve("uploads")
const TYPE: Record<string, AssetType> = { PROPERTY: "property", VEHICLE: "vehicle", EQUIPMENT: "equipment", PERSON: "person" }

export const rawPlacement: Place = ({ rel }) => `files/${rel}`

const TYPE_DIR: Record<AssetType, string> = { property: "Properties", vehicle: "Vehicles", equipment: "Equipment", person: "People" }
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])([\s.]|$)/i  // Windows treats "nul.txt", "con .txt" and "con  " as the device too
const EXTENSION = /\.[A-Za-z0-9]{1,16}$/
const SEGMENT_BYTES = 120

/** Cuts to a UTF-8 byte budget without splitting a character. */
function cutBytes(s: string, max: number): string {
  let out = ""
  let used = 0
  for (const ch of s) {
    const n = Buffer.byteLength(ch)
    if (used + n > max) break
    out += ch
    used += n
  }
  return out
}

/** One safe path segment: no separators, Windows-illegal or control characters, no "..", no leading dot, not a reserved device name. */
export function safeSegment(name: string, keepExtension = false): string {
  let s = name.normalize("NFC").replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "_").replace(/\.{2,}/g, ".").replace(/^[.\s]+/, "").trim()
  let ext = ""
  if (keepExtension) {
    const m = EXTENSION.exec(s)
    if (m && m.index > 0) {
      ext = m[0]
      s = s.slice(0, m.index)
    }
  }
  s = cutBytes(s, SEGMENT_BYTES).replace(/[.\s]+$/, "")
  if (!s) s = "_"
  if (RESERVED.test(s)) s = "_" + s
  return s + ext
}

/** Readable paths for exports: files/<Type>/<asset>/<section>/<file>, sanitised, flattened, duplicates numbered "name (2).ext". */
export function exportPlacement(): Place {
  const used = new Set<string>() // lower-cased: archives are often extracted on case-insensitive disks
  return ({ asset, section, originalName }) => {
    const dir = asset ? `files/${TYPE_DIR[asset.type]}/${safeSegment(asset.name)}/${safeSegment(section)}` : `files/Other/${safeSegment(section)}`
    const file = safeSegment(originalName, true)
    const m = EXTENSION.exec(file)
    const ext = m && m.index > 0 ? m[0] : ""
    const stem = file.slice(0, file.length - ext.length)
    let p = `${dir}/${file}`
    for (let n = 2; used.has(p.toLowerCase()); n++) p = `${dir}/${stem} (${n})${ext}`
    used.add(p.toLowerCase())
    if (!p.startsWith("files/") || p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) throw new Error(`Unsafe export path: ${p}`)
    return p
  }
}

async function all(c: Client, sql: string): Promise<Row[]> {
  try {
    return (await c.execute(sql)).rows
  } catch {
    return [] // table missing in an older schema
  }
}

export async function loadReadable(snapshot: string, scope: ExportScope, place: Place): Promise<{ data: ReadableData; files: PlannedFile[]; regional: ReadableRegional }> {
  const c = openDb(snapshot)
  try {
    const includeHealth = scope.kind === "all" ? scope.includeHealth : scope.assetType === "PERSON"
    // Labels only: the stored numbers are never converted. Missing table (older schema) means the defaults.
    const regionalRow = (await all(c, `SELECT "currency", "areaUnit" FROM "RegionalSettings" LIMIT 1`))[0]
    // eslint-disable-next-line no-restricted-syntax -- engine file cannot import @/lib/regional; fallback literal only
    const regional: ReadableRegional = { currency: str(regionalRow?.currency) ?? "USD", areaUnit: str(regionalRow?.areaUnit) === "SQM" ? "SQM" : "SQFT" }
    const areaLabel = regional.areaUnit === "SQM" ? "Square metres" : "Square feet"
    const [props, vehicles, equipment, people, roomRows] = await Promise.all([
      all(c, `SELECT * FROM "Property"`), all(c, `SELECT * FROM "Vehicle"`), all(c, `SELECT * FROM "Equipment"`), includeHealth ? all(c, `SELECT * FROM "Person"`) : Promise.resolve([] as Row[]),
      all(c, `SELECT * FROM "Room" ORDER BY name`),
    ])
    // Room-linked equipment has no location of its own; its room's name is where it is.
    const roomName = new Map(roomRows.map((r) => [String(r.id), String(r.name)]))
    let assets: PublicAsset[] = [
      ...props.map((r) => ({ id: String(r.id), type: "property" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Type: str(r.type), Address: str(r.address), "Year built": num(r.yearBuilt), [areaLabel]: num(r.sqFt), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...vehicles.map((r) => ({ id: String(r.id), type: "vehicle" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Make: str(r.make), Model: str(r.model), Year: num(r.year), VIN: str(r.vin), Color: str(r.color), "Current reading": num(r.currentMileage), Unit: str(r.meterUnit), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...equipment.map((r) => ({ id: String(r.id), type: "equipment" as const, name: String(r.name), propertyId: str(r.propertyId), photo: str(r.imageFilename),
        details: { Category: str(r.category), Manufacturer: str(r.manufacturer), Model: str(r.modelNumber), Serial: str(r.serialNumber), Location: roomName.get(String(r.roomId)) ?? str(r.location), Installed: iso(r.installDate), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice),
          "Counts as": valueClassLabel(effectiveValueClass({ category: String(r.category), valueClass: str(r.valueClass) as ValueClass | null })),
          "Expected life (years)": num(r.expectedLifeYears), "Replacement cost": num(r.replacementCost), Notes: str(r.notes) } })),
      ...people.map((r) => ({ id: String(r.id), type: "person" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Relationship: str(r.relationship), Born: iso(r.dateOfBirth), Sex: str(r.sex), "Blood type": str(r.bloodType), Notes: str(r.notes) } })),
    ]
    if (scope.kind === "asset") {
      const keep = new Set([scope.assetId])
      if (scope.assetType === "PROPERTY") for (const e of assets) if (e.type === "equipment" && e.propertyId === scope.assetId) keep.add(e.id)
      assets = assets.filter((a) => keep.has(a.id))
    }
    const byId = new Map(assets.map((a) => [a.id, a]))
    const ownedOk = (r: Row) => byId.has(String(r.assetId)) && (includeHealth || r.assetType !== "PERSON")

    const files: PlannedFile[] = []
    const attachments = await all(c, `SELECT * FROM "Attachment"`)
    const fileFor = (a: Row, asset: PublicAsset | null, section: string): FileRef | null => {
      const dir = attachmentDir(a as unknown as AttachmentLocation)
      if (!dir) return null
      const rel = `${dir[0]}/${dir[1]}/${String(a.filename)}`
      if (!safeJoin(SAFE_ROOT, rel)) return null // a tampered DB value must not name a path outside the uploads
      const archivePath = place({ rel, asset, section, originalName: String(a.originalName) })
      files.push({ rel, archivePath })
      return { name: String(a.originalName), path: `../${archivePath}`, size: Number(a.sizeBytes), mimeType: String(a.mimeType) }
    }
    const attachedTo = (col: string, id: unknown, asset: PublicAsset | null, section: string) =>
      attachments.filter((a) => a[col] === id).map((a) => fileFor(a, asset, section)).filter((f): f is FileRef => !!f)

    for (const a of assets) {
      if (a.photo) {
        const dir = { property: "properties", vehicle: "vehicles", equipment: "equipment", person: "people" }[a.type]
        const rel = `${dir}/${a.id}/${a.photo}`
        if (!safeJoin(SAFE_ROOT, rel)) {
          a.photo = null
          continue
        }
        const archivePath = place({ rel, asset: a, section: "photo", originalName: a.photo })
        files.push({ rel, archivePath })
        a.photo = `../${archivePath}`
      }
    }

    const owner = (r: Row) => ({ assetId: String(r.assetId), assetType: TYPE[String(r.assetType)] })
    const serviceRecords = (await all(c, `SELECT * FROM "ServiceRecord" ORDER BY date DESC`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), date: iso(r.date), title: String(r.title), vendor: str(r.vendor), cost: num(r.cost), category: str(r.category),
      mileage: num(r.mileageAtService), notes: str(r.description), files: attachedTo("serviceRecordId", r.id, byId.get(String(r.assetId)) ?? null, "service"),
    }))
    const warranties = (await all(c, `SELECT * FROM "Warranty"`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), product: String(r.productName), purchased: iso(r.purchaseDate), expires: iso(r.expirationDate), vendor: str(r.vendor),
      phone: str(r.vendorPhone), email: str(r.vendorEmail), notes: str(r.notes), files: attachedTo("warrantyId", r.id, byId.get(String(r.assetId)) ?? null, "warranties"),
    }))
    const manualOf = (r: Row) => {
      const ref = attachments.find((a) => a.id === r.referenceAttachmentId)
      return ref ? manualText(String(ref.originalName), num(r.referencePage)) : null
    }
    const reminders = (await all(c, `SELECT * FROM "MaintenanceSchedule"`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), title: String(r.title),
      repeats: repeatsLabel({ intervalDays: num(r.intervalDays), intervalMiles: num(r.intervalMiles), dueMonths: str(r.dueMonths), dueDay: num(r.dueDay) }, byId.get(String(r.assetId))?.details?.Unit === "HOURS" ? "hr" : "mi"),
      estimatedCost: num(r.estimatedCost), manual: manualOf(r), everyDays: num(r.intervalDays), everyMiles: num(r.intervalMiles), lastDone: iso(r.lastCompletedDate),
      nextDue: iso(r.nextDueDate), nextDueMileage: num(r.nextDueMileage), active: Boolean(Number(r.isActive)),
      files: attachedTo("maintenanceScheduleId", r.id, byId.get(String(r.assetId)) ?? null, "reminders"),
    }))
    // Rooms belong to a property; a property-scoped export keeps only that property's (byId holds just the kept assets).
    const paints = await all(c, `SELECT * FROM "RoomPaint" ORDER BY sortOrder, id`)
    const rooms = roomRows.filter((r) => byId.get(String(r.propertyId))?.type === "property").map((r) => ({
      assetId: String(r.propertyId), assetType: "property" as const, id: String(r.id), name: String(r.name), level: str(r.level), area: num(r.area), dimensions: str(r.dimensions),
      flooringType: str(r.flooringType), flooringProduct: str(r.flooringProduct), flooringInstalled: iso(r.flooringInstalled), notes: str(r.notes),
      paints: paints.filter((p) => p.roomId === r.id).map((p) => ({ surface: String(p.surface), brand: str(p.brand), colorName: str(p.colorName), colorCode: str(p.colorCode), finish: str(p.finish) })),
      files: attachedTo("roomId", r.id, byId.get(String(r.propertyId)) ?? null, "rooms"),
    }))
    const documents = attachments.filter((a) => a.recordType === "DOCUMENT" && ownedOk(a)).map((a) => {
      const asset = byId.get(String(a.assetId)) ?? null
      const f = fileFor(a, asset, "documents")
      return f ? { ...owner(a), id: String(a.id), uploaded: iso(a.uploadedAt), ...f } : null
    }).filter((d): d is PublicDocument => d !== null)

    // Policies: built once; health kinds go under `health`, the rest into the top-level `insurance`.
    const policyRows = await all(c, `SELECT * FROM "InsurancePolicy" ORDER BY carrier`)
    const links = {
      person: await all(c, `SELECT * FROM "_InsurancePolicyToPerson"`),
      property: await all(c, `SELECT * FROM "_InsurancePolicyToProperty"`),
      vehicle: await all(c, `SELECT * FROM "_InsurancePolicyToVehicle"`),
    }
    const premiumRows = await all(c, `SELECT * FROM "InsurancePremium"`)
    const coverageRows = await all(c, `SELECT * FROM "InsuranceCoverage" ORDER BY sortOrder`)
    const linked = (kind: keyof typeof links, policyId: unknown) => links[kind].filter((m) => m.A === policyId).map((m) => String(m.B)).filter((id) => byId.has(id))
    const policyRow = (r: Row): PublicPolicy => {
      const personIds = linked("person", r.id)
      const propertyIds = linked("property", r.id)
      const vehicleIds = linked("vehicle", r.id)
      const premiums = premiumRows
        .filter((x) => x.policyId === r.id)
        .map((x) => ({ x, effectiveDate: new Date(iso(x.effectiveDate) ?? 0), amount: Number(x.amount), period: String(x.period), createdAt: new Date(iso(x.createdAt) ?? 0) }))
        .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
      const current = currentAndPrevious(premiums, new Date()).current
      const firstAsset = byId.get(personIds[0] ?? propertyIds[0] ?? vehicleIds[0] ?? "") ?? null
      return {
        id: String(r.id), kind: String(r.kind), carrier: String(r.carrier), plan: str(r.planName), policyNumber: str(r.policyNumber), groupNumber: str(r.groupNumber),
        memberId: str(r.memberId), phone: str(r.phone), start: iso(r.startDate), end: iso(r.endDate), deductible: num(r.deductible), outOfPocketMax: num(r.outOfPocketMax),
        notes: str(r.notes), personIds, propertyIds, vehicleIds,
        annualPremium: current ? annualPremium(current) : null,
        premiums: premiums.map((p) => ({ id: String(p.x.id), policyId: String(r.id), effective: iso(p.x.effectiveDate), amount: p.amount, period: p.period, annual: annualPremium(p), notes: str(p.x.notes) })),
        coverages: coverageRows.filter((x) => x.policyId === r.id).map((x) => ({ id: String(x.id), policyId: String(r.id), label: String(x.label), limit: num(x.limit), deductible: num(x.deductible) })),
        files: attachedTo("insurancePolicyId", r.id, firstAsset, "insurance"),
      }
    }
    // Filtered before built: building plans each policy's files, and a policy left out must not bring them.
    const insurance = policyRows
      .filter((r) => !isHealthInsuranceKind(String(r.kind)))
      .filter((r) => scope.kind === "all" || (["person", "property", "vehicle"] as const).some((k) => linked(k, r.id).length > 0))
      .map(policyRow)

    let health: PublicHealth | null = null
    if (includeHealth) {
      const personIds = new Set(assets.filter((a) => a.type === "person").map((a) => a.id))
      const mine = (r: Row) => personIds.has(String(r.personId))
      const person = (r: Row) => byId.get(String(r.personId)) ?? null
      const providers = scope.kind === "all" ? await all(c, `SELECT * FROM "Provider"`) : []
      health = {
        providers: providers.map((r) => ({ id: String(r.id), name: String(r.name), specialty: str(r.specialty), practice: str(r.practice), phone: str(r.phone), email: str(r.email), address: str(r.address), notes: str(r.notes) })),
        conditions: (await all(c, `SELECT * FROM "HealthCondition"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), name: String(r.name), status: String(r.status), diagnosed: iso(r.diagnosedDate), resolved: iso(r.resolvedDate), notes: str(r.notes), files: attachedTo("healthConditionId", r.id, person(r), "conditions") })),
        medications: (await all(c, `SELECT * FROM "Medication"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), name: String(r.name), dosage: str(r.dosage), frequency: str(r.frequency), pharmacy: str(r.pharmacy), start: iso(r.startDate), end: iso(r.endDate), nextRefill: iso(r.nextRefillDate), notes: str(r.notes), files: attachedTo("medicationId", r.id, person(r), "medications") })),
        allergies: (await all(c, `SELECT * FROM "Allergy"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), substance: String(r.substance), reaction: str(r.reaction), severity: String(r.severity), notes: str(r.notes), files: attachedTo("allergyId", r.id, person(r), "allergies") })),
        immunizations: (await all(c, `SELECT * FROM "Immunization"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), vaccine: String(r.vaccine), given: iso(r.dateGiven), dose: str(r.dose), givenBy: str(r.givenBy), nextDue: iso(r.nextDueDate), notes: str(r.notes), files: attachedTo("immunizationId", r.id, person(r), "immunizations") })),
        observations: (await all(c, `SELECT * FROM "Observation"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), date: iso(r.date), time: str(r.time), type: String(r.type), severity: num(r.severity), minutes: num(r.durationMinutes), tags: str(r.tags), notes: str(r.notes), files: attachedTo("observationId", r.id, person(r), "observations") })),
        insurance: policyRows
          .filter((r) => isHealthInsuranceKind(String(r.kind)))
          .filter((r) => scope.kind === "all" || linked("person", r.id).length > 0)
          .map(policyRow),
      }
    }

    return {
      data: { formatVersion: 1, generatedAt: new Date().toISOString(), scope, assets, serviceRecords, warranties, reminders, documents, rooms, insurance, health },
      files,
      regional,
    }
  } finally {
    c.close()
    await releaseDbHandles() // Windows keeps the snapshot locked until the handle is collected; callers delete it next
  }
}

const FORMULA_START = /^[=+\-@\t\r]/

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return ""
    let s = String(v)
    // Spreadsheet formula injection: a text cell that starts like a formula is shown as text.
    if (typeof v === "string" && FORMULA_START.test(s)) s = "'" + s
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n"
}

export function csvTables(d: ReadableData): Record<string, string> {
  const name = new Map(d.assets.map((a) => [a.id, a.name]))
  const withAsset = <T extends { assetId: string }>(rows: T[]) => rows.map((r) => ({ ...r, asset: name.get(r.assetId) ?? r.assetId }))
  const withPerson = <T extends { personId: string }>(rows: T[]) => rows.map((r) => ({ ...r, person: name.get(r.personId) ?? r.personId }))
  const policies = [...d.insurance, ...(d.health?.insurance ?? [])]
  const nameOf = (id: string) => name.get(id) ?? id
  const out: Record<string, string> = {
    "assets.csv": toCsv(d.assets.map((a) => ({ id: a.id, type: a.type, name: a.name, ...a.details })), ["id", "type", "name", ...new Set(d.assets.flatMap((a) => Object.keys(a.details)))]),
    "service-records.csv": toCsv(withAsset(d.serviceRecords), ["date", "asset", "assetType", "title", "vendor", "cost", "category", "mileage", "notes", "id"]),
    "warranties.csv": toCsv(withAsset(d.warranties), ["asset", "product", "purchased", "expires", "vendor", "phone", "email", "notes", "id"]),
    "reminders.csv": toCsv(withAsset(d.reminders), ["asset", "title", "repeats", "estimatedCost", "manual", "everyDays", "everyMiles", "lastDone", "nextDue", "nextDueMileage", "active", "id"]),
    "rooms.csv": toCsv(withAsset(d.rooms), ["asset", "name", "level", "area", "dimensions", "flooringType", "flooringProduct", "flooringInstalled", "notes", "id"]),
    "room-paints.csv": toCsv(d.rooms.flatMap((r) => r.paints.map((p) => ({ ...p, asset: name.get(r.assetId) ?? r.assetId, room: r.name, roomId: r.id }))), ["asset", "room", "surface", "brand", "colorName", "colorCode", "finish", "roomId"]),
    "documents.csv": toCsv(withAsset(d.documents), ["asset", "name", "uploaded", "size", "mimeType", "path", "id"]),
    "insurance.csv": toCsv(
      policies.map((p) => ({ ...p, people: p.personIds.map(nameOf).join("; "), covers: [...p.propertyIds, ...p.vehicleIds].map(nameOf).join("; ") })),
      ["people", "covers", "carrier", "plan", "kind", "policyNumber", "groupNumber", "memberId", "phone", "start", "end", "deductible", "annualPremium", "notes", "id"],
    ),
    "insurance-premiums.csv": toCsv(policies.flatMap((p) => p.premiums.map((x) => ({ ...x, carrier: p.carrier }))), ["carrier", "effective", "amount", "period", "annual", "notes", "policyId", "id"]),
    "insurance-coverages.csv": toCsv(policies.flatMap((p) => p.coverages.map((x) => ({ ...x, carrier: p.carrier }))), ["carrier", "label", "limit", "deductible", "policyId", "id"]),
  }
  if (d.health) {
    out["providers.csv"] = toCsv(d.health.providers, ["name", "specialty", "practice", "phone", "email", "address", "notes", "id"])
    out["conditions.csv"] = toCsv(withPerson(d.health.conditions), ["person", "name", "status", "diagnosed", "resolved", "notes", "id"])
    out["medications.csv"] = toCsv(withPerson(d.health.medications), ["person", "name", "dosage", "frequency", "pharmacy", "start", "end", "nextRefill", "notes", "id"])
    out["allergies.csv"] = toCsv(withPerson(d.health.allergies), ["person", "substance", "reaction", "severity", "notes", "id"])
    out["immunizations.csv"] = toCsv(withPerson(d.health.immunizations), ["person", "vaccine", "given", "dose", "givenBy", "nextDue", "notes", "id"])
    out["observations.csv"] = toCsv(withPerson(d.health.observations), ["person", "date", "time", "type", "severity", "minutes", "tags", "notes", "id"])
  }
  return out
}
