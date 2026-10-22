// Engine file: relative imports and npm packages only.
import { rm, stat } from "node:fs/promises"
import v8 from "node:v8"
import { runInNewContext } from "node:vm"
import { createClient, type Client } from "@libsql/client"
import { attachmentDir, type AttachmentLocation } from "../attachment-location"
import { fileUrl } from "./paths"

export const openDb = (p: string): Client => createClient({ url: fileUrl(p) })

let forceGc: (() => void) | null | undefined
/** Best effort: null when gc can't be reached, and then we simply skip collecting. */
function getGc(): (() => void) | null {
  if (forceGc === undefined) {
    try {
      v8.setFlagsFromString("--expose-gc")
      const gc = runInNewContext("gc")
      forceGc = typeof gc === "function" ? (gc as () => void) : null
    } catch {
      forceGc = null
    }
  }
  return forceGc
}

/** Finalizers of native handles run a tick after the collection, so collect a few times with ticks between. */
async function collectGarbage(): Promise<void> {
  const gc = getGc()
  if (!gc) return
  try {
    for (let i = 0; i < 3; i++) {
      gc()
      await new Promise((r) => setImmediate(r))
    }
  } catch {
    // never let cleanup mask the real result
  }
}

/** Win32 only, best effort: lets a closed client's native handle go so its .db file can be renamed or deleted. */
export async function releaseDbHandles(): Promise<void> {
  if (process.platform === "win32") await collectGarbage()
}

/**
 * Runs fn on a short-lived connection. On Windows, libsql's native handle keeps the .db file locked after
 * close() until it is garbage collected, which would break a rename or delete of the file right after. So once
 * the connection is closed and unreachable, collect it. Other platforms don't need this, so they skip the pauses.
 */
async function withDb<T>(p: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const run = async () => {
    const c = openDb(p)
    try {
      return await fn(c)
    } finally {
      c.close()
    }
  }
  try {
    return await run()
  } finally {
    await releaseDbHandles()
  }
}

/** A transactionally consistent copy, safe while the app keeps writing. */
export async function vacuumInto(dbPath: string, dest: string): Promise<void> {
  await rm(dest, { force: true })
  await withDb(dbPath, (c) => c.execute({ sql: "VACUUM INTO ?", args: [dest] }).then(() => undefined))
}

export async function integrityCheck(dbPath: string): Promise<string> {
  return withDb(dbPath, async (c) => {
    const r = await c.execute("PRAGMA integrity_check")
    return r.rows.map((row) => String(row[0])).join("; ")
  })
}

const IMAGE_DIRS: [table: string, dir: string][] = [["Property", "properties"], ["Vehicle", "vehicles"], ["Equipment", "equipment"], ["Person", "people"]]
const SEGMENT = /^[^/\\]+$/

/** Upload paths (posix, relative to the upload root) that the DB points at. Read from the snapshot so DB and files agree. */
export async function referencedFiles(dbPath: string): Promise<{ files: string[]; skipped: string[] }> {
  return withDb(dbPath, async (c) => {
    const files = new Set<string>()
    const skipped: string[] = []
    const add = (dir: string, id: string, name: string) => {
      const rel = `${dir}/${id}/${name}`
      if (SEGMENT.test(dir) && SEGMENT.test(id) && SEGMENT.test(name) && name !== ".." && name !== ".") files.add(rel)
      else skipped.push(rel)
    }
    // Backups from before rooms have no roomId column; those rows have no room files.
    const columns = (await c.execute(`PRAGMA table_info("Attachment")`)).rows.map((r) => String(r.name))
    const roomId = columns.includes("roomId") ? "roomId" : "NULL AS roomId"
    const att = await c.execute(`SELECT recordType, filename, serviceRecordId, warrantyId, maintenanceScheduleId, healthConditionId,
      insurancePolicyId, observationId, medicationId, allergyId, immunizationId, assetId, inboxItemId, ${roomId} FROM "Attachment"`)
    for (const row of att.rows) {
      const dir = attachmentDir(row as unknown as AttachmentLocation)
      if (dir) add(dir[0], dir[1], String(row.filename))
    }
    for (const [table, dir] of IMAGE_DIRS) {
      const r = await c.execute(`SELECT id, imageFilename FROM "${table}" WHERE imageFilename IS NOT NULL AND imageFilename <> ''`)
      for (const row of r.rows) add(dir, String(row.id), String(row.imageFilename))
    }
    return { files: [...files].sort(), skipped }
  })
}

export async function latestMigration(dbPath: string): Promise<string | null> {
  return withDb(dbPath, async (c) => {
    const r = await c.execute(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`)
    return r.rows[0] ? String(r.rows[0].migration_name) : null
  })
}

/** Highest User.sessionVersion in a database, or null when there is none to read (no file, older schema, unreadable). */
export async function maxSessionVersion(dbPath: string): Promise<number | null> {
  // Opening a missing path would create an empty database there.
  if (!(await stat(dbPath).then((s) => s.isFile(), () => false))) return null
  try {
    return await withDb(dbPath, async (c) => {
      const v = (await c.execute(`SELECT MAX("sessionVersion") AS v FROM "User"`)).rows[0]?.v
      return v === null || v === undefined ? null : Number(v)
    })
  } catch {
    return null
  }
}

export const COUNTED_MODELS = [
  "User", "Property", "Vehicle", "Equipment", "Person", "Provider", "ServiceRecord", "Warranty", "MaintenanceSchedule",
  "InsurancePolicy", "HealthCondition", "Observation", "Medication", "Allergy", "Immunization", "Attachment", "InboxItem", "Room", "RoomPaint",
] as const

export async function modelCounts(dbPath: string): Promise<Record<string, number>> {
  return withDb(dbPath, async (c) => {
    const out: Record<string, number> = {}
    for (const m of COUNTED_MODELS) {
      try {
        const r = await c.execute(`SELECT COUNT(*) AS n FROM "${m}"`)
        out[m] = Number(r.rows[0].n)
      } catch {
        out[m] = 0 // table absent in an older schema
      }
    }
    return out
  })
}
