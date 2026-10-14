// Engine file: relative imports and npm packages only.
// The backup folder is the source of truth for which backups exist: a sidecar
// next to each archive says what it is. Nothing without a valid sidecar is ever
// listed or deleted, so a shared folder's other files are safe.
import path from "node:path"
import { constants } from "node:fs"
import { access, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises"
import { SIDECAR_SUFFIX, SIDECAR_VERSION, type Sidecar } from "./format"

export const sidecarPath = (archivePath: string) => archivePath + SIDECAR_SUFFIX

export async function writeSidecar(archivePath: string, s: Sidecar): Promise<void> {
  await writeFile(sidecarPath(archivePath), JSON.stringify(s, null, 2))
}

export async function readSidecar(p: string): Promise<Sidecar | null> {
  try {
    const s = JSON.parse(await readFile(p, "utf8")) as Sidecar
    if (s.sidecarVersion !== SIDECAR_VERSION || typeof s.file !== "string" || path.basename(s.file) !== s.file) return null
    // Listing sorts and filters on these, so a hand-edited or damaged sidecar is skipped rather than thrown on.
    if (typeof s.createdAt !== "string" || (s.kind !== "backup" && s.kind !== "export")) return null
    return s
  } catch {
    return null
  }
}

export type StoredBackup = Sidecar & { path: string }

export async function listBackups(folder: string): Promise<StoredBackup[]> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return []
  }
  const out: StoredBackup[] = []
  for (const n of names.filter((n) => n.endsWith(SIDECAR_SUFFIX))) {
    const s = await readSidecar(path.join(folder, n))
    if (!s || n !== s.file + SIDECAR_SUFFIX) continue
    const p = path.join(folder, s.file)
    try {
      if ((await stat(p)).isFile()) out.push({ ...s, path: p })
    } catch {
      // archive gone; ignore the stray sidecar
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Keeps the newest `keep` backups (exports are not counted or pruned). Returns deleted file names. */
export async function pruneBackups(folder: string, keep: number): Promise<string[]> {
  const old = (await listBackups(folder)).filter((b) => b.kind === "backup").slice(Math.max(0, keep))
  for (const b of old) {
    await rm(b.path, { force: true })
    await rm(sidecarPath(b.path), { force: true })
  }
  return old.map((b) => b.file)
}

export async function deleteBackup(folder: string, file: string): Promise<boolean> {
  const b = (await listBackups(folder)).find((x) => x.file === file)
  if (!b) return false
  await rm(b.path, { force: true })
  await rm(sidecarPath(b.path), { force: true })
  return true
}

const exists = (p: string) => stat(p).then(() => true, () => false)

/** name, or name with -2, -3… before the extension when taken. */
export async function uniqueName(folder: string, name: string): Promise<string> {
  if (!(await exists(path.join(folder, name)))) return name
  const m = /^(homecenter-(?:export-)?\d{4}-\d{2}-\d{2}-\d{4})(.*)$/.exec(name)
  const [base, ext] = m ? [m[1], m[2]] : [name, ""]
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`
    if (!(await exists(path.join(folder, candidate)))) return candidate
  }
}

/** Removes HomeCenter's own unfinished archives. Only names it writes (homecenter-…); the folder may be shared. */
export async function cleanupPartials(folder: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return 0
  }
  const partials = names.filter((n) => n.startsWith("homecenter-") && n.endsWith(".partial"))
  for (const n of partials) await rm(path.join(folder, n), { force: true })
  return partials.length
}

export type FolderStatus = { exists: boolean; writable: boolean; freeBytes: number | null; sameDevice: boolean }

export async function folderStatus(folder: string, dataDirPath: string): Promise<FolderStatus> {
  let st
  try {
    st = await stat(folder)
  } catch {
    return { exists: false, writable: false, freeBytes: null, sameDevice: false }
  }
  if (!st.isDirectory()) return { exists: false, writable: false, freeBytes: null, sameDevice: false }
  const writable = await access(folder, constants.W_OK).then(() => true, () => false)
  let freeBytes: number | null = null
  try {
    const fs = await statfs(folder)
    freeBytes = Number(fs.bavail) * Number(fs.bsize)
  } catch {
    freeBytes = null
  }
  const sameDevice = await stat(dataDirPath).then((d) => d.dev === st.dev, () => false)
  return { exists: true, writable, freeBytes, sameDevice }
}
