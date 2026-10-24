import { describe, expect, it, vi } from "vitest"
import path from "node:path"
import { readdir, readFile, rename, rm } from "node:fs/promises"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"
import { integrityCheck, latestMigration, modelCounts, referencedFiles, vacuumInto } from "./snapshot"
import { appMigrations } from "./paths"

// Each case builds a migrated SQLite DB and zips it; under a parallel full run that exceeds the 5s default.
vi.setConfig({ testTimeout: 30_000 })

describe("snapshot", () => {
  it("copies a consistent snapshot and reads what it references", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const snap = path.join(dir, "snap.db")
    await vacuumInto(db, snap)
    expect(await integrityCheck(snap)).toBe("ok")
    expect((await referencedFiles(snap)).files).toEqual([...SAMPLE_FILES].sort())
    expect(await latestMigration(snap)).toBe((await appMigrations()).at(-1))
    const counts = await modelCounts(snap)
    expect(counts).toMatchObject({ User: 1, Property: 1, Vehicle: 1, Person: 1, ServiceRecord: 2, Attachment: 2, Medication: 1 })
  })

  it("lists room files, and still reads a backup made before rooms existed", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    await c.executeMultiple(`
      INSERT INTO "Room" (id, propertyId, name, updatedAt) VALUES ('r1', 'p1', 'Kitchen', '2026-01-01T00:00:00.000Z');
      INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, roomId) VALUES ('a9', 'ROOM', 'f-a9.jpg', 'k.jpg', 'image/jpeg', 1, 'u1', 'r1');
    `)
    expect((await referencedFiles(db)).files).toContain("room/r1/f-a9.jpg")
    expect(await modelCounts(db)).toMatchObject({ Room: 1, RoomPaint: 0 })
    c.close()
    // A database from before rooms: no Room tables, no Attachment.roomId.
    const old = path.join(dir, "old.db")
    await createMigratedDb(old, { upTo: "20261022023010_add_mail_public_url" })
    expect((await referencedFiles(old)).files).toEqual([])
    expect(await modelCounts(old)).toMatchObject({ Room: 0, RoomPaint: 0 })
  })

  it("skips a stored filename that would escape the upload root", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    await c.execute(`UPDATE "Attachment" SET filename = '../../evil' WHERE id = 'a1'`)
    c.close()
    const r = await referencedFiles(db)
    expect(r.files).not.toContain("service/s1/../../evil")
    expect(r.skipped).toEqual(["service/s1/../../evil"])
  })

  it("releases the file so it can be renamed and deleted right after reading", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await modelCounts(db)
    await integrityCheck(db)
    await rename(db, path.join(dir, "moved.db"))
    await vacuumInto(path.join(dir, "moved.db"), db)
    await modelCounts(db)
    await rm(db)
  })

  it("keeps reminders through the manual reference migration and clears the link when the file goes", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "old.db")
    await createMigratedDb(db, { upTo: "20261024154941_equipment_value_and_lifespan" })
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    const t = "2026-01-01T00:00:00.000Z"
    await c.executeMultiple(`
      INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('u1', 'Admin', 'admin@example.test', 'hash', 'ADMIN');
      INSERT INTO "Property" (id, name, address, updatedAt) VALUES ('p1', 'Main House', '1 Elm St', '${t}');
      INSERT INTO "MaintenanceSchedule" (id, assetId, assetType, title, estimatedCost, dueMonths, dueDay, updatedAt) VALUES ('m1', 'p1', 'PROPERTY', 'Winterize', 85, '10', 15, '${t}');
      INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, assetType, assetId) VALUES ('d1', 'DOCUMENT', 'f-d1.pdf', 'manual.pdf', 'application/pdf', 5, 'u1', 'PROPERTY', 'p1');
    `)
    const migrations = path.resolve(__dirname, "../../prisma/migrations")
    const folder = (await readdir(migrations)).find((n) => n.endsWith("_maintenance_manual_reference"))
    expect(folder).toBeDefined()
    await c.executeMultiple(await readFile(path.join(migrations, folder!, "migration.sql"), "utf8"))

    const row = async () =>
      (await c.execute(`SELECT estimatedCost, dueMonths, dueDay, referenceAttachmentId, referencePage FROM "MaintenanceSchedule" WHERE id = 'm1'`)).rows[0]
    expect(await row()).toMatchObject({ estimatedCost: 85, dueMonths: "10", dueDay: 15, referenceAttachmentId: null, referencePage: null })

    await c.execute(`UPDATE "MaintenanceSchedule" SET referenceAttachmentId = 'd1', referencePage = 3 WHERE id = 'm1'`)
    await c.execute(`PRAGMA foreign_keys = ON`)
    await c.execute(`DELETE FROM "Attachment" WHERE id = 'd1'`)
    expect(await row()).toMatchObject({ referenceAttachmentId: null })
    c.close()
  })

  it("keeps health policies through the insurance migration and links policies to properties and vehicles", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "old.db")
    await createMigratedDb(db, { upTo: "20261024175732_maintenance_manual_reference" })
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    const t = "2026-01-01T00:00:00.000Z"
    await c.executeMultiple(`
      INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('u1', 'Admin', 'admin@example.test', 'hash', 'ADMIN');
      INSERT INTO "Person" (id, name, updatedAt) VALUES ('h1', 'Pat', '${t}');
      INSERT INTO "Property" (id, name, address, updatedAt) VALUES ('p1', 'Main House', '1 Elm St', '${t}');
      INSERT INTO "Vehicle" (id, name, make, model, year, updatedAt) VALUES ('v1', 'Daily Driver', 'Honda', 'Fit', 2015, '${t}');
      INSERT INTO "InsurancePolicy" (id, carrier, kind, updatedAt) VALUES ('i1', 'Delta Dental', 'DENTAL', '${t}');
      INSERT INTO "_InsurancePolicyToPerson" (A, B) VALUES ('i1', 'h1');
      INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, insurancePolicyId) VALUES ('ai1', 'INSURANCE', 'f-ai1.pdf', 'card.pdf', 'application/pdf', 5, 'u1', 'i1');
    `)
    const migrations = path.resolve(__dirname, "../../prisma/migrations")
    const folder = (await readdir(migrations)).find((n) => n.endsWith("_insurance_property_auto_life"))
    expect(folder).toBeDefined()
    await c.executeMultiple(await readFile(path.join(migrations, folder!, "migration.sql"), "utf8"))

    const count = async (sql: string) => Number((await c.execute(sql)).rows[0].n)
    expect((await c.execute(`SELECT kind FROM "InsurancePolicy" WHERE id = 'i1'`)).rows[0].kind).toBe("DENTAL")
    expect(await count(`SELECT COUNT(*) AS n FROM "_InsurancePolicyToPerson" WHERE A = 'i1'`)).toBe(1)
    expect(await count(`SELECT COUNT(*) AS n FROM "Attachment" WHERE id = 'ai1'`)).toBe(1)

    await c.executeMultiple(`
      INSERT INTO "InsurancePolicy" (id, carrier, kind, updatedAt) VALUES ('i2', 'Acme', 'HOME', '${t}');
      INSERT INTO "_InsurancePolicyToProperty" (A, B) VALUES ('i2', 'p1');
      INSERT INTO "_InsurancePolicyToVehicle" (A, B) VALUES ('i2', 'v1');
      INSERT INTO "InsurancePremium" (id, policyId, effectiveDate, amount) VALUES ('pr1', 'i2', '${t}', 1680);
      INSERT INTO "InsuranceCoverage" (id, policyId, label, "limit") VALUES ('c1', 'i2', 'Personal property', 225000);
    `)
    expect((await c.execute(`SELECT period FROM "InsurancePremium" WHERE id = 'pr1'`)).rows[0].period).toBe("ANNUAL")

    await c.execute(`PRAGMA foreign_keys = ON`)
    await c.execute(`DELETE FROM "Property" WHERE id = 'p1'`)
    expect(await count(`SELECT COUNT(*) AS n FROM "_InsurancePolicyToProperty"`)).toBe(0)
    expect(await count(`SELECT COUNT(*) AS n FROM "InsurancePolicy" WHERE id = 'i2'`)).toBe(1)
    expect(await count(`SELECT COUNT(*) AS n FROM "_InsurancePolicyToVehicle" WHERE A = 'i2'`)).toBe(1)
    await c.execute(`DELETE FROM "InsurancePolicy" WHERE id = 'i2'`)
    expect(await count(`SELECT COUNT(*) AS n FROM "InsurancePremium" WHERE policyId = 'i2'`)).toBe(0)
    expect(await count(`SELECT COUNT(*) AS n FROM "InsuranceCoverage" WHERE policyId = 'i2'`)).toBe(0)
    expect(await count(`SELECT COUNT(*) AS n FROM "_InsurancePolicyToVehicle" WHERE A = 'i2'`)).toBe(0)
    c.close()
  })
})
