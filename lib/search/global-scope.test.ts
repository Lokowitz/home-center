import { beforeEach, describe, expect, it, vi } from "vitest"

const { docs, loadFeatures, search } = vi.hoisted(() => ({
  docs: { health: vi.fn(), outOfScope: vi.fn(), refs: vi.fn() },
  loadFeatures: vi.fn(),
  search: vi.fn(),
}))
// Every model's queries come back empty, so globalSearch runs end to end on document hits alone.
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: () => ({ findMany: async () => [], groupBy: async () => [] }) }),
}))
vi.mock("@/lib/documents/indexer-server", () => ({ searchIndex: async () => ({ search }), semanticSearchModel: vi.fn() }))
vi.mock("@/lib/documents/embed/server", () => ({ embedderFor: vi.fn() }))
vi.mock("@/lib/documents/scope", () => ({
  healthAttachmentIds: docs.health, outOfScopeAttachmentIds: docs.outOfScope, loadDocumentRefs: docs.refs,
}))
vi.mock("@/lib/features-server", () => ({ loadFeatures }))
vi.mock("@/lib/regional-server", () => ({ getFormat: async () => ({}) }))

import { globalSearch, keywordWheres, policyInclude, withPropertyScope } from "./global-server"
import {
  equipmentScopeWhere, ownedScopeWhere, personChildScopeWhere, personScopeWhere, policyScopeWhere, propertyScopeWhere,
  roomScopeWhere, vehicleScopeWhere, type PropertyScope,
} from "@/lib/property-filter"

const KEYS = [
  "property", "vehicle", "equipment", "person", "service", "maintenance", "warranty", "insurance", "provider",
  "condition", "medication", "allergy", "immunization", "observation", "room",
] as const

/** Each key gets a distinct where that already uses AND and OR. */
const wheres = () =>
  Object.fromEntries(KEYS.map((k) => [k, { AND: [{ name: { contains: k } }], OR: [{ notes: { contains: k } }] }])) as unknown as Parameters<typeof withPropertyScope>[0]

const scope: PropertyScope = {
  propertyId: "rental",
  propertyName: "Rental",
  hiddenEquipmentIds: ["furnace"],
  hiddenVehicleIds: ["truck"],
  hiddenPersonIds: ["ben"],
}

describe("withPropertyScope", () => {
  it("returns the wheres unchanged with no scope", () => {
    const all = wheres()
    expect(withPropertyScope(all, null)).toEqual(wheres())
  })

  it("ANDs each key's scope fragment onto its existing where", () => {
    const all = wheres()
    const out = withPropertyScope(all, scope)
    const expected: Record<string, unknown> = {
      property: propertyScopeWhere(scope),
      vehicle: vehicleScopeWhere(scope),
      equipment: equipmentScopeWhere(scope),
      person: personScopeWhere(scope),
      service: ownedScopeWhere(scope),
      maintenance: ownedScopeWhere(scope),
      warranty: ownedScopeWhere(scope),
      insurance: policyScopeWhere(scope),
      condition: personChildScopeWhere(scope),
      medication: personChildScopeWhere(scope),
      allergy: personChildScopeWhere(scope),
      immunization: personChildScopeWhere(scope),
      observation: personChildScopeWhere(scope),
      room: roomScopeWhere(scope),
    }
    for (const [key, fragment] of Object.entries(expected)) {
      expect(out[key as keyof typeof out], key).toEqual({ AND: [all[key as keyof typeof all], fragment] })
    }
  })

  it("leaves providers alone", () => {
    const all = wheres()
    expect(withPropertyScope(all, scope).provider).toBe(all.provider)
  })
})

describe("policyInclude", () => {
  it("lists only the members, properties and vehicles in scope", () => {
    const include = policyInclude(scope)
    expect(include.members.where).toEqual(personScopeWhere(scope))
    expect(include.properties.where).toEqual(propertyScopeWhere(scope))
    expect(include.vehicles.where).toEqual(vehicleScopeWhere(scope))
  })

  it("lists everyone with no scope", () => {
    const include = policyInclude(null)
    expect([include.members.where, include.properties.where, include.vehicles.where]).toEqual([{}, {}, {}])
  })
})

describe("keywordWheres", () => {
  const owners = {
    thumbs: new Map(),
    names: {
      PROPERTY: { "p-home": "Home", "p-rental": "Rental Home" },
      VEHICLE: { "v-truck": "Home truck" },
      EQUIPMENT: {},
      PERSON: { "x-ben": "Ben Home" },
    },
    allNames: {},
  } as unknown as Parameters<typeof keywordWheres>[1]

  it("matches policies by owner name only among owners in scope", () => {
    const rental = { ...scope, propertyId: "p-rental", hiddenVehicleIds: ["v-truck"], hiddenPersonIds: ["x-ben"] }
    const where = JSON.stringify(keywordWheres(["home"], owners, true, rental).insurance)
    expect(where).toContain("p-rental")
    for (const hidden of ["p-home", "v-truck", "x-ben"]) expect(where).not.toContain(hidden)
  })

  it("matches every owner name with no scope", () => {
    const where = JSON.stringify(keywordWheres(["home"], owners, true, null).insurance)
    for (const id of ["p-home", "p-rental", "v-truck", "x-ben"]) expect(where).toContain(id)
  })
})

describe("globalSearch document deny-list", () => {
  const hit = (attachmentId: string) => ({ chunkId: 1, attachmentId, page: 1, text: "manual", score: 1 })

  beforeEach(() => {
    vi.clearAllMocks()
    search.mockResolvedValue([hit("health-file"), hit("home-file"), hit("rental-file")])
    docs.refs.mockResolvedValue(new Map())
    docs.health.mockResolvedValue(["health-file"])
    docs.outOfScope.mockResolvedValue(["home-file"])
  })

  const shownIds = () => docs.refs.mock.calls[0][0]

  it("builds nothing with Health on and no scope", async () => {
    loadFeatures.mockResolvedValue({ health: true, rooms: true })
    await globalSearch("manual", { semantic: false, scope: null })
    expect(docs.health).not.toHaveBeenCalled()
    expect(docs.outOfScope).not.toHaveBeenCalled()
    expect(shownIds()).toEqual(["health-file", "home-file", "rental-file"])
  })

  it("hides the union of health files and out-of-scope files", async () => {
    loadFeatures.mockResolvedValue({ health: false, rooms: true })
    await globalSearch("manual", { semantic: false, scope })
    expect(docs.outOfScope).toHaveBeenCalledWith(scope)
    expect(shownIds()).toEqual(["rental-file"])
  })

  it("hides out-of-scope files with Health on, without loading health files", async () => {
    loadFeatures.mockResolvedValue({ health: true, rooms: true })
    await globalSearch("manual", { semantic: false, scope })
    expect(docs.health).not.toHaveBeenCalled()
    expect(shownIds()).toEqual(["health-file", "rental-file"])
  })
})
