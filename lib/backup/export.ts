// Engine file: relative imports and npm packages only.
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
import { ArchiveWriter } from "./archive"
import { archiveName, FORMAT_VERSION, type ExportScope } from "./format"
import { safeJoin } from "./paths"
import { passwordProblem, protectFile } from "./protect"
import { exportPlacement, loadReadable } from "./readable"
import { vacuumInto } from "./snapshot"
import { uniqueName } from "./store"
import { verifyArchive } from "./verify"
import { writeReadableLayer } from "./viewer"

export type ExportInput = {
  dbPath: string; uploadDir: string; outDir: string; workDir: string; appVersion: string; scope: ExportScope
  password?: string | null; now?: Date; onProgress?: (done: number, total: number) => void
}

const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false)

export async function createExport(i: ExportInput): Promise<{ path: string; file: string; warnings: string[] }> {
  const now = i.now ?? new Date()
  const protectedExport = i.password !== null && i.password !== undefined
  if (protectedExport) {
    const problem = passwordProblem(i.password as string)
    if (problem) throw new Error(problem)
  }
  await mkdir(i.outDir, { recursive: true })
  await mkdir(i.workDir, { recursive: true })
  const tag = randomUUID().slice(0, 8)
  const snap = path.join(i.workDir, `export-${tag}.db`)
  const file = await uniqueName(i.outDir, archiveName("export", now, protectedExport ? "password" : "none"))
  const finalPath = path.join(i.outDir, file)
  const plainPath = protectedExport ? path.join(i.workDir, `${tag}-export.zip`) : finalPath
  let writer: ArchiveWriter | null = null
  try {
    await vacuumInto(i.dbPath, snap)
    const { data, files } = await loadReadable(snap, i.scope, exportPlacement())
    const warnings: string[] = []
    writer = await ArchiveWriter.create(plainPath)
    let done = 0
    for (const f of files) {
      const src = safeJoin(i.uploadDir, f.rel)
      if (src && (await isFile(src))) await writer.addFile(f.archivePath, src)
      else warnings.push(`Missing file: ${f.rel}`)
      i.onProgress?.(++done, files.length)
    }
    await writeReadableLayer(writer, data)
    const counts = {
      assets: data.assets.length, serviceRecords: data.serviceRecords.length, warranties: data.warranties.length,
      reminders: data.reminders.length, documents: data.documents.length, files: files.length,
    }
    await writer.finish({
      formatVersion: FORMAT_VERSION, kind: "export", scope: i.scope, appVersion: i.appVersion, migration: null,
      createdAt: now.toISOString(), protection: protectedExport ? "password" : "none", counts, warnings, hasReadable: true, hasSecrets: false,
    })
    writer = null
    const v = await verifyArchive(plainPath, { workDir: i.workDir })
    if (!v.ok) throw new Error(`The export failed verification: ${v.error}`)
    if (protectedExport) await protectFile(plainPath, finalPath, { mode: "password", password: i.password as string }, file)
    return { path: finalPath, file, warnings }
  } catch (e) {
    await writer?.abort()
    await rm(finalPath + ".partial", { force: true })
    // uniqueName guaranteed finalPath did not exist before this run, so anything there is ours.
    await rm(finalPath, { force: true })
    throw e
  } finally {
    await rm(snap, { force: true })
    if (protectedExport) await rm(plainPath, { force: true })
  }
}
