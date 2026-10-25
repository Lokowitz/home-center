import { prisma } from "@/lib/prisma"
import { loadAssetIndex } from "@/lib/assets-server"
import { ASSET_TYPES, assetHref } from "@/lib/assets"
import type { AssetType } from "@/app/generated/prisma/client"
import { ENTITIES, type EntityKey, type Row } from "./ontology"
import {
  CHILD_LIMIT, compileInclude, compileLimit, compileSort, compileWhere, entityDef, healthOffWhere, selectFor, ToolInputError,
  type Filter, type Op, type RelatedFilter, type ToolContext,
} from "./query"
import { serializeRow } from "./serialize"
import { aggregateRows, groupSpec, measureSpec, type MeasureInput } from "./aggregate"
import { entityScopeWhere, nonEmpty } from "./property-scope"

// Runs compiled queries. The only module in the query path that touches Prisma;
// everything it executes was built and validated by query.ts through the ontology.

type Delegate = {
  findMany(args: unknown): Promise<Row[]>
  findFirst(args: unknown): Promise<Row | null>
  count(args: unknown): Promise<number>
}

export function delegate(entity: EntityKey): Delegate {
  return (prisma as unknown as Record<string, Delegate>)[ENTITIES[entity].model]
}

export type AssetIndex = Awaited<ReturnType<typeof loadAssetIndex>>
export type AssetRef = { type: AssetType; id: string; name: string; href: string }

export function assetRef(index: AssetIndex, type: AssetType, id: string): AssetRef {
  return { type, id, name: index.assetName(type, id) ?? "(deleted asset)", href: assetHref(type, id) }
}

export function attachAssets(index: AssetIndex, rows: Row[]) {
  for (const row of rows) {
    if (row.assetType && row.assetId) row.asset = assetRef(index, row.assetType as AssetType, String(row.assetId))
  }
}

function assetNameClause(index: AssetIndex, filter: { op: Op; value: unknown }): Row | null {
  const wanted = (Array.isArray(filter.value) ? filter.value : [filter.value])
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean)
  if (!wanted.length) throw new ToolInputError("asset.name needs a value.")
  const matches = (name: string) => {
    const n = name.toLowerCase()
    return filter.op === "contains" ? wanted.some((w) => n.includes(w)) : wanted.includes(n)
  }
  const or = ASSET_TYPES.flatMap((type) => {
    const ids = Object.entries(index.names[type]).filter(([, n]) => matches(n)).map(([id]) => id)
    return ids.length ? [{ assetType: type, assetId: { in: ids } }] : []
  })
  return or.length ? { OR: or } : null
}

/** Ids of assets of the given type that have at least one related row matching `where`. */
async function assetIdsWith(r: RelatedFilter): Promise<string[]> {
  const rows = await delegate(r.entity).findMany({ where: { AND: [{ assetType: r.assetType }, r.where] }, select: { assetId: true } })
  return [...new Set(rows.map((row) => String(row.assetId)))]
}

/** null means "an asset.name filter matched nothing" — the answer is empty. */
async function resolveWhere(entity: EntityKey, filters: Filter[] | undefined, ctx: ToolContext, index: AssetIndex | null): Promise<Row | null> {
  const { where, assetName, related } = compileWhere(entity, filters, ctx)
  const and: Row[] = [where]
  for (const r of related) {
    const ids = await assetIdsWith(r)
    and.push({ id: r.op === "has" ? { in: ids } : { notIn: ids } })
  }
  if (assetName) {
    if (!index) throw new ToolInputError(`${entity} has no asset to filter on.`)
    const clause = assetNameClause(index, assetName)
    if (!clause) return null
    and.push(clause)
  }
  return and.length === 1 ? where : { AND: and }
}

async function attachChildren(entity: EntityKey, rows: Row[], children: { relation: string; entity: EntityKey }[]) {
  if (!rows.length) return
  const assetType = ENTITIES[entity].assetType
  for (const child of children) {
    const kids = await delegate(child.entity).findMany({
      where: { assetType, assetId: { in: rows.map((r) => r.id) } },
      select: selectFor(child.entity),
      orderBy: compileSort(child.entity),
      take: CHILD_LIMIT * rows.length,
    })
    for (const row of rows) row[child.relation] = kids.filter((k) => k.assetId === row.id).slice(0, CHILD_LIMIT)
  }
}

const NO_ASSET_MATCH = "No asset has a name matching that filter — try the search tool."

export type FindArgs = {
  entity: string
  filters?: Filter[]
  include?: string[]
  fields?: string[]
  sort?: { field: string; dir?: "asc" | "desc" }
  limit?: number
}

export async function findRecords(args: FindArgs, ctx: ToolContext) {
  const { key, def } = entityDef(args.entity, ctx)
  const index = def.polymorphic ? await loadAssetIndex() : null
  const where = await resolveWhere(key, args.filters, ctx, index)
  if (!where) return { entity: key, total: 0, rows: [], note: NO_ASSET_MATCH }

  const plan = compileInclude(key, args.include, args.fields, ctx)
  const d = delegate(key)
  const [rows, total] = await Promise.all([
    d.findMany({ where, select: plan.select, orderBy: compileSort(key, args.sort), take: compileLimit(args.limit) }),
    d.count({ where }),
  ])
  if (index) attachAssets(index, rows)
  if (plan.children.length) await attachChildren(key, rows, plan.children)
  return { entity: key, total, returned: rows.length, rows: rows.map((r) => serializeRow(key, r)) }
}

export async function getRecord(args: { entity: string; id: string; include?: string[] }, ctx: ToolContext) {
  const { key, def } = entityDef(args.entity, ctx)
  const plan = compileInclude(key, args.include, undefined, ctx)
  const where = {
    AND: [
      { id: args.id },
      ...(def.scope ? [def.scope(ctx)] : []),
      ...healthOffWhere(key, ctx),
      ...nonEmpty(entityScopeWhere(key, ctx)),
    ],
  }
  const row = await delegate(key).findFirst({ where, select: plan.select })
  if (!row) throw new ToolInputError(`No ${key} with id "${args.id}". Use search or find_records to get ids.`)
  if (def.polymorphic) attachAssets(await loadAssetIndex(), [row])
  if (plan.children.length) await attachChildren(key, [row], plan.children)
  return { entity: key, record: serializeRow(key, row) }
}

const AGGREGATE_ROW_CAP = 20_000

export type AggregateArgs = { entity: string; measure: MeasureInput; groupBy?: string[]; filters?: Filter[] }

export async function aggregateRecords(args: AggregateArgs, ctx: ToolContext) {
  const { key, def } = entityDef(args.entity, ctx)
  const measure = measureSpec(key, args.measure)
  const groups = (args.groupBy ?? []).map((g) => groupSpec(key, g, ctx))
  const index = def.polymorphic ? await loadAssetIndex() : null
  const where = await resolveWhere(key, args.filters, ctx, index)
  if (!where) return { entity: key, groups: [], total: { value: 0, count: 0 }, note: NO_ASSET_MATCH }

  const select = Object.assign(
    { id: true },
    ...def.keys.map((k) => ({ [k]: true })),
    measure.select,
    ...groups.map((g) => g.select)
  )
  const rows = await delegate(key).findMany({ where, select, take: AGGREGATE_ROW_CAP })
  if (index) attachAssets(index, rows)
  return {
    entity: key,
    ...aggregateRows(rows, measure, groups),
    ...(rows.length === AGGREGATE_ROW_CAP ? { note: `Only the first ${AGGREGATE_ROW_CAP} rows were counted.` } : {}),
  }
}
