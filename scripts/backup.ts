// npm run backup [-- --folder /path]
// Same engine and settings as Settings → Data; works with the app running or stopped.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createBackup } from "../lib/backup/backup"
import { dbPathFromUrl, defaultBackupFolder, uploadDir, workDir } from "../lib/backup/paths"
import { rawProtection, readRawSecrets, readRawSettings } from "../lib/backup/raw-settings"
import { pruneBackups } from "../lib/backup/store"

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf("--folder")
  const dbPath = dbPathFromUrl(process.env.DATABASE_URL)
  const s = await readRawSettings(dbPath)
  const folder = i >= 0 ? path.resolve(args[i + 1]) : s.folder || defaultBackupFolder()
  const protection = rawProtection(s)
  const version = (JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "unknown"
  const out = await createBackup({
    dbPath, uploadDir: uploadDir(), folder, workDir: workDir(), appVersion: version, protection,
    secrets: protection.mode === "none" ? null : await readRawSecrets(dbPath),
    createFolder: i < 0 && !s.folder,
    onProgress: (d, t) => process.stdout.write(`\rFiles ${d}/${t}`),
  })
  process.stdout.write("\n")
  const pruned = await pruneBackups(folder, s.keep)
  console.log(`Backup written: ${out.path}`)
  for (const w of out.warnings) console.warn(`Warning: ${w}`)
  if (pruned.length) console.log(`Removed ${pruned.length} older backup(s).`)
}

main().catch((e) => {
  console.error(`Backup failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
