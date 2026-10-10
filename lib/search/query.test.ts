import { describe, expect, it } from "vitest"
import { bestPerKey, highlight, idsNamed, mergeSemantic, nearest, searchTerms, semanticOnly, termsWhere } from "./query"
import type { Hit } from "@/lib/documents/index-db"
import type { AssetResult, Section } from "./types"

describe("searchTerms", () => {
  it("lowercases, drops stop words and short words, dedupes", () => {
    expect(searchTerms("The Furnace filter for the furnace a")).toEqual(["furnace", "filter"])
  })

  it("keeps quoted phrases whole", () => {
    expect(searchTerms('"Oil Change"  civic')).toEqual(["oil change", "civic"])
  })

  it("trims punctuation but keeps codes", () => {
    expect(searchTerms("(WM-3900), vin?")).toEqual(["wm-3900", "vin"])
  })

  it("returns nothing for blank input", () => {
    expect(searchTerms("   ")).toEqual([])
  })
})

describe("termsWhere", () => {
  it("requires every term in some own field", () => {
    expect(termsWhere(["oil", "filter"], ["title", "vendor"])).toEqual({
      AND: [
        { OR: [{ title: { contains: "oil" } }, { vendor: { contains: "oil" } }] },
        { OR: [{ title: { contains: "filter" } }, { vendor: { contains: "filter" } }] },
      ],
    })
  })

  it("lets an owner's name satisfy a term, but still needs one own-field hit", () => {
    const owner = {
      ownerIds: (t: string) => (t === "civic" ? ["v1"] : []),
      ownerClause: (ids: string[]) => ({ assetId: { in: ids } }),
    }
    expect(termsWhere(["civic", "oil"], ["title"], owner)).toEqual({
      AND: [
        { OR: [{ title: { contains: "civic" } }, { assetId: { in: ["v1"] } }] },
        { OR: [{ title: { contains: "oil" } }] },
        { OR: [{ title: { contains: "civic" } }, { title: { contains: "oil" } }] },
      ],
    })
  })
})

describe("idsNamed", () => {
  it("matches names case-insensitively", () => {
    expect(idsNamed({ a: "Honda Civic", b: "Lake House" }, "civic")).toEqual(["a"])
  })
})

describe("semanticOnly", () => {
  const hit = (attachmentId: string, score: number, chunkId = 1): Hit => ({ chunkId, attachmentId, page: 1, text: "", score })

  it("drops files keyword search found and distant hits", () => {
    const hits = [hit("kw", 0.1), hit("far", 0.9), hit("new", 0.15)]
    expect(semanticOnly(hits, new Set(["kw"])).map((h) => h.attachmentId)).toEqual(["new"])
  })

  it("keeps only hits near the best one, measured before keyword files are removed", () => {
    const hits = [hit("kw", 0.3), hit("near", 0.36), hit("trailing", 0.39)]
    expect(semanticOnly(hits, new Set(["kw"])).map((h) => h.attachmentId)).toEqual(["near"])
  })

  it("returns nothing when even the best hit is too far", () => {
    expect(semanticOnly([hit("a", 0.42)], new Set())).toEqual([])
  })
})

describe("highlight", () => {
  it("marks every occurrence, longest term first", () => {
    expect(highlight("Filter: buy filters", ["filter"])).toEqual([
      { text: "Filter", match: true },
      { text: ": buy ", match: false },
      { text: "filter", match: true },
      { text: "s", match: false },
    ])
  })

  it("escapes regex characters in terms", () => {
    expect(highlight("part a.b", ["a.b"])).toEqual([
      { text: "part ", match: false },
      { text: "a.b", match: true },
    ])
  })

  it("returns the text unmarked without terms", () => {
    expect(highlight("abc", [])).toEqual([{ text: "abc", match: false }])
  })
})

describe("nearest / bestPerKey", () => {
  it("keeps each record's best chunk, then applies the cutoff and exclusions best-first", () => {
    const hits = [
      { key: "PROPERTY:p1", score: 0.3 },
      { key: "PROPERTY:p1", score: 0.2 },
      { key: "VEHICLE:v1", score: 0.25 },
      { key: "SERVICE:s1", score: 0.27 },
      { key: "PERSON:x", score: 0.35 },
    ]
    const best = bestPerKey(hits)
    expect(best).toEqual([
      { key: "PROPERTY:p1", score: 0.2 },
      { key: "VEHICLE:v1", score: 0.25 },
      { key: "SERVICE:s1", score: 0.27 },
      { key: "PERSON:x", score: 0.35 },
    ])
    expect(nearest(best, new Set(["VEHICLE:v1"]), 0.4, 0.08).map((h) => h.key)).toEqual(["PROPERTY:p1", "SERVICE:s1"])
  })

  it("returns nothing for no hits", () => {
    expect(nearest([], new Set(), 0.4, 0.08)).toEqual([])
  })
})

describe("mergeSemantic", () => {
  const car = (id: string, matchedBy?: "semantic"): AssetResult => ({
    type: "VEHICLE", id, href: `/v/${id}`, name: id, imageFilename: null, badge: null, subtitle: null, facts: [], status: null, matchedBy,
  })
  const section = (key: string, items: AssetResult[], more = false): Section => ({ key, title: key, layout: "assets", items, more })
  const ids = (sections: Section[]) => sections.map((s) => `${s.key}:${s.items.map((i) => (i as AssetResult).id).join(",")}`)

  it("puts a type's meaning matches after its keyword matches", () => {
    const merged = mergeSemantic(
      [section("properties", []), section("vehicles", [car("civic"), car("truck")], true)],
      [section("vehicles", [car("van", "semantic")])]
    )
    expect(ids(merged)).toEqual(["properties:", "vehicles:civic,truck,van"])
    expect(merged[1].more).toBe(true)
  })

  it("keeps the keyword order of sections, and adds types only found by meaning at the end", () => {
    const merged = mergeSemantic(
      [section("properties", [car("house")]), section("vehicles", [])],
      [section("people", [car("ann", "semantic")]), section("vehicles", [car("van", "semantic")])]
    )
    expect(ids(merged)).toEqual(["properties:house", "vehicles:van", "people:ann"])
  })

  it("leaves keyword results alone when nothing is found by meaning", () => {
    const kw = [section("vehicles", [car("civic")])]
    expect(mergeSemantic(kw, [])).toEqual(kw)
  })
})
