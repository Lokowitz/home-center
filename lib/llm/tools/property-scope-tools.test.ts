import { describe, expect, it, vi, beforeEach } from "vitest"
import type { PropertyScope } from "@/lib/property-filter"

// The tools under the property filter (Rental selected): Home's boiler and
// Ben (linked to Home) are out of scope.
const db = vi.hoisted(() => ({
  warranty: vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []),
  medication: vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []),
  attachment: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  attachmentCount: vi.fn<(args: unknown) => Promise<number>>(async () => 0),
  inboxItems: vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []),
  textCount: vi.fn<(args: unknown) => Promise<number>>(async () => 0),
  observation: vi.fn(async () => ({
    id: "o1", updatedAt: new Date("2026-10-20T00:00:00Z"), date: new Date("2026-10-20T00:00:00Z"), time: null, type: "Meltdown",
    severity: 3, durationMinutes: null, notes: null, tags: null, conditionId: null, personId: "ben", person: { name: "Ben" },
    _count: { attachments: 0 },
  })),
  names: {
    PROPERTY: { pR: "Rental", pH: "Home" },
    VEHICLE: {},
    EQUIPMENT: { eH: "Home Boiler", eR: "Rental Furnace" },
    PERSON: { ben: "Ben", ana: "Ana" },
  } as Record<string, Record<string, string>>,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_, model) =>
        model === "warranty" ? { findMany: db.warranty }
        : model === "medication" ? { findMany: db.medication }
        : model === "attachment" ? { findUnique: db.attachment, count: db.attachmentCount }
        : model === "inboxItem" ? { findMany: db.inboxItems }
        : model === "observation" ? { findUnique: db.observation, findMany: async () => [] }
        : model === "attachmentText" ? { count: db.textCount }
        : { findMany: async () => [] },
    }
  ),
}))
vi.mock("@/lib/assets-server", () => ({
  loadAssetIndex: async () => ({ names: db.names, assetName: (t: string, id: string) => db.names[t]?.[id] }),
}))
vi.mock("@/lib/documents/indexer-server", () => ({ searchIndex: vi.fn(), semanticSearchModel: vi.fn() }))
vi.mock("@/lib/documents/embed/server", () => ({ embedderFor: vi.fn() }))
import { warrantyStatusTool } from "./shortcuts"
import { medicationHistoryTool } from "./medications"
import { documentTools } from "./documents"
import { proposeDeleteTool } from "./observation-change"
import { inboxTool } from "./inbox"
import { countNotIndexed } from "@/lib/documents/scope"
import { attachmentOutOfScopeWhere } from "@/lib/property-filter"

const scope: PropertyScope = {
  propertyId: "pR", propertyName: "Rental", hiddenEquipmentIds: ["eH"], hiddenVehicleIds: [], hiddenPersonIds: ["ben"],
}
const now = new Date("2026-10-25T12:00:00Z")
const all = { userId: "u1", now }
const rental = { ...all, scope, hiddenEntityIds: [] }

beforeEach(() => {
  db.warranty.mockClear()
  db.medication.mockClear()
  db.attachment.mockReset()
  db.attachmentCount.mockReset()
  db.attachmentCount.mockResolvedValue(0)
})

const calledFor = (spy: { mock: { calls: unknown[][] } }, assetId: string) =>
  spy.mock.calls.some(([args]) => (args as { where?: { assetId?: unknown } }).where?.assetId === assetId)

describe("name lookups skip out-of-scope assets", () => {
  it("finds the Home boiler under All properties", async () => {
    await warrantyStatusTool.execute({ asset: "Home Boiler" }, all)
    expect(calledFor(db.warranty, "eH")).toBe(true)
  })
  it("doesn't find it with Rental selected", async () => {
    const out = await warrantyStatusTool.execute({ asset: "Home Boiler" }, rental)
    expect(out).toContain('Nothing is named \\"Home Boiler\\"')
    expect(calledFor(db.warranty, "eH")).toBe(false)
  })
  it("scopes the warranty list when no asset is named", async () => {
    await warrantyStatusTool.execute({}, rental)
    expect(JSON.stringify(db.warranty.mock.calls[0][0])).toContain('"assetId":{"notIn":["eH"]}')
    db.warranty.mockClear()
    await warrantyStatusTool.execute({}, all)
    expect(db.warranty.mock.calls[0][0]).toEqual({ where: {}, orderBy: { expirationDate: "asc" } })
  })
})

describe("medication_history for a hidden person", () => {
  it("refuses Ben by name with Rental selected", async () => {
    const out = await medicationHistoryTool.execute({ person: "Ben" }, rental)
    expect(out).toContain('Unknown asset id \\"Ben\\"')
    expect(db.medication).not.toHaveBeenCalled()
  })
  it("leaves Ben out of everyone's list", async () => {
    await medicationHistoryTool.execute({}, rental)
    expect(JSON.stringify(db.medication.mock.calls[0][0])).toContain('"personId":{"notIn":["ben"]}')
  })
  it("reads Ben's under All properties", async () => {
    await medicationHistoryTool.execute({ person: "Ben" }, all)
    expect((db.medication.mock.calls[0][0] as { where: unknown }).where).toEqual({ personId: "ben" })
  })
})

describe("countNotIndexed under the property filter", () => {
  const where = () => (db.textCount.mock.calls.at(-1)![0] as { where: { attachment: Record<string, unknown> } }).where.attachment
  it("keeps the health NOT and adds the scope beside it", async () => {
    await countNotIndexed({ attachmentIds: null, recordTypes: null, includeHealth: false, scope })
    expect(where().NOT).toBeDefined()
    expect(where().AND).toEqual([{ NOT: attachmentOutOfScopeWhere(scope) }])
  })
  it("adds nothing without a scope", async () => {
    await countNotIndexed({ attachmentIds: null, recordTypes: null, includeHealth: true, scope: null })
    expect(where()).toEqual({})
  })
})

describe("observation proposals for a hidden person", () => {
  it("treats Ben's entry as unknown with Rental selected", async () => {
    expect(await proposeDeleteTool.execute({ observationId: "o1" }, rental)).toContain('No observation has id \\"o1\\"')
    expect(await proposeDeleteTool.execute({ observationId: "o1" }, all)).toContain("proposal")
  })
})

describe("read_document and the property filter", () => {
  const read = documentTools(true).find((t) => t.name === "read_document")!
  const row = {
    id: "a1", recordType: "DOCUMENT", filename: "m.pdf", originalName: "Boiler manual.pdf",
    serviceRecordId: null, warrantyId: null, maintenanceScheduleId: null, healthConditionId: null, insurancePolicyId: null,
    observationId: null, medicationId: null, allergyId: null, immunizationId: null, assetId: "eH", assetType: "EQUIPMENT",
    inboxItemId: null, roomId: null, serviceRecord: null, warranty: null, maintenanceSchedule: null, healthCondition: null,
    observation: null, medication: null, allergy: null, immunization: null, insurancePolicy: null, room: null,
    text: { status: "DONE", text: "Bleed the radiators.", truncated: false },
  }

  it("reads a Home manual under All properties", async () => {
    db.attachment.mockResolvedValue(row)
    expect(await read.execute({ attachmentId: "a1" }, all)).toContain("Bleed the radiators.")
  })
  it("refuses it with Rental selected", async () => {
    db.attachment.mockResolvedValue(row)
    db.attachmentCount.mockResolvedValue(1)
    const out = await read.execute({ attachmentId: "a1" }, rental)
    expect(out).toContain("That file isn't available while the property filter is on.")
    expect(out).not.toContain("Bleed")
    expect(db.attachmentCount).toHaveBeenCalledWith({ where: { AND: [{ id: "a1" }, attachmentOutOfScopeWhere(scope)] } })
  })
  it("doesn't check the scope under All properties", async () => {
    db.attachment.mockResolvedValue(row)
    await read.execute({ attachmentId: "a1" }, all)
    expect(db.attachmentCount).not.toHaveBeenCalled()
  })
})

describe("intake suggestions and the property filter", () => {
  const intake = inboxTool(true)
  beforeEach(() => {
    db.inboxItems.mockResolvedValue([{
      createdAt: now, status: "READY", parsedDate: null, parsedTotal: 120, parsedVendor: "Acme", error: null,
      suggestedAssetType: "EQUIPMENT", suggestedAssetId: "eH", suggestedReason: "Serial number on the receipt",
      attachments: [{ originalName: "receipt.pdf" }],
    }])
  })
  it("names the suggested asset under All properties", async () => {
    const out = await intake.execute({}, all)
    expect(out).toContain("Home Boiler")
    expect(out).toContain("Serial number on the receipt")
  })
  it("keeps the item but drops a hidden suggestion with Rental selected", async () => {
    const out = await intake.execute({}, rental)
    expect(out).toContain("receipt.pdf")
    expect(out).not.toContain("Home Boiler")
    expect(out).not.toContain("Serial number")
  })
})
