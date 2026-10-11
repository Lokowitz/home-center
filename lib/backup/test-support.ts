// Test helpers only. Not imported by app code.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function tempDir(prefix = "hc-backup-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"))
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, body)
  }
}
