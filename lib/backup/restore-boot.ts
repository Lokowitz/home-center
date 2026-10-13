// Engine file: relative imports and npm packages only.
import type { RestoreResult } from "./restore"

/**
 * What the boot-time apply step should print and whether startup may continue.
 * Only a failed apply that could NOT put the old data back stops boot: carrying on
 * would let `prisma migrate deploy` create an empty database and show a blank app.
 */
export function bootOutcome(applied: { applied: false } | { applied: true; result: RestoreResult }): { exitCode: 0 | 1; lines: string[]; stderr: boolean } {
  if (!applied.applied) return { exitCode: 0, lines: [], stderr: false }
  const r = applied.result
  if (r.status === "ok") {
    return { exitCode: 0, stderr: false, lines: [`[restore] ${r.source === "undo" ? "went back to the earlier state" : `applied backup from ${r.backupCreatedAt}`}`] }
  }
  if (r.rolledBack) return { exitCode: 0, stderr: true, lines: [`[restore] failed and rolled back, nothing was changed: ${r.error}`] }
  return {
    exitCode: 1,
    stderr: true,
    lines: [
      `[restore] FAILED and could not be undone: ${r.error}`,
      "[restore] HomeCenter will not start, so it does not create an empty database over your data.",
      "[restore] Your data is in these folders (nothing has deleted them):",
      ...r.recoveryDirs.map((d) => `[restore]   ${d}`),
      "[restore] Copy them somewhere safe, then put the data back by hand or ask for help.",
    ],
  }
}
