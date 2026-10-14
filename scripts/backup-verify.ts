// npm run backup:verify -- <file> [--key kit.txt | --passphrase-env VAR]
import "dotenv/config"
import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { verifyArchive } from "../lib/backup/verify"
import { workDir } from "../lib/backup/paths"
import { detectProtection, unlockArgs, unprotectFile } from "../lib/backup/protect"

async function main() {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file) throw new Error("Usage: npm run backup:verify -- <file> [--key kit.txt | --passphrase-env VAR]")
  let target = path.resolve(file)
  let temp: string | null = null
  try {
    if ((await detectProtection(target)) !== "none") {
      temp = path.join(workDir(), `verify-cli-${Date.now()}.hcbackup`)
      await mkdir(workDir(), { recursive: true })
      const u = await unprotectFile(target, temp, await unlockArgs(args))
      if (!u.ok) throw new Error(u.error)
      target = temp
    }
    const r = await verifyArchive(target, { workDir: workDir() })
    if (!r.ok) throw new Error(r.error)
    console.log(`OK: ${r.manifest.files.length} entries, made ${r.manifest.createdAt} by HomeCenter ${r.manifest.appVersion}.`)
  } finally {
    if (temp) await rm(temp, { force: true })
  }
}

main().catch((e) => {
  console.error(`Not OK: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
