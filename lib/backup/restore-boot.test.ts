import { describe, expect, it } from "vitest"
import { bootOutcome } from "./restore-boot"
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
})
