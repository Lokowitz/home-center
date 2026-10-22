import { cents } from "@/lib/costs"
import { ENTITIES, type EntityKey, type Row } from "./ontology"
import { relationNames, requireReachable, ToolInputError, type ToolContext } from "./query"
import { compact, toDay } from "./serialize"

// In-memory grouping for the aggregate and cost_summary tools. Same reasoning
// as lib/costs-server.ts: SQLite can't group by an extracted year without raw
// SQL, and polymorphic asset names can't be resolved in an aggregate query.
// Fine at household scale.

export type DateBucket = "year" | "quarter" | "month"
const BUCKETS: DateBucket[] = ["year", "quarter", "month"]
export const NONE = "(none)"

export function dateBucket(d: Date, b: DateBucket): string {
  const y = d.getUTCFullYear()
  if (b === "year") return String(y)
  if (b === "quarter") return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export type MeasureInput = { op: "count" | "sum" | "avg" | "min" | "max"; field?: string }
export type MeasureSpec = { op: MeasureInput["op"]; label: string; money: boolean; select: Row; pick: (row: Row) => number | null }
export type GroupSpec = {
  label: string
  select: Row
  /** Identity of the row's group. */
  key: (row: Row) => string
  /** What the group is shown as, when that differs from its identity (assets: the name, plus id and link). */
  display?: (row: Row) => { name: string; assetId?: string; href?: string }
}
export type AggregateGroup = { key: string[]; value: number | null; count: number; assetId?: string; href?: string }
export type AggregateResult = {
  measure: string
  groupBy: string[]
  groups: AggregateGroup[]
  total: { value: number | null; count: number }
  truncatedGroups?: number
}

export function measureSpec(entity: EntityKey, m: MeasureInput): MeasureSpec {
  if (m.op === "count") return { op: "count", label: "count", money: false, select: {}, pick: () => null }
  const fields = ENTITIES[entity].fields
  const numeric = Object.entries(fields).filter(([, f]) => ["int", "number", "money"].includes(f.type)).map(([n]) => n)
  const field = m.field
  if (!field || !numeric.includes(field)) {
    throw new ToolInputError(`${m.op} needs a numeric field on ${entity}: ${numeric.join(", ") || "none"}.`)
  }
  return {
    op: m.op,
    label: `${m.op}(${field})`,
    money: fields[field].type === "money",
    select: { [field]: true },
    pick: (row) => (typeof row[field] === "number" ? (row[field] as number) : null),
  }
}

export function groupSpec(entity: EntityKey, raw: string, ctx?: Pick<ToolContext, "health" | "rooms">): GroupSpec {
  const def = ENTITIES[entity]
  const [name, bucket] = String(raw).split(":")

  if (bucket !== undefined) {
    const dateFields = Object.entries(def.fields).filter(([, f]) => f.type === "date").map(([n]) => n)
    if (!dateFields.includes(name)) {
      throw new ToolInputError(`"${raw}": year/quarter/month grouping needs a date field. Date fields on ${entity}: ${dateFields.join(", ") || "none"}.`)
    }
    if (!BUCKETS.includes(bucket as DateBucket)) throw new ToolInputError(`"${raw}": bucket must be year, quarter or month.`)
    return {
      label: raw,
      select: { [name]: true },
      key: (row) => (row[name] instanceof Date ? dateBucket(row[name] as Date, bucket as DateBucket) : NONE),
    }
  }

  const rel = def.relations[name]
  if (rel) {
    if (rel.kind === "asset") {
      // Keyed by type and id: two assets can share a name ("Refrigerator").
      type Ref = { type?: string; id?: string; name?: string; href?: string } | undefined
      return {
        label: "asset",
        select: { assetType: true, assetId: true },
        key: (row) => {
          const a = row.asset as Ref
          return a?.type && a.id ? `${a.type}:${a.id}` : NONE
        },
        display: (row) => {
          const a = row.asset as Ref
          return a?.type && a.id ? { name: a.name ?? NONE, assetId: a.id, href: a.href } : { name: NONE }
        },
      }
    }
    if (rel.kind === "one") {
      requireReachable(rel.entity, ctx)
      const nameField = ENTITIES[rel.entity].nameField
      return {
        label: name,
        select: { [name]: { select: { [nameField]: true } } },
        key: (row) => {
          const v = (row[name] as Row | null | undefined)?.[nameField]
          return v == null ? NONE : String(v)
        },
      }
    }
    throw new ToolInputError(`Can't group ${entity} by ${name} (a list). Aggregate ${rel.entity} instead.`)
  }

  if (!def.fields[name]) {
    throw new ToolInputError(`Unknown field or relation "${name}" on ${entity}. Fields: ${Object.keys(def.fields).join(", ")}. Relations: ${relationNames(entity, ctx)}.`)
  }
  return {
    label: name,
    select: { [name]: true },
    key: (row) => {
      const v = row[name]
      if (v === null || v === undefined || v === "") return NONE
      return v instanceof Date ? toDay(v) : String(v)
    },
  }
}

function reduce(values: number[], op: MeasureInput["op"], money: boolean): number | null {
  if (!values.length) return op === "sum" ? 0 : null
  const total = values.reduce((a, b) => a + b, 0)
  const v =
    op === "sum" ? total
    : op === "avg" ? total / values.length
    : op === "min" ? Math.min(...values)
    : Math.max(...values)
  return money || op === "avg" ? cents(v) : v
}

const compareKeys = (a: string[], b: string[]) => {
  for (let i = 0; i < a.length; i++) {
    const c = a[i].localeCompare(b[i], undefined, { numeric: true })
    if (c !== 0) return c
  }
  return 0
}

export function aggregateRows(rows: Row[], measure: MeasureSpec, groups: GroupSpec[], maxGroups = 200): AggregateResult {
  const buckets = new Map<string, { key: string[]; rows: Row[]; extra: { assetId?: string; href?: string } }>()
  for (const row of rows) {
    const id = JSON.stringify(groups.map((g) => g.key(row)))
    const bucket = buckets.get(id)
    if (bucket) {
      bucket.rows.push(row)
      continue
    }
    const extra: { assetId?: string; href?: string } = {}
    const key = groups.map((g) => {
      if (!g.display) return g.key(row)
      const { name, ...ids } = g.display(row)
      Object.assign(extra, compact(ids))
      return name
    })
    buckets.set(id, { key, rows: [row], extra })
  }

  const valueOf = (rs: Row[]) =>
    measure.op === "count"
      ? rs.length
      : reduce(rs.map(measure.pick).filter((v): v is number => v !== null), measure.op, measure.money)

  const all = [...buckets.values()]
    .map((b): AggregateGroup => ({ key: b.key, value: valueOf(b.rows), count: b.rows.length, ...b.extra }))
    .sort((a, b) => compareKeys(a.key, b.key))

  return {
    measure: measure.label,
    groupBy: groups.map((g) => g.label),
    groups: all.slice(0, maxGroups),
    total: { value: valueOf(rows), count: rows.length },
    ...(all.length > maxGroups ? { truncatedGroups: all.length - maxGroups } : {}),
  }
}
