// Engine file: relative imports and npm packages only.
// The public, documented shape of an export (docs/export-format.md). Read with
// plain SQL from a snapshot so it never depends on the Prisma client's shape.
import path from "node:path"
import type { Client, Row } from "@libsql/client"
import { attachmentDir, type AttachmentLocation } from "../attachment-location"
import type { ExportScope } from "./format"
import { safeJoin } from "./paths"
import { openDb } from "./snapshot"

export type FileRef = { name: string; path: string; size: number; mimeType: string }
type AssetType = "property" | "vehicle" | "equipment" | "person"
export type PublicAsset = { id: string; type: AssetType; name: string; details: Record<string, string | number | null>; photo: string | null; propertyId: string | null }
type Owned = { assetId: string; assetType: AssetType }
export type PublicRecord = Owned & { id: string; date: string | null; title: string; vendor: string | null; cost: number | null; category: string | null; mileage: number | null; notes: string | null; files: FileRef[] }
export type PublicWarranty = Owned & { id: string; product: string; purchased: string | null; expires: string | null; vendor: string | null; phone: string | null; email: string | null; notes: string | null; files: FileRef[] }
export type PublicReminder = Owned & { id: string; title: string; everyDays: number | null; everyMiles: number | null; lastDone: string | null; nextDue: string | null; nextDueMileage: number | null; active: boolean; files: FileRef[] }
export type PublicDocument = Owned & FileRef & { id: string; uploaded: string | null }
type PersonOwned = { id: string; personId: string; files: FileRef[] }
export type PublicHealth = {
  providers: { id: string; name: string; specialty: string | null; practice: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null }[]
  conditions: (PersonOwned & { name: string; status: string; diagnosed: string | null; resolved: string | null; notes: string | null })[]
  medications: (PersonOwned & { name: string; dosage: string | null; frequency: string | null; pharmacy: string | null; start: string | null; end: string | null; nextRefill: string | null; notes: string | null })[]
  allergies: (PersonOwned & { substance: string; reaction: string | null; severity: string; notes: string | null })[]
  immunizations: (PersonOwned & { vaccine: string; given: string | null; dose: string | null; givenBy: string | null; nextDue: string | null; notes: string | null })[]
  observations: (PersonOwned & { date: string | null; time: string | null; type: string; severity: number | null; minutes: number | null; tags: string | null; notes: string | null })[]
  insurance: { id: string; personIds: string[]; carrier: string; plan: string | null; kind: string; policyNumber: string | null; groupNumber: string | null; memberId: string | null; phone: string | null; start: string | null; end: string | null; notes: string | null; files: FileRef[] }[]
}
export type ReadableData = {
  formatVersion: 1; generatedAt: string; scope: ExportScope
  assets: PublicAsset[]; serviceRecords: PublicRecord[]; warranties: PublicWarranty[]; reminders: PublicReminder[]; documents: PublicDocument[]
  health: PublicHealth | null
}
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
const SAFE_ROOT = path.resolve("uploads")
const TYPE: Record<string, AssetType> = { PROPERTY: "property", VEHICLE: "vehicle", EQUIPMENT: "equipment", PERSON: "person" }

export const rawPlacement: Place = ({ rel }) => `files/${rel}`

const TYPE_DIR: Record<AssetType, string> = { property: "Properties", vehicle: "Vehicles", equipment: "Equipment", person: "People" }
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i  // Windows treats "nul.txt" as the device too
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

export async function loadReadable(snapshot: string, scope: ExportScope, place: Place): Promise<{ data: ReadableData; files: PlannedFile[] }> {
  const c = openDb(snapshot)
  try {
    const includeHealth = scope.kind === "all" ? scope.includeHealth : scope.assetType === "PERSON"
    const [props, vehicles, equipment, people] = await Promise.all([
      all(c, `SELECT * FROM "Property"`), all(c, `SELECT * FROM "Vehicle"`), all(c, `SELECT * FROM "Equipment"`), includeHealth ? all(c, `SELECT * FROM "Person"`) : Promise.resolve([] as Row[]),
    ])
    let assets: PublicAsset[] = [
      ...props.map((r) => ({ id: String(r.id), type: "property" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Type: str(r.type), Address: str(r.address), "Year built": num(r.yearBuilt), "Square feet": num(r.sqFt), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...vehicles.map((r) => ({ id: String(r.id), type: "vehicle" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Make: str(r.make), Model: str(r.model), Year: num(r.year), VIN: str(r.vin), Color: str(r.color), "Current reading": num(r.currentMileage), Unit: str(r.meterUnit), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...equipment.map((r) => ({ id: String(r.id), type: "equipment" as const, name: String(r.name), propertyId: str(r.propertyId), photo: str(r.imageFilename),
        details: { Category: str(r.category), Manufacturer: str(r.manufacturer), Model: str(r.modelNumber), Serial: str(r.serialNumber), Location: str(r.location), Installed: iso(r.installDate), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
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
    const reminders = (await all(c, `SELECT * FROM "MaintenanceSchedule"`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), title: String(r.title), everyDays: num(r.intervalDays), everyMiles: num(r.intervalMiles), lastDone: iso(r.lastCompletedDate),
      nextDue: iso(r.nextDueDate), nextDueMileage: num(r.nextDueMileage), active: Boolean(Number(r.isActive)),
      files: attachedTo("maintenanceScheduleId", r.id, byId.get(String(r.assetId)) ?? null, "reminders"),
    }))
    const documents = attachments.filter((a) => a.recordType === "DOCUMENT" && ownedOk(a)).map((a) => {
      const asset = byId.get(String(a.assetId)) ?? null
      const f = fileFor(a, asset, "documents")
      return f ? { ...owner(a), id: String(a.id), uploaded: iso(a.uploadedAt), ...f } : null
    }).filter((d): d is PublicDocument => d !== null)

    let health: PublicHealth | null = null
    if (includeHealth) {
      const personIds = new Set(assets.filter((a) => a.type === "person").map((a) => a.id))
      const mine = (r: Row) => personIds.has(String(r.personId))
      const person = (r: Row) => byId.get(String(r.personId)) ?? null
      const members = await all(c, `SELECT * FROM "_InsurancePolicyToPerson"`)
      const providers = scope.kind === "all" ? await all(c, `SELECT * FROM "Provider"`) : []
      health = {
        providers: providers.map((r) => ({ id: String(r.id), name: String(r.name), specialty: str(r.specialty), practice: str(r.practice), phone: str(r.phone), email: str(r.email), address: str(r.address), notes: str(r.notes) })),
        conditions: (await all(c, `SELECT * FROM "HealthCondition"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), name: String(r.name), status: String(r.status), diagnosed: iso(r.diagnosedDate), resolved: iso(r.resolvedDate), notes: str(r.notes), files: attachedTo("healthConditionId", r.id, person(r), "conditions") })),
        medications: (await all(c, `SELECT * FROM "Medication"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), name: String(r.name), dosage: str(r.dosage), frequency: str(r.frequency), pharmacy: str(r.pharmacy), start: iso(r.startDate), end: iso(r.endDate), nextRefill: iso(r.nextRefillDate), notes: str(r.notes), files: attachedTo("medicationId", r.id, person(r), "medications") })),
        allergies: (await all(c, `SELECT * FROM "Allergy"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), substance: String(r.substance), reaction: str(r.reaction), severity: String(r.severity), notes: str(r.notes), files: attachedTo("allergyId", r.id, person(r), "allergies") })),
        immunizations: (await all(c, `SELECT * FROM "Immunization"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), vaccine: String(r.vaccine), given: iso(r.dateGiven), dose: str(r.dose), givenBy: str(r.givenBy), nextDue: iso(r.nextDueDate), notes: str(r.notes), files: attachedTo("immunizationId", r.id, person(r), "immunizations") })),
        observations: (await all(c, `SELECT * FROM "Observation"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), date: iso(r.date), time: str(r.time), type: String(r.type), severity: num(r.severity), minutes: num(r.durationMinutes), tags: str(r.tags), notes: str(r.notes), files: attachedTo("observationId", r.id, person(r), "observations") })),
        insurance: (await all(c, `SELECT * FROM "InsurancePolicy"`))
          .map((r) => ({ r, ids: members.filter((m) => m.A === r.id).map((m) => String(m.B)).filter((id) => personIds.has(id)) }))
          .filter(({ ids }) => ids.length > 0 || scope.kind === "all")
          .map(({ r, ids }) => ({ id: String(r.id), personIds: ids, carrier: String(r.carrier), plan: str(r.planName), kind: String(r.kind), policyNumber: str(r.policyNumber), groupNumber: str(r.groupNumber), memberId: str(r.memberId), phone: str(r.phone), start: iso(r.startDate), end: iso(r.endDate), notes: str(r.notes), files: attachedTo("insurancePolicyId", r.id, byId.get(ids[0]) ?? null, "insurance") })),
      }
    }

    return {
      data: { formatVersion: 1, generatedAt: new Date().toISOString(), scope, assets, serviceRecords, warranties, reminders, documents, health },
      files,
    }
  } finally {
    c.close()
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
  const out: Record<string, string> = {
    "assets.csv": toCsv(d.assets.map((a) => ({ id: a.id, type: a.type, name: a.name, ...a.details })), ["id", "type", "name", ...new Set(d.assets.flatMap((a) => Object.keys(a.details)))]),
    "service-records.csv": toCsv(withAsset(d.serviceRecords), ["date", "asset", "assetType", "title", "vendor", "cost", "category", "mileage", "notes", "id"]),
    "warranties.csv": toCsv(withAsset(d.warranties), ["asset", "product", "purchased", "expires", "vendor", "phone", "email", "notes", "id"]),
    "reminders.csv": toCsv(withAsset(d.reminders), ["asset", "title", "everyDays", "everyMiles", "lastDone", "nextDue", "nextDueMileage", "active", "id"]),
    "documents.csv": toCsv(withAsset(d.documents), ["asset", "name", "uploaded", "size", "mimeType", "path", "id"]),
  }
  if (d.health) {
    out["providers.csv"] = toCsv(d.health.providers, ["name", "specialty", "practice", "phone", "email", "address", "notes", "id"])
    out["conditions.csv"] = toCsv(withPerson(d.health.conditions), ["person", "name", "status", "diagnosed", "resolved", "notes", "id"])
    out["medications.csv"] = toCsv(withPerson(d.health.medications), ["person", "name", "dosage", "frequency", "pharmacy", "start", "end", "nextRefill", "notes", "id"])
    out["allergies.csv"] = toCsv(withPerson(d.health.allergies), ["person", "substance", "reaction", "severity", "notes", "id"])
    out["immunizations.csv"] = toCsv(withPerson(d.health.immunizations), ["person", "vaccine", "given", "dose", "givenBy", "nextDue", "notes", "id"])
    out["observations.csv"] = toCsv(withPerson(d.health.observations), ["person", "date", "time", "type", "severity", "minutes", "tags", "notes", "id"])
    out["insurance.csv"] = toCsv(d.health.insurance.map((p) => ({ ...p, people: p.personIds.map((id) => name.get(id) ?? id).join("; ") })), ["people", "carrier", "plan", "kind", "policyNumber", "groupNumber", "memberId", "phone", "start", "end", "notes", "id"])
  }
  return out
}
