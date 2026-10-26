import type { Hit } from "@/lib/documents/index-db"
import type { MatchKind, Section } from "./types"

// Pure pieces of the global search: turning the box's text into terms,
// building the "every term matches somewhere" filter for each record type,
// and keeping semantic document hits from repeating what keywords found.

export const MAX_RECORD_TERMS = 6

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "my", "of", "on", "or",
  "our", "the", "to", "was", "with",
])

/** Lowercased words and "quoted phrases", stop words dropped, deduped. */
export function searchTerms(input: string): string[] {
  const terms: string[] = []
  const add = (t: string) => {
    if (t && !terms.includes(t)) terms.push(t)
  }
  const rest = input.replace(/"([^"]*)"/g, (_, phrase: string) => {
    add(phrase.trim().replace(/\s+/g, " ").toLowerCase())
    return " "
  })
  for (const raw of rest.toLowerCase().split(/\s+/)) {
    const t = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    if (t.length < 2 || STOP.has(t)) continue
    add(t)
  }
  return terms.slice(0, MAX_RECORD_TERMS)
}

type Clause = Record<string, unknown>

const fieldClauses = (fields: readonly string[], term: string): Clause[] =>
  fields.map((f) => ({ [f]: { contains: term } }))

/**
 * Every term must appear in one of the record's own fields — or, where the
 * record hangs off an asset or person, in that owner's name ("civic oil"
 * finds the Civic's oil changes). At least one term still has to hit the
 * record itself, so a bare asset name doesn't list every record it owns.
 *
 * `ownerIds(term)` gives the owners whose name contains the term;
 * `ownerClause(ids)` is the filter for "belongs to one of these".
 */
export function termsWhere<W>(
  terms: string[],
  fields: readonly string[],
  owner?: { ownerIds: (term: string) => string[]; ownerClause: (ids: string[]) => Clause }
): W {
  const perTerm = terms.map((t) => {
    const ids = owner?.ownerIds(t) ?? []
    const own = fieldClauses(fields, t)
    return { OR: ids.length && owner ? [...own, owner.ownerClause(ids)] : own }
  })
  const anyOwnerMatch = owner && terms.some((t) => owner.ownerIds(t).length > 0)
  const AND = anyOwnerMatch ? [...perTerm, { OR: terms.flatMap((t) => fieldClauses(fields, t)) }] : perTerm
  return { AND } as W
}

/**
 * SQLite's LIKE reads `_` and `%` in a term as wildcards, so "qa_places" also
 * finds "qa-places". For terms holding either, this checks the text really
 * contains them as typed; other terms are left to the database.
 */
export function wildcardTermsMatch(terms: string[], texts: (string | null | undefined)[]): boolean {
  const lower = texts.filter((t): t is string => !!t).map((t) => t.toLowerCase())
  return terms.every((term) => !/[_%]/.test(term) || lower.some((t) => t.includes(term)))
}

/** Ids from `names` whose name contains `term` (already lowercase). */
export function idsNamed(names: Record<string, string>, term: string): string[] {
  return Object.entries(names)
    .filter(([, name]) => name.toLowerCase().includes(term))
    .map(([id]) => id)
}

/**
 * Cosine distances past this aren't shown as semantic matches: nearest-neighbour
 * search always returns something, and with the built-in model unrelated text
 * still lands around 0.45–0.55.
 */
export const MAX_SEMANTIC_DISTANCE = 0.4
/** Only hits this close to the best one count — the rest are usually noise riding along. */
export const SEMANTIC_WINDOW = 0.08

/**
 * Records are short, templated texts, so they sit closer to most queries than
 * file passages do; their bar is stricter.
 */
export const MAX_RECORD_DISTANCE = 0.4
export const RECORD_WINDOW = 0.08

type Scored = { key: string; score: number }

/**
 * Hits worth showing: within `maxDistance`, within `window` of the best hit
 * (measured before excluded keys are removed), and not in `exclude`.
 */
export function nearest<T extends Scored>(hits: T[], exclude: Set<string>, maxDistance: number, window: number): T[] {
  if (!hits.length) return []
  const best = Math.min(...hits.map((h) => h.score))
  const cutoff = Math.min(maxDistance, best + window)
  return hits.filter((h) => h.score <= cutoff && !exclude.has(h.key)).sort((a, b) => a.score - b.score)
}

/** A record's best chunk stands for the record. */
export function bestPerKey<T extends Scored>(hits: T[]): T[] {
  const best = new Map<string, T>()
  for (const h of hits) {
    const seen = best.get(h.key)
    if (!seen || h.score < seen.score) best.set(h.key, h)
  }
  return [...best.values()].sort((a, b) => a.score - b.score)
}

/** Semantic hits worth showing: close, near the best hit, and from a file keyword search didn't already return. */
export function semanticOnly(
  semantic: Hit[],
  keywordAttachmentIds: Set<string>,
  maxDistance = MAX_SEMANTIC_DISTANCE,
  window = SEMANTIC_WINDOW
): Hit[] {
  if (!semantic.length) return []
  const cutoff = Math.min(maxDistance, Math.min(...semantic.map((h) => h.score)) + window)
  return semantic.filter((h) => h.score <= cutoff && !keywordAttachmentIds.has(h.attachmentId))
}

/**
 * Folds meaning-based results into the keyword sections of the same type, after
 * that type's keyword matches, keeping the keyword sections' order. A type only
 * found by meaning is added after the others.
 */
export function mergeSemantic(keyword: Section[], semantic: Section[]): Section[] {
  const extra = new Map(semantic.map((s) => [s.key, s]))
  const merged = keyword.map((s): Section => {
    const add = extra.get(s.key)
    extra.delete(s.key)
    return add ? ({ ...s, items: [...s.items, ...add.items] } as Section) : s
  })
  return [...merged, ...extra.values()]
}

/**
 * `joinsPrev`/`joinsNext`: a match runs straight into letters or digits on that
 * side ("car" in "carpet"), so it mustn't be padded there or the word looks split.
 */
export type Segment = { text: string; match: boolean; joinsPrev?: boolean; joinsNext?: boolean }

const WORD_CHAR = /[\p{L}\p{N}]/u

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The term as a whole word (or phrase), allowing a plural or possessive ending. */
const wholeWord = (term: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${term.split(/\s+/).map(escapeRe).join("\\s+")}(?:s|es|['’]s)?(?![\\p{L}\\p{N}])`, "iu")

/**
 * Keyword search matches text anywhere ("car" finds "carpet"); this says
 * whether every term also appears as a whole word in one of `texts`.
 */
export function matchKind(terms: string[], texts: (string | null | undefined)[]): "exact" | "partial" {
  const present = texts.filter((t): t is string => !!t)
  return terms.every((term) => present.some((t) => wholeWord(term).test(t))) ? "exact" : "partial"
}

const TIER: Record<MatchKind, number> = { exact: 0, semantic: 1, partial: 2 }
const tierOf = (item: Section["items"][number]) => TIER[item.matchedBy ?? "exact"]

/** Items in tier order, keeping their order within a tier. */
export function byTier<T extends Section["items"][number]>(items: T[]): T[] {
  return [...items].sort((a, b) => tierOf(a) - tierOf(b))
}

/**
 * Exact matches first, then meaning, then partial, within each section; and
 * sections by their best item the same way. Ties keep their order.
 */
export function rankSections(sections: Section[]): Section[] {
  const ranked = sections.map((s) => ({ ...s, items: byTier(s.items as Section["items"][number][]) }) as Section)
  const best = (s: Section) => Math.min(...s.items.map(tierOf))
  return ranked.sort((a, b) => best(a) - best(b))
}

/** Splits text so the terms (and words starting with them) can be marked. */
export function highlight(text: string, terms: string[]): Segment[] {
  const usable = terms.filter((t) => t.length >= 2).sort((a, b) => b.length - a.length)
  if (!usable.length) return [{ text, match: false }]
  const re = new RegExp(`(${usable.map(escapeRe).join("|")})`, "gi")
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i), match: false })
    const end = i + m[0].length
    out.push({ text: m[0], match: true, joinsPrev: WORD_CHAR.test(text[i - 1] ?? ""), joinsNext: WORD_CHAR.test(text[end] ?? "") })
    last = end
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false })
  return out
}
