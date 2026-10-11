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
vi.mock("./store", () => ({ cleanupPartials: vi.fn(), pruneBackups: vi.fn() }))

import { isJobRunning, startBackupJob } from "./jobs-server"

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
})
