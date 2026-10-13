// Runs before `prisma migrate deploy` (docker-entrypoint.sh, npm prestart/predev).
// Swaps in a staged restore while nothing has the database open. Never throws:
// a failure is rolled back and recorded for the app to report. The one case that
// stops boot (exit 1) is a failed apply that could not be rolled back, on every boot until
// `npm run restore -- --ack`.
import "dotenv/config"
import { applyPending, hasPending, readResult } from "../lib/backup/restore"
import { bootOutcome, crashOutcome } from "../lib/backup/restore-boot"
import { dbPathFromUrl, restoreDir, searchIndexFile, uploadDir } from "../lib/backup/paths"

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) return 0
  const r = await applyPending({
    dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile(),
  })
  const dir = restoreDir()
  const out = bootOutcome(r, r.applied ? null : await readResult(dir), dir)
  for (const l of out.lines) (out.stderr ? console.error : console.log)(l)
  return out.exitCode
}

main().then(
  (code) => process.exit(code),
  async (e) => {
    const dir = (() => { try { return restoreDir() } catch { return "(unknown restore folder)" } })()
    const out = crashOutcome(e, await hasPending(dir).catch(() => true), dir)
    for (const l of out.lines) console.error(l)
    process.exit(out.exitCode)
  },
)
