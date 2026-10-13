// Engine file: relative imports and npm packages only.
import { isBlocking, type RestoreResult } from "./restore"

/**
 * What the boot-time apply step should print and whether startup may continue.
 * A failed apply that could NOT put the old data back stops boot, on this boot and on
 * every later one until it is acknowledged: carrying on would let `prisma migrate deploy`
 * create an empty database and show a blank app.
 * `existing` is result.json as found on disk (used when nothing was pending this boot).
 */
export function bootOutcome(
  applied: { applied: false } | { applied: true; result: RestoreResult },
  existing: RestoreResult | null = null,
  restoreDir = "<restore folder>",
): { exitCode: 0 | 1; lines: string[]; stderr: boolean } {
  const r = applied.applied ? applied.result : existing
  if (!r) return { exitCode: 0, lines: [], stderr: false }
  if (isBlocking(r)) {
    return {
      exitCode: 1,
      stderr: true,
      lines: [
        `[restore] FAILED and could not be undone: ${r.error}`,
        "[restore] HomeCenter will not start, so it does not create an empty database over your data.",
        "[restore] Your data is in these folders (nothing has deleted them):",
        ...r.recoveryDirs.map((d) => `[restore]   ${d}`),
        "[restore] To start again, do ONE of these:",
        "[restore]   1. Move the data back where it belongs, then run: npm run restore -- --ack",
        "[restore]      (in Docker: docker exec <container> npm run restore -- --ack)",
        `[restore]   2. Delete ${restoreDir}/result.json`,
      ],
    }
  }
  if (!applied.applied) return { exitCode: 0, lines: [], stderr: false }
  if (r.status === "ok") {
    return { exitCode: 0, stderr: false, lines: [`[restore] ${r.source === "undo" ? "went back to the earlier state" : `applied backup from ${r.backupCreatedAt}`}`] }
  }
  return { exitCode: 0, stderr: true, lines: [`[restore] failed and rolled back, nothing was changed: ${r.error}`] }
}
