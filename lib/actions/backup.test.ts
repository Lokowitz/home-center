import { beforeEach, describe, expect, it, vi } from "vitest"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { fingerprintOf } from "@/lib/backup/protect-shared"

const db = vi.hoisted(() => ({ settingsUpdate: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { backupSettings: { update: db.settingsUpdate } } }))
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: async () => ({ user: { id: "admin1" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("@/lib/backup/settings-server", () => ({
  BACKUP_SETTINGS_ID: "singleton", loadBackupSettings: async () => ({ folder: null }), backupFolder: () => "/nowhere",
  loadSecrets: vi.fn(), protectionConfig: vi.fn(), appVersion: async () => "t",
}))
vi.mock("@/lib/backup/overview-server", () => ({ loadBackupOverview: vi.fn() }))
vi.mock("@/lib/features-server", () => ({ loadFeatures: async () => ({ health: true, rooms: true, equipmentTab: true }) }))
vi.mock("@/lib/backup/alerts-server", () => ({ raiseBackupAlert: vi.fn(), resolveBackupAlerts: vi.fn() }))
const fx = vi.hoisted(() => ({ stage: vi.fn(), hasPending: vi.fn(), restart: vi.fn() }))
vi.mock("@/lib/backup/restore", async (orig) => ({
  ...(await orig<typeof import("@/lib/backup/restore")>()),
  stage: fx.stage, hasPending: fx.hasPending, cancelRestore: async () => undefined,
}))
vi.mock("@/lib/backup/restore-server", () => ({
  restorePaths: () => ({ dbPath: "/x/db", uploadDir: "/x/u", restoreDir: "/x/restore", searchIndexPath: "/x/s" }),
  restartToFinish: fx.restart,
}))

import { restoreConfirm, restoreRestart, setProtectionKey } from "./backup"
import { isJobRunning, startBackupJob } from "@/lib/backup/jobs-server"

describe("restore actions share the one job lock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fx.hasPending.mockResolvedValue(false)
  })

  it("lets only one of two concurrent stage calls through", async () => {
    let finish!: () => void
    fx.stage.mockImplementation(() => new Promise<void>((r) => { finish = r }))
    const a = restoreConfirm({ word: "RESTORE" })
    const b = restoreConfirm({ word: "RESTORE" })
    expect(await b).toEqual({ error: expect.stringContaining("Wait for the running") })
    expect(isJobRunning()).toBe(true) // held while staging, so a backup can't start either
    expect(await startBackupJob("MANUAL")).toEqual({ error: expect.any(String) })
    finish()
    expect(await a).toEqual({ ok: true })
    expect(fx.stage).toHaveBeenCalledTimes(1)
    expect(isJobRunning()).toBe(false)
  })

  it("releases the lock when staging fails", async () => {
    fx.stage.mockRejectedValue(new Error("disk full"))
    expect(await restoreConfirm({ word: "RESTORE" })).toEqual({ error: "disk full" })
    expect(isJobRunning()).toBe(false)
  })

  it("keeps the lock through the exit when restarting, and releases it otherwise", async () => {
    fx.hasPending.mockResolvedValue(false)
    expect(await restoreRestart()).toEqual({ restarting: false, reason: "nothing-staged" })
    expect(isJobRunning()).toBe(false)

    fx.hasPending.mockResolvedValue(true)
    fx.restart.mockReturnValue({ restarting: false })
    expect(await restoreRestart()).toEqual({ restarting: false })
    expect(isJobRunning()).toBe(false)

    fx.restart.mockReturnValue({ restarting: true })
    expect(await restoreRestart()).toEqual({ restarting: true })
    expect(isJobRunning()).toBe(true)
    expect(await restoreConfirm({ word: "RESTORE" })).toEqual({ error: expect.stringContaining("Wait for the running") })
  })
})

describe("setProtectionKey", () => {
  it("rejects a key that looks right but fails age's checksum, and saves nothing", async () => {
    const good = await identityToRecipient(await generateX25519Identity())
    const bad = good.slice(0, -1) + (good.endsWith("q") ? "p" : "q")
    expect(bad).toMatch(/^age1[0-9a-z]{20,}$/)
    expect(await setProtectionKey({ publicKey: bad, fingerprint: await fingerprintOf(bad) })).toEqual({ error: expect.stringContaining("public half") })
    expect(db.settingsUpdate).not.toHaveBeenCalled()
  })

  it("saves a real recovery key", async () => {
    const good = await identityToRecipient(await generateX25519Identity())
    expect(await setProtectionKey({ publicKey: good, fingerprint: await fingerprintOf(good) })).toEqual({ ok: true })
    expect(db.settingsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ protection: "KEY", publicKey: good }) }))
  })
})
