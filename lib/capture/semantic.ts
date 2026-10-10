// Suggest an asset for a captured document by meaning, for receipts that carry
// none of an asset's identifiers (a plumber's invoice names no VIN or serial).
// The receipt is embedded and compared with the record index: assets match
// on their own description, and past service records, warranties and
// reminders vote for the asset they belong to. Pure; the lookups live in
// lib/capture-server.ts.

import type { AssetMatch, CaptureAssetType } from "./match"

/**
 * Cosine distance the closest hit must beat. Global search shows records up to
 * 0.40 (MAX_RECORD_DISTANCE in lib/search/query.ts). A pre-filled suggestion
 * must be stricter than a search result, and a receipt-length query sits closer
 * to everything than a short search: with the built-in model (bge-small) on the
 * demo data, a grocery receipt's nearest record was 0.40 and the noise under
 * a real receipt's hits ran 0.34-0.36, while true matches (same vendor and
 * work as a past service record) landed at 0.12-0.25.
 */
export const SUGGEST_MAX_DISTANCE = 0.3
/**
 * How much farther the runner-up asset's best hit must be. Global search treats
 * anything within 0.08 of the best hit (RECORD_WINDOW) as equally relevant;
 * inside that window, a gap this size is the smallest we read as a real lead.
 */
export const SUGGEST_MARGIN = 0.03
/** Hits this close to the best one count as votes for their asset (RECORD_WINDOW in global search). */
export const VOTE_WINDOW = 0.08
/** With no clear distance lead, the winner needs at least this many votes and twice the runner-up's. */
const MIN_VOTES = 2
/** Receipt text embedded for the query: the head of a receipt names the vendor and the work. */
export const SUGGEST_QUERY_CHARS = 1000

export type AssetHit = { assetType: CaptureAssetType; assetId: string; distance: number; via: "asset" | "record" }
export type OwnerRef = { assetType: CaptureAssetType; assetId: string }

const ASSET_KINDS = new Set<string>(["PROPERTY", "VEHICLE", "EQUIPMENT", "PERSON"])
/** Record kinds that belong to one asset (assetType + assetId on the row). */
export const RECORD_KINDS = ["SERVICE", "WARRANTY", "MAINTENANCE"] as const

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

/** Vendor, then the first SUGGEST_QUERY_CHARS of the text, whitespace collapsed. */
export function semanticQueryText(vendor: string | null | undefined, text: string): string {
  const v = flat(vendor)
  const body = flat(text).slice(0, SUGGEST_QUERY_CHARS).trim()
  if (!v) return body
  if (!body) return v
  if (body.toLowerCase().startsWith(v.toLowerCase())) return body
  return `${v}\n${body}`
}

/**
 * Entity-index hits as asset hits: an asset stands for itself, a record for
 * the asset it belongs to (`owners` keyed "KIND:id"). One hit per entity, at
 * its closest chunk, so a long record doesn't vote twice.
 */
export function toAssetHits(hits: { kind: string; entityId: string; score: number }[], owners: Map<string, OwnerRef>): AssetHit[] {
  const best = new Map<string, AssetHit>()
  for (const h of hits) {
    const key = `${h.kind}:${h.entityId}`
    let mapped: AssetHit | null = null
    if (ASSET_KINDS.has(h.kind)) mapped = { assetType: h.kind as CaptureAssetType, assetId: h.entityId, distance: h.score, via: "asset" }
    else {
      const owner = owners.get(key)
      if (owner) mapped = { ...owner, distance: h.score, via: "record" }
    }
    if (!mapped) continue
    const seen = best.get(key)
    if (!seen || mapped.distance < seen.distance) best.set(key, mapped)
  }
  return [...best.values()]
}

type Tally = { assetType: CaptureAssetType; assetId: string; best: number; via: AssetHit["via"]; votes: number }

/**
 * The asset these hits point to, or null when nothing is close enough or two
 * assets are too close to call. People only when `allowPeople` (Health on);
 * otherwise their hits are dropped before ranking, so they neither win nor block.
 */
export function suggestByMeaning(hits: AssetHit[], opts: { allowPeople: boolean }): AssetMatch | null {
  const usable = hits.filter((h) => (opts.allowPeople || h.assetType !== "PERSON") && h.distance <= SUGGEST_MAX_DISTANCE)
  if (!usable.length) return null
  const overall = Math.min(...usable.map((h) => h.distance))
  const tallies = new Map<string, Tally>()
  for (const h of usable) {
    const key = `${h.assetType}:${h.assetId}`
    const t = tallies.get(key) ?? { assetType: h.assetType, assetId: h.assetId, best: Infinity, via: h.via, votes: 0 }
    if (h.distance < t.best) {
      t.best = h.distance
      t.via = h.via
    }
    if (h.distance <= overall + VOTE_WINDOW) t.votes++
    tallies.set(key, t)
  }
  const ranked = [...tallies.values()].sort((a, b) => a.best - b.best || b.votes - a.votes)
  const [top, runner] = ranked
  const clear =
    !runner ||
    runner.best - top.best >= SUGGEST_MARGIN ||
    (top.votes >= MIN_VOTES && top.votes >= 2 * runner.votes)
  if (!clear) return null
  return {
    assetType: top.assetType,
    assetId: top.assetId,
    reason: top.via === "record" ? "similar to past service records" : "similar to the asset's description",
  }
}
