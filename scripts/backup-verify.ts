// npm run backup:verify -- <file>   (protected files are checked during restore: add --key/--passphrase-env in Task 12)
import path from "node:path"
import { verifyArchive } from "../lib/backup/verify"
import { workDir } from "../lib/backup/paths"

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("Usage: npm run backup:verify -- <file>")
  const r = await verifyArchive(path.resolve(file), { workDir: workDir() })
  if (!r.ok) throw new Error(r.error)
  console.log(`OK: ${r.manifest.files.length} entries, made ${r.manifest.createdAt} by HomeCenter ${r.manifest.appVersion}.`)
}

main().catch((e) => {
  console.error(`Not OK: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
