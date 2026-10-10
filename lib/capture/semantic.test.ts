import { describe, expect, it } from "vitest"
import {
  SUGGEST_MARGIN, SUGGEST_MAX_DISTANCE, SUGGEST_QUERY_CHARS, semanticQueryText, suggestByMeaning, toAssetHits, type AssetHit,
} from "./semantic"

const hit = (assetType: AssetHit["assetType"], assetId: string, distance: number, via: AssetHit["via"] = "record"): AssetHit =>
  ({ assetType, assetId, distance, via })
const close = SUGGEST_MAX_DISTANCE - 0.1

describe("semanticQueryText", () => {
  it("puts the vendor before the text", () => {
    expect(semanticQueryText("Joe's Plumbing", "Replaced water heater valve")).toBe("Joe's Plumbing\nReplaced water heater valve")
  })

  it("collapses whitespace (tabs, blank lines) and trims", () => {
    expect(semanticQueryText(null, "  Drain\tcleaning\n\n\nkitchen   sink  ")).toBe("Drain cleaning kitchen sink")
  })

  it("keeps only the first chars of the text", () => {
    const long = "a".repeat(SUGGEST_QUERY_CHARS + 500)
    expect(semanticQueryText(null, long)).toHaveLength(SUGGEST_QUERY_CHARS)
    expect(semanticQueryText("Acme", long)).toBe(`Acme\n${"a".repeat(SUGGEST_QUERY_CHARS)}`)
  })

  it("handles text with no spaces, and empty or blank parts", () => {
    expect(semanticQueryText("", "INVOICE#4471")).toBe("INVOICE#4471")
    expect(semanticQueryText("  ", "   ")).toBe("")
    expect(semanticQueryText(undefined, "")).toBe("")
    expect(semanticQueryText("Acme", "")).toBe("Acme")
  })

  it("doesn't repeat a vendor the text already starts with", () => {
    expect(semanticQueryText("Joe's Plumbing", "Joe's Plumbing\nInvoice 12")).toBe("Joe's Plumbing Invoice 12")
  })
})

describe("toAssetHits", () => {
  const owners = new Map([
    ["SERVICE:s1", { assetType: "PROPERTY" as const, assetId: "p1" }],
    ["SERVICE:s2", { assetType: "PROPERTY" as const, assetId: "p1" }],
    ["WARRANTY:w1", { assetType: "EQUIPMENT" as const, assetId: "e1" }],
  ])

  it("maps assets to themselves and records to their asset, one hit per entity at its best chunk", () => {
    const out = toAssetHits(
      [
        { kind: "SERVICE", entityId: "s1", score: 0.3 },
        { kind: "SERVICE", entityId: "s1", score: 0.2 },
        { kind: "SERVICE", entityId: "s2", score: 0.25 },
        { kind: "VEHICLE", entityId: "v1", score: 0.33 },
        { kind: "WARRANTY", entityId: "w1", score: 0.31 },
      ],
      owners
    )
    expect(out).toEqual([
      hit("PROPERTY", "p1", 0.2),
      hit("PROPERTY", "p1", 0.25),
      hit("VEHICLE", "v1", 0.33, "asset"),
      hit("EQUIPMENT", "e1", 0.31),
    ])
  })

  it("drops records with no known owner and kinds that aren't assets or asset records", () => {
    expect(
      toAssetHits(
        [
          { kind: "SERVICE", entityId: "gone", score: 0.1 },
          { kind: "MEDICATION", entityId: "m1", score: 0.1 },
          { kind: "PROVIDER", entityId: "pr1", score: 0.1 },
        ],
        owners
      )
    ).toEqual([])
  })
})

describe("suggestByMeaning", () => {
  it("returns null with no hits", () => {
    expect(suggestByMeaning([], { allowPeople: true })).toBeNull()
  })

  it("suggests the one close asset, saying it came from past records", () => {
    const s = suggestByMeaning([hit("PROPERTY", "p1", close), hit("VEHICLE", "v1", SUGGEST_MAX_DISTANCE + 0.05)], { allowPeople: false })
    expect(s).toMatchObject({ assetType: "PROPERTY", assetId: "p1" })
    expect(s!.reason).toMatch(/past .*records/)
  })

  it("says when the asset's own description was the closest", () => {
    const s = suggestByMeaning([hit("VEHICLE", "v1", close, "asset")], { allowPeople: false })
    expect(s).toMatchObject({ assetType: "VEHICLE", assetId: "v1" })
    expect(s!.reason).not.toMatch(/records/)
  })

  it("returns null when even the best hit is past the distance bar", () => {
    expect(suggestByMeaning([hit("PROPERTY", "p1", SUGGEST_MAX_DISTANCE + 0.001)], { allowPeople: true })).toBeNull()
  })

  it("returns null when two assets are about equally close", () => {
    expect(
      suggestByMeaning([hit("PROPERTY", "p1", close), hit("EQUIPMENT", "e1", close + SUGGEST_MARGIN / 2)], { allowPeople: false })
    ).toBeNull()
  })

  it("suggests the winner when the runner-up is clearly farther", () => {
    expect(
      suggestByMeaning([hit("EQUIPMENT", "e1", close + SUGGEST_MARGIN + 0.001), hit("PROPERTY", "p1", close)], { allowPeople: false })
    ).toMatchObject({ assetType: "PROPERTY", assetId: "p1" })
  })

  it("lets several close records outvote a near-tie", () => {
    const hits = [
      hit("PROPERTY", "p1", close),
      hit("PROPERTY", "p1", close + 0.01),
      hit("PROPERTY", "p1", close + 0.02),
      hit("EQUIPMENT", "e1", close + 0.005),
    ]
    expect(suggestByMeaning(hits, { allowPeople: false })).toMatchObject({ assetType: "PROPERTY", assetId: "p1" })
  })

  it("doesn't let votes win for an asset whose best hit is farther", () => {
    const hits = [
      hit("EQUIPMENT", "e1", close),
      hit("PROPERTY", "p1", close + 0.005),
      hit("PROPERTY", "p1", close + 0.01),
      hit("PROPERTY", "p1", close + 0.02),
    ]
    expect(suggestByMeaning(hits, { allowPeople: false })).toBeNull()
  })

  it("leaves people out unless allowed", () => {
    expect(suggestByMeaning([hit("PERSON", "u1", close)], { allowPeople: false })).toBeNull()
    expect(suggestByMeaning([hit("PERSON", "u1", close)], { allowPeople: true })).toMatchObject({ assetType: "PERSON", assetId: "u1" })
  })

  it("ignores a close person when people aren't allowed, so they can't block a suggestion either", () => {
    expect(
      suggestByMeaning([hit("PERSON", "u1", close), hit("PROPERTY", "p1", close + 0.005)], { allowPeople: false })
    ).toMatchObject({ assetType: "PROPERTY", assetId: "p1" })
  })
})
