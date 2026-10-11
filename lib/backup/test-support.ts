// Test helpers only. Not imported by app code.
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createClient } from "@libsql/client"
import { appMigrations, fileUrl } from "./paths"

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

/** A fresh DB with every migration applied (or up to and including upTo), recorded in _prisma_migrations like `prisma migrate deploy` does. */
export async function createMigratedDb(dbPath: string, opts: { upTo?: string } = {}): Promise<void> {
  const dir = path.resolve(__dirname, "../../prisma/migrations")
  const names = (await appMigrations(dir)).filter((n) => !opts.upTo || n <= opts.upTo)
  const c = createClient({ url: fileUrl(dbPath) })
  try {
    await c.execute(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`)
    for (const n of names) {
      await c.executeMultiple(await readFile(path.join(dir, n, "migration.sql"), "utf8"))
      await c.execute({ sql: `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, 'x', current_timestamp, ?, 1)`, args: [n, n] })
    }
  } finally {
    c.close()
  }
}

/** Upload paths seedSample writes, relative to the upload root. */
export const SAMPLE_FILES = ["service/s1/f-a1.pdf", "service/s2/f-a2.pdf", "properties/p1/img-p1.jpg"]

/** Two assets, one person with a health record, records and files. Synthetic only. */
export async function seedSample(dbPath: string, uploadRoot: string): Promise<void> {
  const t = "2026-01-01T00:00:00.000Z"
  const c = createClient({ url: fileUrl(dbPath) })
  try {
    await c.executeMultiple(`
      INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('u1', 'Admin', 'admin@example.test', 'hash', 'ADMIN');
      INSERT INTO "Property" (id, name, address, imageFilename, updatedAt) VALUES ('p1', 'Main House', '1 Elm St', 'img-p1.jpg', '${t}');
      INSERT INTO "Vehicle" (id, name, make, model, year, updatedAt) VALUES ('v1', 'Daily Driver', 'Honda', 'Fit', 2015, '${t}');
      INSERT INTO "Person" (id, name, updatedAt) VALUES ('h1', 'Pat', '${t}');
      INSERT INTO "Medication" (id, name, personId, updatedAt) VALUES ('m1', 'Ibuprofen', 'h1', '${t}');
      INSERT INTO "ServiceRecord" (id, assetId, assetType, date, title, cost, createdById, updatedAt) VALUES
        ('s1', 'v1', 'VEHICLE', '2026-02-01T00:00:00.000Z', 'Oil change', 49.5, 'u1', '${t}'),
        ('s2', 'h1', 'PERSON', '2026-03-01T00:00:00.000Z', 'Checkup', 0, 'u1', '${t}');
      INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, serviceRecordId) VALUES
        ('a1', 'SERVICE', 'f-a1.pdf', 'receipt.pdf', 'application/pdf', 5, 'u1', 's1'),
        ('a2', 'SERVICE', 'f-a2.pdf', 'visit.pdf', 'application/pdf', 5, 'u1', 's2');
    `)
  } finally {
    c.close()
  }
  await writeFiles(uploadRoot, Object.fromEntries(SAMPLE_FILES.map((f) => [f, `data:${f}`])))
}
