import { repeatsLabel } from "@/lib/maintenance-schedule"
import { z } from "zod/v4"
import { prisma } from "@/lib/prisma"
import { loadAssetIndex } from "@/lib/assets-server"
import { assetHref } from "@/lib/assets"
import { loadRegionalSettings } from "@/lib/regional-server"
import { loadReport } from "@/lib/report-server"
import { loadCostRecords } from "@/lib/costs-server"
import { cents, sum } from "@/lib/costs"
import { isSnoozed, scheduleDue } from "@/lib/maintenance-due"
import { loadVehicleMileage } from "@/lib/maintenance-due-server"
import {
  daysUntil, HEALTH_WINDOWS, immunizationDue, insuranceExpiring, isSupersededImmunization, refillDue,
} from "@/lib/health"
import type { AssetType, ServiceCategory } from "@/app/generated/prisma/client"
import { ENTITIES, HEALTH_ENTITIES, ROOM_ENTITIES, type EntityKey, type Row } from "../ontology"
import { coerceValue, entityDef, healthOffWhere, healthOn, inDayRange, roomsOn, requireDay, selectFor, ToolInputError, withLocationSelect, type ToolContext } from "../query"
import { HEALTH_INSURANCE_KINDS } from "@/lib/insurance"
import { compact, serializeRow, toDay } from "../serialize"
import { aggregateRows, groupSpec, measureSpec } from "../aggregate"
import { assetRef, attachAssets, delegate } from "../execute"
import { buildTimeline, type TimelineEvent } from "../timeline"
import { rollUpToProperty } from "../cost-rollup"
import { warrantyState } from "../warranty-status"
import { splitSearchQuery } from "../search-terms"
import { matchAsset, resolveAssetId, type AssetEntry } from "../asset-ids"
import { analyzeObservations } from "../observation-log"
import { observationHref } from "@/lib/observations"
import { defineTool } from "./registry"

// Curated tools for the questions people ask most. Narrow arguments so small
// models call them reliably, and each reuses the logic behind the matching page
// so answers agree with what the app shows.

const assetTypeField = ENTITIES.serviceRecord.fields.assetType
export const toAssetType = (v: string) => coerceValue(assetTypeField, "assetType", v) as AssetType
const optionalDay = (v: string | undefined, name: string) => (v ? requireDay(v, name) : null)
/** Stored dates go to the model as YYYY-MM-DD even when the value has a non-midnight time. */
const dayOrNull = (d: Date | null | undefined) => (d ? toDay(d) : null)

const SEARCHABLE: EntityKey[] = [
  "property", "vehicle", "equipment", "person", "provider", "insurancePolicy", "healthCondition",
  "medication", "allergy", "immunization", "warranty", "maintenanceSchedule", "serviceRecord", "observation",
  "room", "roomPaint",
]

export const searchTool = defineTool({
  name: "search",
  description:
    "Find records by name anywhere in the household data — assets, people, providers, insurance, conditions, medications, allergies, vaccines, warranties, maintenance, service records, rooms and their paint. " +
    "Use it first to turn a name into an id and link. Every word must match (in any searchable field). " +
    "A type word lists that type: 'vehicles' lists vehicles, 'powertrain warranty' searches warranties.",
  schema: z.object({
    query: z.string().min(1).describe("Words to look for, e.g. 'civic' or 'furnace filter'."),
    entities: z.array(z.string()).optional().describe("Only search these entities."),
  }),
  label: (a) => `Searching for “${a.query}”…`,
  run: ({ query, entities }, ctx) => searchRecords(query, entities, ctx),
})

async function searchRecords(query: string, entities: string[] | undefined, ctx: ToolContext) {
  const { words, types } = splitSearchQuery(query)
  if (!words.length && !types.length) throw new ToolInputError("Search needs at least one word of two or more characters.")
  const requested = types.length ? types : entities?.length ? entities.map((e) => entityDef(e, ctx).key) : SEARCHABLE
  // With Health off its entities are skipped, and a person's records with them; likewise rooms with Rooms off.
  const keys = requested.filter((k) => (healthOn(ctx) || !HEALTH_ENTITIES.has(k)) && (roomsOn(ctx) || !ROOM_ENTITIES.has(k)))
  const index = await loadAssetIndex()
  const found = await Promise.all(
    keys.map(async (key) => {
      const def = ENTITIES[key]
      // A person's own records (medications, allergies, observations…) also
      // match on that person's name, so "avery famotidine" finds Avery's
      // famotidine — but at least one word must hit the record itself, or
      // "avery" alone would return every record she has.
      const owned = def.relations.person?.kind === "one"
      // Equipment is also where the UI says it is: its room's name.
      const own = (w: string) => [
        ...def.searchFields.map((f) => ({ [f]: { contains: w } })),
        ...(key === "equipment" ? [{ room: { name: { contains: w } } }] : []),
      ]
      const where = {
        AND: [
          ...words.map((w) => ({ OR: owned ? [...own(w), { person: { name: { contains: w } } }] : own(w) })),
          ...(owned && words.length ? [{ OR: words.flatMap(own) }] : []),
          ...(def.scope ? [def.scope(ctx)] : []),
          ...healthOffWhere(key, ctx),
        ],
      }
      // Say whose record each row is: a bare personId leaves the model unable
      // to tell one child's medication from another's.
      const select = withLocationSelect(key, owned ? { ...selectFor(key), person: { select: { id: true, name: true } } } : selectFor(key))
      // No name words means "list this type", so allow a fuller page.
      const rows = await delegate(key).findMany({ where, select, orderBy: { [def.defaultSort.field]: def.defaultSort.dir }, take: words.length ? 10 : 25 })
      if (def.polymorphic) attachAssets(index, rows)
      return rows.map((r) => ({ entity: key, ...serializeRow(key, r) }))
    })
  )
  const rows = found.flat()
  return {
    query,
    total: rows.length,
    rows,
    // An empty search reads to weak models as "nothing exists"; say where else to look.
    ...(rows.length
      ? {}
      : { note: "No names matched. This does not mean there are none: for spending use cost_summary, to list a type use find_records." }),
  }
}

// --- assets by name -----------------------------------------------------------

export const ASSET_ARG = "A property, vehicle, equipment item or person: its name as the user said it (e.g. 'Civic', 'Gas Furnace', 'Lake Cabin') or an id."
export type FoundAsset = AssetEntry & { href: string }
export const assetLinkRef = (a: FoundAsset) => ({ type: a.type, name: a.name, href: a.href })

async function loadAssetCatalog(): Promise<AssetEntry[]> {
  const [index, vehicles] = await Promise.all([
    loadAssetIndex(),
    prisma.vehicle.findMany({ select: { id: true, year: true, make: true, model: true } }),
  ])
  const aka = new Map(vehicles.map((v) => [v.id, [v.year, v.make, v.model].filter(Boolean).join(" ")]))
  return (Object.keys(index.names) as AssetType[]).flatMap((type) =>
    Object.entries(index.names[type]).map(([id, name]) => ({ type, id, name, aka: aka.get(id) }))
  )
}

/**
 * Resolves a name or id to one asset. When it can't, returns what the tool
 * should reply instead: the candidates for an ambiguous name, or — for a name
 * that matches nothing — the results of searching for it, so the model doesn't
 * spend a round calling search itself.
 */
export async function findAsset(raw: string, ctx: ToolContext, types?: AssetType[]): Promise<{ asset: FoundAsset } | { reply: unknown }> {
  const withHref = (a: AssetEntry): FoundAsset => ({ ...a, href: assetHref(a.type, a.id) })
  const m = matchAsset(await loadAssetCatalog(), raw, types)
  if (m.kind === "found") return { asset: withHref(m.asset) }
  if (m.kind === "ambiguous") {
    return {
      reply: {
        lookedFor: raw,
        note: `"${raw}" matches ${m.matches.length} records. Call again with the one you mean (its id or exact name), or ask the user which one.`,
        matches: m.matches.slice(0, 10).map((a) => ({ id: a.id, ...assetLinkRef(withHref(a)) })),
      },
    }
  }
  const found = await searchRecords(raw, undefined, ctx).catch((e) => {
    if (e instanceof ToolInputError) return { total: 0, rows: [] }
    throw e
  })
  return {
    reply: found.total
      ? {
          lookedFor: raw,
          note: `Nothing is named "${raw}", so it was searched for instead (results below). If one of these is what was meant, call again with its id.`,
          search: { total: found.total, rows: found.rows },
        }
      : { lookedFor: raw, note: `Nothing is named "${raw}", and searching for it found nothing. It may not be tracked in HomeCenter.` },
  }
}

/** A property's own rows plus those of the equipment installed there. */
async function propertyScope(propertyId: string) {
  const equipment = await prisma.equipment.findMany({ where: { propertyId }, select: { id: true } })
  return {
    OR: [
      { assetType: "PROPERTY" as const, assetId: propertyId },
      { assetType: "EQUIPMENT" as const, assetId: { in: equipment.map((e) => e.id) } },
    ],
  }
}

/** Where-clause and reply header for the optional asset of warranty_status / maintenance_status. */
async function assetScope(a: { asset?: string; assetType?: string }, ctx: ToolContext) {
  const assetType = a.assetType ? toAssetType(a.assetType) : undefined
  if (!a.asset) return { where: assetType ? { assetType } : healthOn(ctx) ? {} : { assetType: { not: "PERSON" as const } } }
  const found = await findAsset(a.asset, ctx, assetType ? [assetType] : undefined)
  if ("reply" in found) return found
  const { asset } = found
  return asset.type === "PROPERTY"
    ? { where: await propertyScope(asset.id), header: { property: assetLinkRef(asset), note: "Includes equipment installed at this property." } }
    : { where: { assetType: asset.type, assetId: asset.id }, header: { for: assetLinkRef(asset) } }
}

const COST_GROUPS = {
  asset: "asset", year: "date:year", quarter: "date:quarter", month: "date:month", category: "category", vendor: "vendor",
} as const

export const costSummaryTool = defineTool({
  name: "cost_summary",
  description:
    "Total spending from service records (repairs, maintenance, medical visits), grouped by asset, year, quarter, month, category or vendor. " +
    "Use it for 'how much did we spend', comparisons between assets or people, and year-over-year questions. People are assets (assetType PERSON). " +
    "A property's spending includes the equipment installed there.",
  schema: z.object({
    groupBy: z.array(z.enum(["asset", "year", "quarter", "month", "category", "vendor"])).min(1).max(2),
    assetType: z.string().optional().describe("PROPERTY, VEHICLE, EQUIPMENT or PERSON."),
    assets: z.array(z.string()).max(20).optional().describe("Only these assets or people: names as the user said them (e.g. ['Commuter', 'Work Truck']) or ids."),
    from: z.string().optional().describe("YYYY-MM-DD, inclusive."),
    to: z.string().optional().describe("YYYY-MM-DD, inclusive."),
    category: z.string().optional().describe("A service category, e.g. REPAIR, ROUTINE, OFFICE_VISIT."),
  }),
  aliases: { assetIds: "assets" },
  label: () => "Adding up costs…",
  async run(a, ctx) {
    const found: FoundAsset[] = []
    for (const raw of a.assets ?? []) {
      const f = await findAsset(raw, ctx, a.assetType ? [toAssetType(a.assetType)] : undefined)
      if ("reply" in f) return f.reply
      found.push(f.asset)
    }
    // Named assets set the scope themselves; a mismatched type guess would only empty the result.
    const assetType = a.assetType && !found.length ? toAssetType(a.assetType) : undefined
    const from = optionalDay(a.from, "from")
    const to = optionalDay(a.to, "to")
    const category = a.category
      ? (coerceValue(ENTITIES.serviceRecord.fields.category, "category", a.category) as ServiceCategory)
      : null

    const [records, index, installed] = await Promise.all([
      loadCostRecords(),
      loadAssetIndex(),
      prisma.equipment.findMany({ where: { propertyId: { not: null } }, select: { id: true, propertyId: true } }),
    ])
    const assetIds = found.map((f) => f.id)
    // Equipment spending counts toward its property whenever properties are what's being asked about.
    const wanted = assetIds?.length ? new Set(assetIds) : null
    const rolled = rollUpToProperty(
      records,
      new Map(installed.map((e) => [e.id, e.propertyId!])),
      (propertyId) => (wanted ? wanted.has(propertyId) : assetType === "PROPERTY")
    )
    const rows: Row[] = rolled
      .filter(
        (r) =>
          (!assetType || r.assetType === assetType) &&
          inDayRange(r.date, { from, to }) &&
          (!category || r.category === category) &&
          (!assetIds?.length || assetIds.includes(r.assetId))
      )
      .map((r) => ({ ...r }))
    attachAssets(index, rows)

    return {
      ...(found.length ? { assets: found.map(assetLinkRef) } : {}),
      currency: (await loadRegionalSettings()).currency,
      ...(rows.some((r) => r.viaEquipmentId) ? { note: "Property totals include spending on equipment at the property." } : {}),
      ...aggregateRows(
        rows,
        measureSpec("serviceRecord", { op: "sum", field: "cost" }),
        a.groupBy.map((g) => groupSpec("serviceRecord", COST_GROUPS[g]))
      ),
    }
  },
})

export const assetHistoryTool = defineTool({
  name: "asset_history",
  description:
    "Full chronological history of one property, vehicle, equipment item or person: service records with costs, warranty start/expiry, maintenance completed, " +
    "and for people conditions, medications and immunizations (logged observations like meltdowns are in observation_log). " +
    "Pass the name as the user said it; no search needed.",
  schema: z.object({
    asset: z.string().min(1).describe(ASSET_ARG),
    assetType: z.string().optional().describe("PROPERTY, VEHICLE, EQUIPMENT or PERSON, if known."),
    from: z.string().optional().describe("YYYY-MM-DD, inclusive."),
    to: z.string().optional().describe("YYYY-MM-DD, inclusive."),
  }),
  aliases: { assetId: "asset" },
  label: () => "Reading the history…",
  async run(a, ctx) {
    const found = await findAsset(a.asset, ctx, a.assetType ? [toAssetType(a.assetType)] : undefined)
    if ("reply" in found) return found.reply
    const { type, id: assetId } = found.asset
    const report = await loadReport(type, assetId)
    if (!report) throw new ToolInputError(`No ${type.toLowerCase()} with id "${assetId}". Use search to find the id.`)
    const range = { from: optionalDay(a.from, "from"), to: optionalDay(a.to, "to") }

    // A property's history and spending include the equipment installed there.
    const equipment = type === "PROPERTY"
      ? await prisma.equipment.findMany({ where: { propertyId: assetId }, select: { id: true, name: true } })
      : []
    const equipmentName = new Map(equipment.map((e) => [e.id, e.name]))
    const equipmentServices = equipment.length
      ? await prisma.serviceRecord.findMany({ where: { assetType: "EQUIPMENT", assetId: { in: [...equipmentName.keys()] } } })
      : []
    const equipmentEvents: TimelineEvent[] = equipmentServices
      .filter((s) => inDayRange(s.date, range))
      .map((s) => ({
        date: toDay(s.date),
        kind: "service",
        title: s.title,
        ...compact({ equipment: equipmentName.get(s.assetId), vendor: s.vendor, cost: s.cost, category: s.category }),
      }))

    return {
      asset: compact({ type, id: assetId, name: report.asset.name, subtitle: report.asset.subtitle, href: assetHref(type, assetId) }),
      totalCost: cents(sum(report.costRows) + equipmentServices.reduce((total, s) => total + (s.cost ?? 0), 0)),
      ...(equipment.length ? { note: "Includes service on equipment at this property." } : {}),
      rows: [...buildTimeline(report, range), ...equipmentEvents].sort((x, y) => x.date.localeCompare(y.date)),
    }
  },
})

export const warrantyStatusTool = defineTool({
  name: "warranty_status",
  description:
    "Warranties with their state worked out for you: expired, expiring (within withinDays, default 180 ≈ 6 months) or active. " +
    "Use for 'which warranties expire soon', 'is the generator still under warranty', 'what has expired'. " +
    "For a property, the equipment installed there is included.",
  schema: z.object({
    status: z.enum(["expiring", "expired", "active", "all"]).optional().describe("Default expiring."),
    withinDays: z.coerce.number().int().min(0).max(3650).optional().describe("Window for 'expiring'. Default 180."),
    assetType: z.string().optional().describe("Only this kind: PROPERTY, VEHICLE, EQUIPMENT or PERSON."),
    asset: z.string().optional().describe(ASSET_ARG),
  }),
  aliases: { assetId: "asset" },
  label: () => "Checking warranties…",
  async run(a, ctx) {
    const scope = await assetScope(a, ctx)
    if ("reply" in scope) return scope.reply
    const index = await loadAssetIndex()
    const warranties = await prisma.warranty.findMany({ where: scope.where, orderBy: { expirationDate: "asc" } })
    const status = a.status ?? "expiring"
    const withinDays = a.withinDays ?? 180
    const rows = warranties
      .map((w) => ({ w, ...warrantyState(w.expirationDate, ctx.now, withinDays) }))
      .filter(({ state }) => status === "all" || state === status)
      .map(({ w, state, daysLeft }) =>
        compact({
          id: w.id,
          product: w.productName,
          state,
          expirationDate: dayOrNull(w.expirationDate),
          daysLeft,
          vendor: w.vendor,
          vendorPhone: w.vendorPhone,
          asset: assetRef(index, w.assetType, w.assetId),
          href: assetHref(w.assetType, w.assetId),
        })
      )
    return { ...scope.header, asOf: toDay(ctx.now), status, withinDays, total: rows.length, rows }
  },
})

export const maintenanceStatusTool = defineTool({
  name: "maintenance_status",
  description:
    "Maintenance and checkup schedules with their due state (overdue, due_soon, ok), including mileage/hour-based due for vehicles. " +
    "Use for 'what's due', 'what's overdue', 'when is the next oil change'. For a property, the equipment installed there is included. " +
    "snoozedUntil is set when someone has put a reminder off until then; paused reminders are left out.",
  schema: z.object({
    status: z.enum(["overdue", "due_soon", "all"]).optional().describe("Default all."),
    assetType: z.string().optional().describe("Only this kind: PROPERTY, VEHICLE, EQUIPMENT or PERSON."),
    asset: z.string().optional().describe(ASSET_ARG),
    withinDays: z.coerce.number().int().min(0).max(3650).optional().describe("Only items overdue or due within this many days."),
  }),
  aliases: { assetId: "asset" },
  label: () => "Checking maintenance…",
  async run(a, ctx) {
    const scope = await assetScope(a, ctx)
    if ("reply" in scope) return scope.reply
    const index = await loadAssetIndex()
    const [schedules, mileage] = await Promise.all([
      prisma.maintenanceSchedule.findMany({
        where: { isActive: true, ...scope.where },
        orderBy: { nextDueDate: "asc" },
      }),
      loadVehicleMileage(),
    ])
    const status = a.status ?? "all"
    const rows = schedules
      .map((s) => {
        const due = scheduleDue(s, mileage, ctx.now)
        return { s, due, state: due.overdue ? "overdue" : due.dueSoon ? "due_soon" : "ok" }
      })
      .filter(({ state }) => status === "all" || state === status)
      .filter(
        ({ due, state }) =>
          a.withinDays == null ||
          state === "overdue" ||
          // Mileage-only schedules have no daysLeft; their due_soon state is the best "within" signal.
          (due.daysLeft == null ? state === "due_soon" : due.daysLeft <= a.withinDays)
      )
      .map(({ s, due, state }) =>
        compact({
          id: s.id,
          title: s.title,
          state,
          asset: assetRef(index, s.assetType, s.assetId),
          nextDueDate: dayOrNull(s.nextDueDate),
          nextDueMeter: s.nextDueMileage,
          daysLeft: due.daysLeft,
          meterLeft: due.milesLeft,
          meterUnit: due.meterUnit,
          lastCompletedDate: dayOrNull(s.lastCompletedDate),
          repeats: repeatsLabel(s, mileage.get(s.assetId)?.unit === "HOURS" ? "hr" : "mi"),
          estimatedCost: s.estimatedCost,
          intervalDays: s.intervalDays,
          intervalMeter: s.intervalMiles,
          snoozedUntil: isSnoozed(s, ctx.now) ? dayOrNull(s.snoozedUntil) : null,
          href: assetHref(s.assetType, s.assetId),
        })
      )
    return { ...scope.header, asOf: toDay(ctx.now), total: rows.length, rows }
  },
})

const personRef = (p: { id: string; name: string }) => ({ id: p.id, name: p.name, href: assetHref("PERSON", p.id) })

export const healthAlertsTool = defineTool({
  name: "health_alerts",
  description:
    `Health items needing attention: medication refills due within ${HEALTH_WINDOWS.refillDays} days, immunizations due within ${HEALTH_WINDOWS.immunizationDays} days, ` +
    `insurance expiring within ${HEALTH_WINDOWS.insuranceDays} days. Optionally for one person.`,
  schema: z.object({ personId: z.string().optional() }),
  label: () => "Checking health reminders…",
  async run(a, ctx) {
    const personId = a.personId ? resolveAssetId((await loadAssetIndex()).names, a.personId, ["PERSON"]) : undefined
    const byPerson = personId ? { personId } : {}
    const person = { select: { id: true, name: true } } as const
    const [meds, imms, policies] = await Promise.all([
      prisma.medication.findMany({ where: { ...byPerson, nextRefillDate: { not: null } }, include: { person } }),
      prisma.immunization.findMany({ where: byPerson, include: { person } }),
      prisma.insurancePolicy.findMany({
        where: { kind: { in: [...HEALTH_INSURANCE_KINDS] }, endDate: { not: null }, ...(personId ? { members: { some: { id: personId } } } : {}) },
        include: { members: person },
      }),
    ])
    return {
      asOf: toDay(ctx.now),
      refillsDue: meds
        .filter((m) => refillDue(m, ctx.now))
        .map((m) => compact({ id: m.id, medication: m.name, dosage: m.dosage, pharmacy: m.pharmacy, nextRefillDate: dayOrNull(m.nextRefillDate), daysUntil: daysUntil(m.nextRefillDate!, ctx.now), person: personRef(m.person), href: assetHref("PERSON", m.person.id) })),
      immunizationsDue: imms
        .filter((i) => immunizationDue(i, ctx.now) && !isSupersededImmunization(i, imms))
        .map((i) => compact({ id: i.id, vaccine: i.vaccine, nextDueDate: dayOrNull(i.nextDueDate), daysUntil: daysUntil(i.nextDueDate!, ctx.now), person: personRef(i.person), href: assetHref("PERSON", i.person.id) })),
      insuranceExpiring: policies
        .filter((p) => insuranceExpiring(p, ctx.now))
        .map((p) => compact({ id: p.id, carrier: p.carrier, planName: p.planName, kind: p.kind, endDate: dayOrNull(p.endDate), daysUntil: daysUntil(p.endDate!, ctx.now), members: p.members.map(personRef), href: "/insurance" })),
    }
  },
})

export const observationLogTool = defineTool({
  name: "observation_log",
  description:
    "Observations the family logged about a person — meltdowns, bad nights, symptoms, moods — with counts by type, month, weekday, " +
    "time of day and tag, average severity (1 mild to 5 severe), and the entries themselves with notes. " +
    "Use it for 'how many meltdowns in May', 'when do they happen', 'what usually comes before one', 'show me the notes from last week', " +
    "'every time she mentioned not wanting to live' (text searches the notes too).",
  schema: z.object({
    personId: z.string().optional().describe("Person id from search (a person's exact name also works). Omit for everyone."),
    type: z.string().optional().describe("Only entries whose type contains this, e.g. 'meltdown'. Omit for all types."),
    text: z.string().optional().describe("Only entries whose type, notes or tags contain this, e.g. 'teeth chattering' or 'school'."),
    from: z.string().optional().describe("YYYY-MM-DD, inclusive."),
    to: z.string().optional().describe("YYYY-MM-DD, inclusive."),
  }),
  label: (a) => (a.type ? `Reading the ${a.type} log…` : "Reading the observation log…"),
  async run(a, ctx) {
    const personId = a.personId ? resolveAssetId((await loadAssetIndex()).names, a.personId, ["PERSON"]) : undefined
    const range = { from: optionalDay(a.from, "from"), to: optionalDay(a.to, "to") }
    const rows = await prisma.observation.findMany({
      where: personId ? { personId } : {},
      include: { condition: { select: { name: true } }, person: { select: { id: true, name: true } } },
    })
    const wanted = a.type?.trim().toLowerCase()
    const text = a.text?.trim().toLowerCase()
    const mentions = (r: (typeof rows)[number]) => [r.type, r.notes, r.tags].some((v) => v?.toLowerCase().includes(text!))
    const entries = rows.filter((r) => (!wanted || r.type.toLowerCase().includes(wanted)) && (!text || mentions(r)) && inDayRange(r.date, range))
    const people = new Set(entries.map((e) => e.person.id))
    const knownTypes = [...new Set(rows.map((r) => r.type))]
    return {
      asOf: toDay(ctx.now),
      ...(personId && rows[0] ? { person: personRef(rows[0].person) } : {}),
      ...analyzeObservations(entries, { href: (e) => observationHref(e.person.id, e.id), manyPeople: people.size > 1 }),
      // An empty result reads as "it never happened"; say what is logged instead.
      ...(entries.length ? {} : { note: knownTypes.length ? `Nothing matched. Types logged: ${knownTypes.join(", ")}.` : "No observations are logged." }),
    }
  },
})
