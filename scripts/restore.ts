// npm run restore -- --ack   (after dealing with the data of a failed restore, lets HomeCenter start again)
// npm run restore -- <file> [--dry-run] [--key kit.txt | --passphrase-env VAR] [--yes]
// For when the app won't start. Stop HomeCenter first.
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { appMigrations, dbPathFromUrl, restoreDir, searchIndexFile, uploadDir } from "../lib/backup/paths"
import { acknowledgeBlocking, applyPending, cancelRestore, dryRun, stage } from "../lib/backup/restore"
import { unlockArgs } from "../lib/backup/protect"

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === "--ack") {
    const done = await acknowledgeBlocking(restoreDir())
    console.log(done ? `Acknowledged the failed restore. HomeCenter can start now. Data it left in: ${done.recoveryDirs.join(", ") || "(none listed)"}` : "Nothing to acknowledge: no failed restore is blocking startup.")
    return
  }
  const file = args[0]
  if (!file || file.startsWith("--")) throw new Error("Usage: npm run restore -- <file> [--dry-run] [--key kit.txt | --passphrase-env VAR] [--yes]")
  const paths = { dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile() }
  await mkdir(paths.restoreDir, { recursive: true })
  const d = await dryRun({ archivePath: path.resolve(file), secret: await unlockArgs(args), paths, known: await appMigrations() })
  if (!d.ok) throw new Error(d.needs ? `${d.error} Use --key <kit file> or --passphrase-env <VAR>.` : d.error)

  console.log(`Backup from ${d.manifest.createdAt} (HomeCenter ${d.manifest.appVersion})`)
  for (const k of Object.keys(d.backupCounts)) if (d.backupCounts[k] || d.currentCounts[k]) console.log(`  ${k.padEnd(20)} now ${String(d.currentCounts[k]).padStart(6)}  →  backup ${d.backupCounts[k]}`)
  console.log(`Secrets: ${d.secrets}`)
  for (const w of d.warnings) console.warn(`Warning: ${w}`)
  if (args.includes("--dry-run")) {
    await cancelRestore(paths.restoreDir)
    console.log("Dry run only: nothing changed.")
    return
  }
  if (!args.includes("--yes")) {
    console.log("\nThis REPLACES everything in this HomeCenter. Stop HomeCenter before continuing.")
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question("Type RESTORE to continue: ")
    rl.close()
    if (answer.trim() !== "RESTORE") {
      await cancelRestore(paths.restoreDir)
      console.log("Cancelled.")
      return
    }
  }
  await stage({ paths })
  const r = await applyPending(paths)
  if (!r.applied) throw new Error("Nothing was staged.")
  if (r.result.status !== "ok") {
    if (r.result.rolledBack) throw new Error(`${r.result.error} (rolled back, nothing was changed)`)
    throw new Error(`${r.result.error}\nYour data is in: ${r.result.recoveryDirs.join(", ") || "(see the restore folder)"}. Nothing deletes it; copy it somewhere safe.`)
  }
  console.log("Restored. Start HomeCenter: it upgrades the database if needed and signs everyone out.")
}

main().catch((e) => {
  console.error(`Restore failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
