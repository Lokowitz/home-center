import { describe, expect, it } from "vitest"
import {
  bestPerKey, highlight, idsNamed, matchKind, mergeSemantic, nearest, rankSections, searchTerms, semanticOnly, termsWhere, wildcardTermsMatch,
} from "./query"
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

describe("wildcardTermsMatch", () => {
  it("lets an underscore or percent match only itself", () => {
    expect(wildcardTermsMatch(["qa_places"], ["QA-places"])).toBe(false)
    expect(wildcardTermsMatch(["qa_places"], ["Visit QA_places today"])).toBe(true)
    expect(wildcardTermsMatch(["50%"], ["500 units"])).toBe(false)
    expect(wildcardTermsMatch(["50%"], ["50% off"])).toBe(true)
  })

  it("leaves other terms to the database", () => {
    expect(wildcardTermsMatch(["civic"], ["Honda"])).toBe(true)
    expect(wildcardTermsMatch(["qa_x", "civic"], [null, "qa_x"])).toBe(true)
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
      { text: "Filter", match: true, joinsPrev: false, joinsNext: false },
      { text: ": buy ", match: false },
      { text: "filter", match: true, joinsPrev: false, joinsNext: true },
      { text: "s", match: false },
    ])
  })

  it("says which sides of a match run into the rest of its word", () => {
    const marks = (text: string, terms: string[]) =>
      highlight(text, terms).filter((s) => s.match).map((s) => `${s.joinsPrev ? "<" : "|"}${s.text}${s.joinsNext ? ">" : "|"}`)
    expect(marks("paint & carpet", ["car"])).toEqual(["|car>"])
    expect(marks("Scar", ["car"])).toEqual(["<car|"])
    expect(marks("Scared", ["car"])).toEqual(["<car>"])
    expect(marks("(car)\tcar's", ["car"])).toEqual(["|car|", "|car|"])
    expect(marks("Carrier", ["car"])).toEqual(["|Car>"])
    expect(marks("CAR-143986", ["car"])).toEqual(["|CAR|"])
    expect(marks("", ["car"])).toEqual([])
  })

  it("escapes regex characters in terms", () => {
    expect(highlight("part a.b", ["a.b"])).toEqual([
      { text: "part ", match: false },
      { text: "a.b", match: true, joinsPrev: false, joinsNext: false },
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

describe("matchKind", () => {
  it("calls a whole word exact and a word inside a longer one partial", () => {
    expect(matchKind(["car"], ["Car wash"])).toBe("exact")
    expect(matchKind(["car"], ["New carpet in the den"])).toBe("partial")
    expect(matchKind(["car"], ["Primary care"])).toBe("partial")
    expect(matchKind(["car"], ["Scar"])).toBe("partial")
  })

  it("counts plurals and possessives as exact", () => {
    expect(matchKind(["car"], ["Both cars"])).toBe("exact")
    expect(matchKind(["car"], ["The car's battery"])).toBe("exact")
    expect(matchKind(["car"], ["The car’s battery"])).toBe("exact")
    expect(matchKind(["box"], ["Two boxes"])).toBe("exact")
  })

  it("ignores case and punctuation around the word", () => {
    expect(matchKind(["car"], ["(CAR)"])).toBe("exact")
    expect(matchKind(["car"], ["line one\n\tcar\n\nline three"])).toBe("exact")
    expect(matchKind(["wm-3900"], ["Model WM-3900."])).toBe("exact")
  })

  it("needs every term whole somewhere, in any of the texts", () => {
    expect(matchKind(["civic", "oil"], ["Oil change", null, "Civic"])).toBe("exact")
    expect(matchKind(["civic", "oil"], ["Oil change", "Civics"])).toBe("exact")
    expect(matchKind(["civic", "oil"], ["Oily rag", "Civic"])).toBe("partial")
  })

  it("matches quoted phrases with any spacing", () => {
    expect(matchKind(["oil change"], ["Full oil  change"])).toBe("exact")
    expect(matchKind(["oil change"], ["oil changer"])).toBe("partial")
  })

  it("treats no texts or no terms sensibly", () => {
    expect(matchKind(["car"], [])).toBe("partial")
    expect(matchKind(["car"], ["", null, undefined])).toBe("partial")
    expect(matchKind([], ["anything"])).toBe("exact")
  })
})

describe("rankSections", () => {
  const car = (id: string, matchedBy?: "exact" | "semantic" | "partial"): AssetResult => ({
    type: "VEHICLE", id, href: `/v/${id}`, name: id, imageFilename: null, badge: null, subtitle: null, facts: [], status: null, matchedBy,
  })
  const section = (key: string, items: AssetResult[]): Section => ({ key, title: key, layout: "assets", items, more: false })
  const ids = (sections: Section[]) => sections.map((s) => `${s.key}:${s.items.map((i) => (i as AssetResult).id).join(",")}`)

  it("orders a section exact, then semantic, then partial, keeping order within each", () => {
    const ranked = rankSections([
      section("vehicles", [car("carpet", "partial"), car("van", "semantic"), car("car1", "exact"), car("care", "partial"), car("car2", "exact")]),
    ])
    expect(ids(ranked)).toEqual(["vehicles:car1,car2,van,carpet,care"])
  })

  it("puts sections with an exact match first, then semantic, then partial only, keeping order within each", () => {
    const ranked = rankSections([
      section("properties", [car("carpet", "partial")]),
      section("vehicles", [car("van", "semantic"), car("care", "partial")]),
      section("equipment", [car("care", "partial"), car("car", "exact")]),
      section("people", [car("ann", "semantic")]),
      section("service", [car("car", "exact")]),
    ])
    expect(ids(ranked)).toEqual(["equipment:car,care", "service:car", "vehicles:van,care", "people:ann", "properties:carpet"])
  })

  it("treats an unmarked item as exact", () => {
    expect(ids(rankSections([section("a", [car("p", "partial"), car("x")])]))).toEqual(["a:x,p"])
  })
})
