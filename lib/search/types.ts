import type { AssetType } from "@/app/generated/prisma/client"

// What /search renders. Plain data, built on the server: each record type is
// turned into the handful of facts worth showing for it.

export type Fact = { label: string; value: string }
export type Tone = "default" | "secondary" | "destructive" | "outline"
export type Status = { label: string; tone: Tone }

/**
 * How a result was found: every search word as a whole word ("car", "cars",
 * "car's"), by meaning, or only inside longer words ("carpet" for "car").
 * Results are ranked in that order.
 */
export type MatchKind = "exact" | "semantic" | "partial"

export type AssetThumb = { type: AssetType; id: string; name: string; imageFilename: string | null; href: string }

/** A property, vehicle, piece of equipment or person: a photo card. */
export type AssetResult = {
  type: AssetType
  id: string
  href: string
  name: string
  imageFilename: string | null
  badge: string | null
  subtitle: string | null
  facts: Fact[]
  status: Status | null
  /** Left out counts as exact. */
  matchedBy?: MatchKind
}

export type RecordKind =
  | "service" | "visit" | "maintenance" | "warranty" | "insurance" | "provider"
  | "condition" | "medication" | "allergy" | "immunization" | "observation" | "room"

/** Anything that belongs to an asset or person, or stands alone (providers, insurance). */
export type RecordResult = {
  kind: RecordKind
  id: string
  href: string
  title: string
  subtitle: string | null
  /** Display date, already formatted. */
  date: string | null
  /** e.g. a visit's cost, already formatted. */
  amount: string | null
  status: Status | null
  facts: Fact[]
  owner: AssetThumb | null
  /** Shown instead of an owner, e.g. an insurance policy's members. */
  people: string | null
  /** Left out counts as exact. */
  matchedBy?: MatchKind
}

export type DocumentResult = {
  attachmentId: string
  fileName: string
  fileHref: string | null
  record: { type: string; title: string; href: string | null }
  owner: AssetThumb | null
  pages: number | null
  passages: { page: number | null; text: string }[]
  matchedBy: MatchKind
}

export type Section =
  | { key: string; title: string; layout: "assets"; items: AssetResult[]; more: boolean }
  | { key: string; title: string; layout: "records"; items: RecordResult[]; more: boolean }
  | { key: string; title: string; layout: "documents"; items: DocumentResult[]; more: boolean }

export type SemanticState =
  | { state: "off" }
  | { state: "unavailable" }
  | { state: "failed" }
  /** How many records and files were found by meaning; they're in `sections`, after each type's keyword matches. */
  | { state: "ok"; found: number }

export type SearchResults = {
  query: string
  terms: string[]
  /**
   * Exact matches first in each section, then anything found by meaning, then
   * partial matches; sections with an exact match come first, then those with
   * a meaning match, then the rest.
   */
  sections: Section[]
  semantic: SemanticState
  total: number
}
