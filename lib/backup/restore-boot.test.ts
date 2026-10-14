import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { appIsRunning, bootOutcome, cancelFromCli, crashOutcome } from "./restore-boot"
import { tempDir, writeFiles } from "./test-support"
import type { RestoreResult } from "./restore"

const base: RestoreResult = { status: "ok", error: null, backupCreatedAt: "2026-01-02T03:04:05.000Z", appliedAt: "2026-02-01T00:00:00.000Z", source: "backup", finalized: false, rolledBack: true, recoveryDirs: [] }

describe("boot decision after the apply step", () => {
  it("continues when nothing was pending", () => {
    expect(bootOutcome({ applied: false })).toEqual({ exitCode: 0, lines: [], stderr: false })
  })

  it("continues after a successful restore or undo", () => {
    expect(bootOutcome({ applied: true, result: base })).toMatchObject({ exitCode: 0, stderr: false })
    expect(bootOutcome({ applied: true, result: { ...base, source: "undo" } }).lines[0]).toContain("earlier state")
  })

  it("continues after a failure that was cleanly rolled back (the app reports it from result.json)", () => {
    const out = bootOutcome({ applied: true, result: { ...base, status: "failed", error: "disk went away" } })
    expect(out.exitCode).toBe(0)
    expect(out.lines.join("\n")).toContain("disk went away")
  })

  it("continues after a malformed pending file (nothing was displaced)", () => {
    const out = bootOutcome({ applied: true, result: { ...base, status: "failed", error: "The pending restore file is unreadable, so nothing was changed." } })
    expect(out.exitCode).toBe(0)
  })

  it("stops boot and names every recovery folder when a failed restore could not be rolled back", () => {
    const dirs = ["/data/restore/failed-x-previous", "/data/restore/failed-x-staged"]
    const out = bootOutcome({ applied: true, result: { ...base, status: "failed", error: "rolling back also failed", rolledBack: false, recoveryDirs: dirs } })
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe(true)
    const text = out.lines.join("\n")
    for (const d of dirs) expect(text).toContain(d)
    expect(text).toContain("will not start")
  })

  const blocking = { ...base, status: "failed" as const, error: "rolling back also failed", rolledBack: false, recoveryDirs: ["/data/restore/failed-x-previous"] }

  it("keeps stopping every boot while an unacknowledged blocking result sits there with nothing pending", () => {
    const out = bootOutcome({ applied: false }, blocking, "/data/restore")
    expect(out.exitCode).toBe(1)
    const text = out.lines.join("\n")
    expect(text).toContain("/data/restore/failed-x-previous")
    expect(text).toContain("npm run restore -- --ack")
    expect(text).toContain("/data/restore/result.json")
  })

  it("continues once the blocking result is acknowledged", () => {
    expect(bootOutcome({ applied: false }, { ...blocking, acknowledgedAt: "2026-02-02T00:00:00.000Z" }).exitCode).toBe(0)
  })

  it("continues when the stored failure was cleanly rolled back", () => {
    expect(bootOutcome({ applied: false }, { ...blocking, rolledBack: true, recoveryDirs: [] }).exitCode).toBe(0)
  })
})

describe("boot message and crash handling", () => {
  it("the blocked message names both ways out, with a Docker command that runs as the app user", () => {
    const text = bootOutcome({ applied: false }, { ...base, status: "failed", error: "x", rolledBack: false, recoveryDirs: ["/d"] }, "/data/restore").lines.join("\n")
    expect(text).toContain("npm run restore -- --ack")
    expect(text).toContain("docker compose run --rm --no-deps --user nextjs --entrypoint npm homecenter run restore -- --ack")
    expect(text).toContain("Delete /data/restore/result.json")
    expect(text).toContain("<your data folder>/restore/result.json")
  })

  it("a crash with pending.json still there stops boot and names the restore folder", () => {
    const out = crashOutcome(new Error("EPERM"), true, "/data/restore")
    expect(out.exitCode).toBe(1)
    expect(out.lines.join("\n")).toContain("/data/restore")
  })

  it("a crash with nothing pending lets boot continue", () => {
    expect(crashOutcome(new Error("x"), false, "/d").exitCode).toBe(0)
  })

  it("detects a running app through an injected probe", async () => {
    const seen: string[] = []
    expect(await appIsRunning("4999", async (u) => void seen.push(u))).toBe(true)
    expect(seen).toEqual(["http://127.0.0.1:4999/api/health"])
    expect(await appIsRunning("4999", async () => { throw new Error("ECONNREFUSED") })).toBe(false)
  })
})

describe("restore --cancel", () => {
  const up = async () => undefined
  const down = async () => { throw new Error("ECONNREFUSED") }
  async function staged() {
    const dir = await tempDir("hc-cancel-")
    await writeFiles(dir, { "pending.json": JSON.stringify({ source: "backup", backupCreatedAt: null }), "staging/homecenter.db": "x" })
    return dir
  }

  it("refuses while HomeCenter answers, and changes nothing", async () => {
    const dir = await staged()
    await expect(cancelFromCli(["--cancel"], dir, "4999", up)).rejects.toThrow(/looks like it is running/)
    expect(existsSync(path.join(dir, "pending.json"))).toBe(true)
    expect(existsSync(path.join(dir, "staging", "homecenter.db"))).toBe(true)
  })

  it("cancels when the app is stopped, or with --force", async () => {
    const dir = await staged()
    expect(await cancelFromCli(["--cancel"], dir, "4999", down)).toMatch(/Cancelled the staged restore/)
    expect(existsSync(path.join(dir, "pending.json"))).toBe(false)
    const dir2 = await staged()
    expect(await cancelFromCli(["--cancel", "--force"], dir2, "4999", up)).toMatch(/Cancelled/)
    expect(await cancelFromCli(["--cancel"], dir2, "4999", down)).toMatch(/Nothing to cancel/)
  })
})
