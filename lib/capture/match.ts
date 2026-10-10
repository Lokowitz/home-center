// Suggest which asset a captured document belongs to by finding one of the
// asset's identifiers (VIN, serial, address, make+model, name) in its text. Pure.

export type CaptureAssetType = "PROPERTY" | "VEHICLE" | "EQUIPMENT" | "PERSON"

/** code: VIN / serial / plate / model number. Strongest evidence first. */
export type IdentifierKind = "code" | "address" | "makeModel" | "name"
/** `label` names a code for people ("VIN", "serial number"); untagged codes read as "ID number". */
export type Identifier = { kind: IdentifierKind; value: string; label?: string }

export type CandidateAsset = {
  assetType: CaptureAssetType
  id: string
  name: string
  /** Plain strings are classified by shape; buildIdentifiers returns tagged ones. */
  identifiers: (string | Identifier)[]
}

/** `reason` names the matched value, for logs and tests; `shownReason` is safe and plain enough for the inbox card. */
export type AssetMatch = { assetType: CaptureAssetType; assetId: string; reason: string; shownReason: string }

const WEIGHT: Record<IdentifierKind, number> = { code: 100, address: 50, makeModel: 20, name: 10 }
const LABEL: Record<IdentifierKind, string> = {
  code: "identifier",
  address: "address",
  makeModel: "make and model",
  name: "name",
}

const SHOWN: Record<IdentifierKind, string> = {
  code: "ID number",
  address: "address",
  makeModel: "make and model",
  name: "name",
}

const ABBREV: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", drive: "dr", lane: "ln", boulevard: "blvd",
  court: "ct", place: "pl", terrace: "ter", highway: "hwy", parkway: "pkwy", circle: "cir",
  north: "n", south: "s", east: "e", west: "w",
}

// Words too generic to identify an asset on their own.
const COMMON = new Set([
  "the", "my", "our", "a", "an", "of", "and", "home", "house", "car", "truck", "van", "suv", "boat",
  "main", "new", "old", "family", "primary", "second", "work", "garage", "apartment", "condo", "cabin",
  "vehicle", "auto", "unit", "property", "equipment", "his", "her", "mom", "dad",
])

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => ABBREV[t] ?? t)
}

function classify(value: string): IdentifierKind {
  const toks = tokens(value)
  const compact = toks.join("")
  const hasDigit = /\d/.test(compact)
  if (hasDigit && compact.length >= 5 && (!/\s/.test(value.trim()) || toks.every((t) => /\d/.test(t) || t.length <= 3)))
    return "code"
  if (toks.length >= 2 && /^\d+$/.test(toks[0]) && toks.slice(1).some((t) => /^[a-z]{2,}$/.test(t))) return "address"
  return toks.length >= 2 ? "makeModel" : "name"
}

/** Whether an identifier is distinctive enough to count at all. */
function usable(kind: IdentifierKind, toks: string[]): boolean {
  const compact = toks.join("")
  if (kind === "code") return compact.length >= 5
  if (kind === "address") return toks.length >= 2
  return toks.filter((t) => !COMMON.has(t)).join("").length >= 4
}

function containsSeq(hay: string[], needle: string[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

/** Codes also match when the text splits or joins them differently ("1HGCM8-2633A" vs "1HGCM82633A"). */
function containsCode(hay: string[], compact: string): boolean {
  for (let i = 0; i < hay.length; i++) {
    let joined = ""
    for (let j = i; j < hay.length && joined.length < compact.length; j++) {
      joined += hay[j]
      if (joined === compact) return true
    }
  }
  return false
}

export function matchAsset(text: string, assets: CandidateAsset[]): AssetMatch | null {
  const hay = tokens(text)
  if (!hay.length) return null
  let best: { asset: CandidateAsset; score: number; reason: string; shownReason: string } | null = null
  let tied = false
  for (const asset of assets) {
    let top: { score: number; reason: string; shownReason: string } | null = null
    for (const raw of asset.identifiers) {
      const id: Identifier = typeof raw === "string" ? { kind: classify(raw), value: raw } : raw
      const toks = tokens(id.value)
      if (!toks.length || !usable(id.kind, toks)) continue
      const hit = containsSeq(hay, toks) || (id.kind === "code" && containsCode(hay, toks.join("")))
      if (hit && (!top || WEIGHT[id.kind] > top.score))
        top = {
          score: WEIGHT[id.kind],
          reason: `${LABEL[id.kind]} "${id.value.trim()}" found in the text`,
          shownReason: `${id.label ?? SHOWN[id.kind]} on the receipt`,
        }
    }
    if (!top) continue
    if (!best || top.score > best.score) {
      best = { asset, ...top }
      tied = false
    } else if (top.score === best.score && asset.id !== best.asset.id) {
      tied = true
    }
  }
  if (!best || tied) return null
  return { assetType: best.asset.assetType, assetId: best.asset.id, reason: best.reason, shownReason: best.shownReason }
}

type Opt = string | null | undefined

function collect(...pairs: [IdentifierKind, Opt, string?][]): Identifier[] {
  return pairs.flatMap(([kind, v, label]) => (v && v.trim() ? [{ kind, value: v.trim(), ...(label ? { label } : {}) }] : []))
}

const join = (...parts: Opt[]) => parts.filter((p) => p && p.trim()).map((p) => p!.trim()).join(" ")

/** Identifier lists per asset type, from the Prisma models' own field names. */
export const buildIdentifiers = {
  vehicle: (v: { name: string; make?: Opt; model?: Opt; vin?: Opt }): Identifier[] =>
    collect(["code", v.vin, "VIN"], ["makeModel", v.make && v.model ? join(v.make, v.model) : null], ["name", v.name]),
  property: (p: { name: string; address?: Opt }): Identifier[] =>
    collect(["address", p.address?.split(/[,\n]/)[0]], ["name", p.name]),
  equipment: (e: { name: string; manufacturer?: Opt; modelNumber?: Opt; serialNumber?: Opt }): Identifier[] =>
    collect(
      ["code", e.serialNumber, "serial number"],
      ["code", e.modelNumber, "model number"],
      ["makeModel", e.manufacturer && e.modelNumber ? join(e.manufacturer, e.modelNumber) : null],
      ["name", e.name],
    ),
  person: (p: { name: string }): Identifier[] => collect(["name", p.name]),
}
