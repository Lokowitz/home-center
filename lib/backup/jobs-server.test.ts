import { beforeEach, describe, expect, it, vi } from "vitest"

const create = vi.fn()
const settings = { protection: "NONE", folder: null, keep: 14 }
vi.mock("@/lib/prisma", () => ({
  prisma: { backupRun: { create: (a: unknown) => create(a), findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("gone")), update: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) } },
}))
vi.mock("./settings-server", () => ({
  loadBackupSettings: async () => settings, backupFolder: () => "x", loadSecrets: vi.fn(), protectionConfig: vi.fn(), appVersion: async () => "t",
}))
vi.mock("./alerts-server", () => ({ raiseBackupAlert: vi.fn().mockRejectedValue(new Error("alert down")), resolveBackupAlerts: vi.fn() }))
const createExport = vi.fn()
vi.mock("./export", () => ({ createExport: (a: unknown) => createExport(a) }))
vi.mock("./store", () => ({ cleanupPartials: vi.fn(), pruneBackups: vi.fn() }))

import { isJobRunning, startBackupJob, startExportJob } from "./jobs-server"

describe("backup job lock", () => {
  beforeEach(() => {
    create.mockReset()
  })

  it("lets only one of two concurrent starts through, and survives a crashing job", async () => {
    create.mockResolvedValue({ id: "r1" })
    const [a, b] = await Promise.all([startBackupJob("MANUAL"), startBackupJob("MANUAL")])
    expect([a, b].filter((r) => "runId" in r)).toHaveLength(1)
    expect([a, b].filter((r) => "error" in r)).toHaveLength(1)
    await vi.waitFor(() => expect(isJobRunning()).toBe(false))
  })

  it("releases the lock when setup throws", async () => {
    create.mockImplementation(async () => { throw new Error("db down") })
    const r = await startBackupJob("MANUAL").then((x) => ({ ok: x }), (e: Error) => ({ err: e.message }))
    expect(r).toEqual({ err: "db down" })
    expect(isJobRunning()).toBe(false)
  })

  it("shares the one lock between backups and exports", async () => {
    create.mockResolvedValue({ id: "r2" })
    createExport.mockRejectedValue(new Error("boom"))
    const input = { scope: { kind: "all" as const, includeHealth: false }, password: null, userId: "u1" }
    const [a, b] = await Promise.all([startExportJob(input), startBackupJob("MANUAL")])
    expect([a, b].filter((r) => "runId" in r)).toHaveLength(1)
    await vi.waitFor(() => expect(isJobRunning()).toBe(false))
  })

  it("releases the lock when an export fails, and never passes the password to the run record", async () => {
    create.mockResolvedValue({ id: "r3" })
    createExport.mockRejectedValue(new Error("Use at least 6 characters."))
    const r = await startExportJob({ scope: { kind: "all", includeHealth: false }, password: "abc", userId: "u1" })
    expect(r).toEqual({ runId: "r3" })
    expect(JSON.stringify(create.mock.calls)).not.toContain("abc")
    await vi.waitFor(() => expect(isJobRunning()).toBe(false))
  })
})
