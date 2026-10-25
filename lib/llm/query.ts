import { ENTITIES, ENTITY_KEYS, HEALTH_ENTITIES, ROOM_ENTITIES, entityKeysFor, type EntityDef, type EntityKey, type FieldDef, type FieldType, type RelationDef, type Row } from "./ontology"
import { HEALTH_NOTIFICATION_TYPES } from "@/lib/features"
import type { AgentEvent } from "./types"
import type { PropertyScope } from "@/lib/property-filter"
import { entityScopeWhere, nonEmpty } from "./property-scope"

// Compiles tool arguments into Prisma query fragments through the ontology.
// Pure: no Prisma import. Every name the model sends is checked against the
// ontology, and every rejection says what would have been valid so the model
// can correct itself within its rounds.

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ToolInputError"
  }
}

export const OPS = ["eq", "ne", "contains", "in", "gt", "gte", "lt", "lte", "isNull", "has", "hasNone"] as const
export type Op = (typeof OPS)[number]
export type Filter = { field: string; op: Op; value?: unknown }
/**
 * health: false while Health is off in Settings → Features; absent means on.
 * rooms: the same for Rooms.
 * today: the viewer's calendar day (YYYY-MM-DD), when the page sent it.
 * emit: sends an event straight to the page (only draft tools use it).
 * scope, hiddenEntityIds: the property filter, from the chat route; absent or null means All properties.
 */
export type ToolContext = {
  userId: string; now: Date; health?: boolean; rooms?: boolean; today?: string; emit?: (event: AgentEvent) => void
  scope?: PropertyScope | null; hiddenEntityIds?: string[]
}

export const healthOn = (ctx?: Pick<ToolContext, "health">) => ctx?.health !== false
export const roomsOn = (ctx?: Pick<ToolContext, "rooms">) => ctx?.rooms !== false

const HEALTH_OFF = "isn't available: Health is turned off in Settings."
const ROOMS_OFF = "isn't available: Rooms is turned off in Settings."

/** Throws when an entity belongs to a feature that is off (Health, Rooms). */
export function requireReachable(key: EntityKey, ctx?: Pick<ToolContext, "health" | "rooms">) {
  if (!healthOn(ctx) && HEALTH_ENTITIES.has(key)) throw new ToolInputError(`${key} ${HEALTH_OFF}`)
  if (!roomsOn(ctx) && ROOM_ENTITIES.has(key)) throw new ToolInputError(`${key} ${ROOMS_OFF}`)
}
/**
 * has/hasNone on an asset's warranties, service records or schedules. Those
 * point back at the asset by assetType + assetId, which Prisma can't follow
 * as a relation, so the executor looks up the matching asset ids.
 */
export type RelatedFilter = { entity: EntityKey; assetType: string; op: "has" | "hasNone"; where: Row }

const EXISTS_OPS: Op[] = ["has", "hasNone"]

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100
export const CHILD_LIMIT = 50

const OPS_BY_TYPE: Record<FieldType, Op[]> = {
  string: ["eq", "ne", "contains", "in", "isNull"],
  int: ["eq", "ne", "gt", "gte", "lt", "lte", "isNull"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "isNull"],
  money: ["eq", "ne", "gt", "gte", "lt", "lte", "isNull"],
  date: ["eq", "ne", "gt", "gte", "lt", "lte", "isNull"],
  boolean: ["eq"],
  enum: ["eq", "ne", "in", "isNull"],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "")

export function entityDef(raw: string, ctx?: Pick<ToolContext, "health" | "rooms">): { key: EntityKey; def: EntityDef } {
  const n = norm(String(raw))
  const key = ENTITY_KEYS.find((k) => norm(k) === n || norm(ENTITIES[k].plural) === n)
  if (!key) throw new ToolInputError(`Unknown entity "${raw}". Valid entities: ${entityKeysFor(healthOn(ctx), roomsOn(ctx)).join(", ")}.`)
  requireReachable(key, ctx)
  return { key, def: ENTITIES[key] }
}

function fieldDef(entity: EntityKey, name: string): FieldDef {
  const f = ENTITIES[entity].fields[name]
  if (!f) {
    throw new ToolInputError(`Unknown field "${name}" on ${entity}. Valid fields: ${Object.keys(ENTITIES[entity].fields).join(", ")}.`)
  }
  return f
}

/**
 * What Health off adds to every query of an entity: nothing a person owns, no health
 * notifications, no health-kind policies (or their premiums and coverage lines).
 */
export function healthOffWhere(entity: EntityKey, ctx?: Pick<ToolContext, "health">): Row[] {
  if (healthOn(ctx)) return []
  const def = ENTITIES[entity]
  return [
    ...(def.polymorphic ? [{ assetType: { not: "PERSON" } }] : []),
    ...(entity === "notification" ? [{ type: { notIn: [...HEALTH_NOTIFICATION_TYPES] } }] : []),
    ...(def.healthOff ? [def.healthOff] : []),
  ]
}

/** Whether a relation leads somewhere the assistant may go (not into a feature that's off). */
const relationReachable = (r: RelationDef, ctx?: Pick<ToolContext, "health" | "rooms">) =>
  !("entity" in r) || ((healthOn(ctx) || !HEALTH_ENTITIES.has(r.entity)) && (roomsOn(ctx) || !ROOM_ENTITIES.has(r.entity)))

/** An entity's relation names for error messages, leaving out ones into a feature that's off. */
export function relationNames(entity: EntityKey, ctx?: Pick<ToolContext, "health" | "rooms">) {
  return Object.entries(ENTITIES[entity].relations).filter(([, r]) => relationReachable(r, ctx)).map(([n]) => n).join(", ") || "none"
}

export function requireDay(value: unknown, name: string): Date {
  const m = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value.trim()) : null
  if (m) {
    const d = new Date(`${m[1]}T00:00:00.000Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[1]) return d
  }
  throw new ToolInputError(`${name} needs a date as YYYY-MM-DD (got ${JSON.stringify(value)}).`)
}

export function coerceValue(field: FieldDef, name: string, value: unknown): unknown {
  switch (field.type) {
    case "string":
      if (typeof value === "string" || typeof value === "number") return String(value)
      break
    case "int": {
      const n = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value)
      if (value !== "" && value !== null && Number.isInteger(n)) return n
      break
    }
    case "number":
    case "money": {
      const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value)
      if (value !== "" && value !== null && Number.isFinite(n)) return n
      break
    }
    case "boolean":
      if (typeof value === "boolean") return value
      if (value === "true" || value === "false") return value === "true"
      break
    case "date":
      return requireDay(value, name)
    case "enum": {
      const v = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_")
      if (field.values!.includes(v)) return v
      throw new ToolInputError(`${name} must be one of ${field.values!.join(", ")} (got ${JSON.stringify(value)}).`)
    }
  }
  throw new ToolInputError(`${name} expects a ${field.type} (got ${JSON.stringify(value)}).`)
}

const DAY_MS = 86_400_000

/** The UTC midnight after d. */
export function nextDay(d: Date): Date {
  return new Date(d.getTime() + DAY_MS)
}

/**
 * Whether a stored date falls within [from, to] as whole UTC days. Stored values
 * can carry a time of day (a service logged at 14:28), so "to" covers all of its day.
 */
export function inDayRange(when: Date, range: { from?: Date | null; to?: Date | null }): boolean {
  const t = when.getTime()
  return (!range.from || t >= range.from.getTime()) && (!range.to || t < nextDay(range.to).getTime())
}

function requireList(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new ToolInputError(`"in" on ${name} needs a non-empty array.`)
  return value
}

/** Row ids and foreign keys (personId, assetId…) can be matched exactly, for chaining lookups. */
const KEY_FIELD: FieldDef = { type: "string" }
const KEY_OPS: Op[] = ["eq", "in"]

function filterField(entity: EntityKey, name: string): { field: FieldDef; isKey: boolean } {
  const def = ENTITIES[entity]
  if (def.fields[name]) return { field: def.fields[name], isKey: false }
  if (name === "id" || def.keys.includes(name)) return { field: KEY_FIELD, isKey: true }
  const keys = ["id", ...def.keys].join(", ")
  throw new ToolInputError(`Unknown field "${name}" on ${entity}. Valid fields: ${Object.keys(def.fields).join(", ")} (and ${keys} with eq or in).`)
}

/** A where fragment for one filter on column `key` (an object, since some ops need OR). */
function fieldWhere(field: FieldDef, isKey: boolean, key: string, name: string, op: Op, value: unknown): Row {
  const allowed = isKey ? KEY_OPS : OPS_BY_TYPE[field.type]
  if (!allowed.includes(op)) {
    throw new ToolInputError(`Operator "${op}" can't be used on ${name} (${isKey ? "id" : field.type}). Allowed: ${allowed.join(", ")}.`)
  }
  const coerce = (v: unknown) => coerceValue(field, name, v)

  if (op === "isNull") return { [key]: value === false || value === "false" ? { not: null } : null }

  if (field.type === "string" && !isKey && (op === "eq" || op === "ne" || op === "in")) {
    // SQLite's = is case-sensitive but LIKE isn't, so an exact match that
    // ignores case is "starts and ends with the value".
    const exact = (v: unknown) => {
      const s = coerce(v) as string
      return s ? { startsWith: s, endsWith: s } : { equals: s }
    }
    if (op === "eq") return { [key]: exact(value) }
    if (op === "ne") return { NOT: { [key]: exact(value) } }
    return { OR: requireList(value, name).map((v) => ({ [key]: exact(v) })) }
  }

  if (field.type === "date" && (op === "eq" || op === "ne" || op === "lte" || op === "gt")) {
    // Days, not instants: stored dates can carry a time of day.
    const day = coerce(value) as Date
    const next = nextDay(day)
    if (op === "eq") return { [key]: { gte: day, lt: next } }
    if (op === "ne") return { NOT: { [key]: { gte: day, lt: next } } }
    if (op === "lte") return { [key]: { lt: next } }
    return { [key]: { gte: next } }
  }

  switch (op) {
    case "in":
      return { [key]: { in: requireList(value, name).map(coerce) } }
    case "eq":
      return { [key]: { equals: coerce(value) } }
    case "ne":
      return { [key]: { not: coerce(value) } }
    default:
      return { [key]: { [op]: coerce(value) } }
  }
}

/** The optional conditions on the related rows of a has/hasNone filter. */
function relatedConditions(f: Filter, related: EntityKey): Filter[] {
  if (f.value === undefined || f.value === null) return []
  const list = Array.isArray(f.value) ? f.value : null
  if (!list || !list.every((c) => c && typeof c === "object" && "field" in c && "op" in c)) {
    const fields = Object.entries(ENTITIES[related].fields)
    const [name] = fields.find(([, d]) => d.type === "date") ?? fields[0]
    throw new ToolInputError(
      `${f.op} on ${f.field} takes an optional list of conditions on the related ${related} rows, e.g. [{"field":"${name}","op":"gte","value":"2026-01-01"}].`
    )
  }
  if (list.some((c) => EXISTS_OPS.includes((c as Filter).op))) throw new ToolInputError("has/hasNone can't be nested inside another has/hasNone.")
  return list as Filter[]
}

export function compileWhere(
  entity: EntityKey,
  filters: Filter[] | undefined,
  ctx: ToolContext
): { where: Row; assetName: { op: Op; value: unknown } | null; related: RelatedFilter[] } {
  const def = ENTITIES[entity]
  const and: Row[] = []
  const related: RelatedFilter[] = []
  let assetName: { op: Op; value: unknown } | null = null

  for (const f of filters ?? []) {
    const [head, tail, ...rest] = String(f.field).split(".")
    if (rest.length) throw new ToolInputError(`Filters can follow one relation at most ("${f.field}").`)

    if (EXISTS_OPS.includes(f.op)) {
      const rel = tail ? undefined : def.relations[head]
      if (!rel) {
        const lists = Object.entries(def.relations)
          .filter(([, r]) => (r.kind === "many" || r.kind === "assetChildren") && relationReachable(r, ctx))
          .map(([n]) => n)
        throw new ToolInputError(`${f.op} goes on a list relation of ${entity}: ${lists.join(", ") || "none"}. Put conditions on its rows in value.`)
      }
      if (rel.kind === "one" || rel.kind === "asset") {
        throw new ToolInputError(`"${head}" is a single record, not a list; filter ${head}.<field> instead.`)
      }
      requireReachable(rel.entity, ctx)
      const sub = compileWhere(rel.entity, relatedConditions(f, rel.entity), ctx)
      if (sub.assetName) throw new ToolInputError(`asset.name can't be used inside ${f.op}.`)
      const op = f.op as RelatedFilter["op"]
      if (rel.kind === "assetChildren") related.push({ entity: rel.entity, assetType: def.assetType!, op, where: sub.where })
      else and.push({ [head]: { [op === "has" ? "some" : "none"]: sub.where } })
      continue
    }

    if (!tail) {
      const { field, isKey } = filterField(entity, head)
      and.push(fieldWhere(field, isKey, head, head, f.op, f.value))
      continue
    }

    const rel = def.relations[head]
    if (!rel) throw new ToolInputError(`Unknown relation "${head}" on ${entity}. Relations: ${relationNames(entity, ctx)}.`)
    if ("entity" in rel) requireReachable(rel.entity, ctx)

    if (rel.kind === "asset") {
      if (tail !== "name") throw new ToolInputError(`Only asset.name can be filtered; use the assetType field for the kind of asset.`)
      if (!["eq", "contains", "in"].includes(f.op)) throw new ToolInputError(`asset.name supports eq, contains or in.`)
      assetName = { op: f.op, value: f.value }
      continue
    }
    if (rel.kind === "assetChildren") {
      throw new ToolInputError(
        `Can't filter ${entity} by ${head}.${tail} directly. For ${entity} rows with matching ${head}, use {"field":"${head}","op":"has","value":[{"field":"${tail}","op":"…","value":…}]}.`
      )
    }

    const { field, isKey } = filterField(rel.entity, tail)
    const cond = fieldWhere(field, isKey, tail, `${head}.${tail}`, f.op, f.value)
    and.push({ [head]: rel.kind === "many" ? { some: cond } : { is: cond } })
  }

  // Scope goes last and is ANDed, so nothing the model sends can widen it.
  if (def.scope) and.push(def.scope(ctx))
  and.push(...healthOffWhere(entity, ctx))
  and.push(...nonEmpty(entityScopeWhere(entity, ctx)))
  return { where: and.length ? { AND: and } : {}, assetName, related }
}

export function compileSort(entity: EntityKey, sort?: { field: string; dir?: "asc" | "desc" }): Row {
  const def = ENTITIES[entity]
  if (!sort) return { [def.defaultSort.field]: def.defaultSort.dir }
  fieldDef(entity, sort.field)
  return { [sort.field]: sort.dir === "desc" ? "desc" : "asc" }
}

export function compileLimit(limit: unknown): number {
  const n = Math.floor(Number(limit))
  if (limit === undefined || limit === null || !Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, n))
}

export function selectFor(entity: EntityKey, fields?: string[]): Row {
  const def = ENTITIES[entity]
  const chosen = fields?.length ? fields : Object.keys(def.fields)
  for (const f of chosen) fieldDef(entity, f)
  return Object.fromEntries(["id", def.nameField, ...def.keys, ...chosen].map((k) => [k, true]))
}

export function compileInclude(
  entity: EntityKey,
  include: string[] = [],
  fields?: string[],
  ctx?: Pick<ToolContext, "health" | "rooms" | "scope" | "hiddenEntityIds">
): { select: Row; children: { relation: string; entity: EntityKey }[] } {
  const def = ENTITIES[entity]
  const select = selectFor(entity, fields)
  const children: { relation: string; entity: EntityKey }[] = []

  for (const name of include) {
    const rel = def.relations[name]
    if (!rel) throw new ToolInputError(`Unknown relation "${name}". Relations on ${entity}: ${relationNames(entity, ctx)}.`)
    if (rel.kind === "asset") continue // always attached for polymorphic rows
    requireReachable(rel.entity, ctx)
    if (rel.kind === "assetChildren") {
      children.push({ relation: name, entity: rel.entity })
      continue
    }
    // A visible policy or provider can list people and assets the property filter hides.
    const scoped = entityScopeWhere(rel.entity, ctx ?? {})
    select[name] =
      rel.kind === "one"
        ? { select: selectFor(rel.entity) }
        : {
            select: selectFor(rel.entity),
            ...(Object.keys(scoped).length ? { where: scoped } : {}),
            orderBy: compileSort(rel.entity),
            take: CHILD_LIMIT,
          }
  }
  // A person's own records always say whose they are. With only a personId a
  // model can't tell one child's fluoxetine from another's, and won't think to
  // ask for the person relation.
  if (def.relations.person?.kind === "one" && !select.person) select.person = { select: { id: true, name: true } }
  // A room's paint is part of what the room is, so a plain lookup carries it.
  if (entity === "room" && !select.paints) {
    select.paints = { select: selectFor("roomPaint"), orderBy: compileSort("roomPaint"), take: CHILD_LIMIT }
  }
  return { select: withLocationSelect(entity, select), children }
}

/**
 * Equipment's location reads as the UI shows it — its room's name, else the
 * free text — whether or not Rooms is on, so a selected location brings the
 * room's name along. serializeRow folds it in and drops this name-only room.
 */
export function withLocationSelect(entity: EntityKey, select: Row): Row {
  if (entity !== "equipment" || !select.location || select.room) return select
  return { ...select, room: { select: { name: true } } }
}
