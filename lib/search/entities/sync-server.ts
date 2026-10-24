import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import type { AssetType } from "@/app/generated/prisma/client"
import { categoryLabel as equipmentCategoryLabel } from "@/components/equipment/categories"
import { categoryLabel as serviceCategoryLabel } from "@/lib/costs"
import { loadDocumentSettings } from "@/lib/documents/settings"
import { documentIndexer, searchIndex } from "@/lib/documents/indexer-server"
import {
  allergyDoc, conditionDoc, equipmentDoc, immunizationDoc, insuranceDoc, maintenanceDoc, medicationDoc, observationDoc,
  personDoc, propertyDoc, providerDoc, roomDoc, serviceDoc, vehicleDoc, warrantyDoc, type EntityDoc, type OwnerRef,
} from "./text"
import { getFormat } from "@/lib/regional-server"
import { locationLabel } from "@/lib/rooms"
import { onEntitiesChanged } from "./changes"

// Keeps the record half of search-index.db in step with the database: build
// every record's text, compare hashes with what's indexed, rewrite what
// changed, drop what's gone, then let the indexer embed the new chunks.
// A household's worth of rows is small enough to rebuild the texts in full
// each time; only changed records cost an embedding.

const OWNER_KIND: Record<AssetType, NonNullable<OwnerRef>["kind"]> = {
  PROPERTY: "property", VEHICLE: "vehicle", EQUIPMENT: "equipment", PERSON: "person",
}

export async function buildEntityDocs(now: Date = new Date()): Promise<EntityDoc[]> {
  const fmt = await getFormat()
  const [
    properties, vehicles, equipment, people, services, schedules, warranties, policies, providers,
    conditions, medications, allergies, immunizations, observations, rooms,
  ] = await Promise.all([
    prisma.property.findMany({ include: { equipment: { select: { name: true, category: true }, orderBy: { name: "asc" } } } }),
    prisma.vehicle.findMany(),
    prisma.equipment.findMany({ include: { property: { select: { name: true } }, room: { select: { name: true } } } }),
    prisma.person.findMany({
      include: {
        primaryProvider: { select: { name: true, specialty: true } },
        conditions: { select: { name: true, status: true }, orderBy: { name: "asc" } },
        medications: { select: { name: true, endDate: true }, orderBy: { name: "asc" } },
        allergies: { select: { substance: true }, orderBy: { substance: "asc" } },
      },
    }),
    prisma.serviceRecord.findMany({
      include: { provider: { select: { name: true, specialty: true } }, condition: { select: { name: true } } },
    }),
    prisma.maintenanceSchedule.findMany(),
    prisma.warranty.findMany(),
    prisma.insurancePolicy.findMany({
      include: {
        members: { select: { name: true }, orderBy: { name: "asc" } },
        properties: { select: { name: true }, orderBy: { name: "asc" } },
        vehicles: { select: { name: true }, orderBy: { name: "asc" } },
      },
    }),
    prisma.provider.findMany({ include: { primaryFor: { select: { name: true }, orderBy: { name: "asc" } } } }),
    prisma.healthCondition.findMany({ include: { person: { select: { name: true } }, provider: { select: { name: true } } } }),
    prisma.medication.findMany({
      include: { person: { select: { name: true } }, prescriber: { select: { name: true } }, condition: { select: { name: true } } },
    }),
    prisma.allergy.findMany({ include: { person: { select: { name: true } } } }),
    prisma.immunization.findMany({ include: { person: { select: { name: true } } } }),
    prisma.observation.findMany({ include: { person: { select: { name: true } }, condition: { select: { name: true } } } }),
    // Indexed whatever the Rooms switch says, like Health's records; search leaves them out while it's off.
    prisma.room.findMany({ include: { property: { select: { name: true } }, paints: { orderBy: { sortOrder: "asc" } } } }),
  ])

  // Owners by id (cuids are unique across tables), with where equipment sits.
  const owners = new Map<string, NonNullable<OwnerRef>>()
  for (const p of properties) owners.set(p.id, { kind: "property", name: p.name })
  for (const v of vehicles) owners.set(v.id, { kind: "vehicle", name: v.name })
  for (const e of equipment) owners.set(e.id, { kind: "equipment", name: e.name, at: e.property?.name ?? null })
  for (const p of people) owners.set(p.id, { kind: "person", name: p.name })
  const ownerOf = (type: AssetType, id: string): OwnerRef => owners.get(id) ?? { kind: OWNER_KIND[type], name: "(deleted)" }
  const unitOf = new Map(vehicles.map((v) => [v.id, v.meterUnit]))
  const meterUnit = (type: AssetType, id: string) => (type === "VEHICLE" ? (unitOf.get(id) ?? "MILES") : null)

  return [
    ...properties.map((p) => propertyDoc({
      ...p, equipment: p.equipment.map((e) => ({ name: e.name, category: equipmentCategoryLabel(e.category) })),
    }, now, fmt)),
    ...vehicles.map((v) => vehicleDoc(v, now, fmt)),
    ...equipment.map((e) => equipmentDoc({
      ...e, category: equipmentCategoryLabel(e.category), location: locationLabel(e), propertyName: e.property?.name ?? null,
    }, now, fmt)),
    ...rooms.map((r) => roomDoc(r, fmt)),
    ...people.map((p) => personDoc({
      ...p,
      medications: p.medications.filter((m) => !m.endDate || m.endDate.getTime() >= now.getTime()).map((m) => m.name),
      allergies: p.allergies.map((a) => a.substance),
    }, now)),
    ...services.map((r) => serviceDoc({
      ...r,
      category: r.category ? serviceCategoryLabel(r.category) : null,
      meterUnit: meterUnit(r.assetType, r.assetId),
      isPerson: r.assetType === "PERSON",
      owner: ownerOf(r.assetType, r.assetId),
      condition: r.condition?.name ?? null,
    }, fmt)),
    ...schedules.map((m) => maintenanceDoc({
      ...m, owner: ownerOf(m.assetType, m.assetId), isPerson: m.assetType === "PERSON", meterUnit: meterUnit(m.assetType, m.assetId),
    }, now, fmt)),
    ...warranties.map((w) => warrantyDoc({ ...w, owner: ownerOf(w.assetType, w.assetId) }, now)),
    ...policies.map((p) => insuranceDoc({ ...p, members: p.members.map((m) => m.name), assets: [...p.properties, ...p.vehicles].map((x) => x.name) }, now, fmt)),
    ...providers.map((p) => providerDoc({ ...p, primaryFor: p.primaryFor.map((x) => x.name) })),
    ...conditions.map((c) => conditionDoc({ ...c, person: c.person.name, provider: c.provider?.name ?? null })),
    ...medications.map((m) => medicationDoc({
      ...m, person: m.person.name, prescriber: m.prescriber?.name ?? null, condition: m.condition?.name ?? null,
    }, now)),
    ...allergies.map((a) => allergyDoc({ ...a, person: a.person.name })),
    ...immunizations.map((i) => immunizationDoc({ ...i, person: i.person.name })),
    ...observations.map((o) => observationDoc({ ...o, person: o.person.name, condition: o.condition?.name ?? null })),
  ]
}

export const entityHash = (doc: EntityDoc) => createHash("sha256").update(doc.chunks.join("\u0000")).digest("hex").slice(0, 32)

type State = { running?: Promise<SyncResult>; again?: boolean; listening?: boolean }
const g = globalThis as unknown as { __hcEntitySync?: State }
const state: State = (g.__hcEntitySync ??= {})

export type SyncResult = { changed: number; removed: number } | null

async function runSync(): Promise<SyncResult> {
  // Kept whenever indexing is on, so switching semantic search on only has to
  // embed, not rebuild every text first.
  const s = await loadDocumentSettings()
  if (!s.indexingEnabled) return null
  const [docs, index] = await Promise.all([buildEntityDocs(), searchIndex()])
  const stored = await index.entityHashes()
  let changed = 0
  const seen = new Set<string>()
  for (const doc of docs) {
    const key = `${doc.kind}:${doc.id}`
    seen.add(key)
    const hash = entityHash(doc)
    if (stored.get(key) === hash) continue
    await index.replaceEntity(doc.kind, doc.id, hash, doc.chunks)
    changed++
  }
  const gone = [...stored.keys()].filter((k) => !seen.has(k))
  if (gone.length) await index.removeEntities(gone)
  if (changed) documentIndexer().embedNow()
  return { changed, removed: gone.length }
}

/** One sync at a time; a call during a run schedules one more afterwards, so no change is missed. */
export function syncEntities(): Promise<SyncResult> {
  if (state.running) {
    state.again = true
    return state.running
  }
  const run = runSync().finally(() => {
    state.running = undefined
    if (state.again) {
      state.again = false
      void syncEntities().catch(() => {})
    }
  })
  state.running = run
  return run
}

/** Re-sync shortly after any write to a searchable model (see lib/prisma.ts). */
export function listenForEntityChanges(): void {
  if (state.listening) return
  state.listening = true
  onEntitiesChanged(() => {
    syncEntities().then(
      (r) => {
        if (r?.changed || r?.removed) console.info(`[search] records re-indexed: ${r.changed} changed, ${r.removed} removed`)
      },
      (error) => console.error("[search] record sync failed:", error instanceof Error ? error.name : typeof error)
    )
  })
}
