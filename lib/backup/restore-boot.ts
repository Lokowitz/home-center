// Engine file: relative imports and npm packages only.
import { cancelStaged, isBlocking, type RestoreResult } from "./restore"

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
        "[restore]      (in Docker the container keeps restarting, so use a fresh one as the app user:",
        "[restore]       docker compose run --rm --no-deps --user nextjs --entrypoint npm homecenter run restore -- --ack)",
        `[restore]   2. Delete ${restoreDir}/result.json (in Docker that is <your data folder>/restore/result.json on the host, the folder mounted at /data)`,
      ],
    }
  }
  if (!applied.applied) return { exitCode: 0, lines: [], stderr: false }
  if (r.status === "ok") {
    return { exitCode: 0, stderr: false, lines: [`[restore] ${r.source === "undo" ? "went back to the earlier state" : `applied backup from ${r.backupCreatedAt}`}`] }
  }
  return { exitCode: 0, stderr: true, lines: [`[restore] failed and rolled back, nothing was changed: ${r.error}`] }
}

/** Exit decision when the apply step itself crashed. A crash with pending.json still there may have left data half moved, so boot must not go on to create an empty database. */
export function crashOutcome(error: unknown, stillPending: boolean, restoreDir: string): { exitCode: 0 | 1; lines: string[] } {
  const lines = [`[restore] apply step crashed: ${error instanceof Error ? error.message : String(error)}`]
  if (!stillPending) return { exitCode: 0, lines }
  return {
    exitCode: 1,
    lines: [
      ...lines,
      "[restore] A restore was in progress, so HomeCenter will not start and will not create an empty database.",
      `[restore] Look in ${restoreDir} (folders named pre-*, staging, failed-*) and keep everything there. Ask for help before deleting anything.`,
    ],
  }
}

/** True when something answers HomeCenter's health URL, so the CLI should not swap data under a running app. */
export async function appIsRunning(port: string, probe: (url: string, init: { signal: AbortSignal }) => Promise<unknown> = fetch): Promise<boolean> {
  try {
    await probe(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

export const APP_RUNNING = "HomeCenter looks like it is running. Stop it first, then run this again (or add --force if that is not HomeCenter)."

/** `npm run restore -- --cancel`. Like a restore, it refuses while HomeCenter answers on port, unless --force. Returns what to print. */
export async function cancelFromCli(
  args: string[], restoreDir: string, port: string,
  probe: (url: string, init: { signal: AbortSignal }) => Promise<unknown> = fetch,
): Promise<string> {
  if (!args.includes("--force") && (await appIsRunning(port, probe))) throw new Error(APP_RUNNING)
  const r = await cancelStaged(restoreDir)
  if (!r.cancelled) return "Nothing to cancel: no restore is staged."
  return r.keptIn ? `Cancelled. The staged data was kept in ${r.keptIn}; nothing deletes it.` : "Cancelled the staged restore. Nothing was changed."
}
