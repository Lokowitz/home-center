import { describe, expect, it, vi } from "vitest"
import { rm } from "node:fs/promises"
import path from "node:path"
import { createClient } from "@libsql/client"
import { fileUrl } from "./paths"
import { createMigratedDb, seedSample, tempDir } from "./test-support"
import { openDb, releaseDbHandles } from "./snapshot"
import { csvTables, exportPlacement, loadReadable, rawPlacement, toCsv } from "./readable"

// Each case builds a migrated SQLite DB and zips it; under a parallel full run that exceeds the 5s default.
vi.setConfig({ testTimeout: 30_000 })

async function snap() {
  const dir = await tempDir()
  const db = path.join(dir, "x.db")
  await createMigratedDb(db)
  await seedSample(db, path.join(dir, "uploads"))
  return db
}

describe("readable", () => {
  it("rooms: with paints and files, under their property; a property scope keeps only its own", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Property" (id, name, address, updatedAt) VALUES ('p2', 'Cabin', '2 Oak St', '${t}');
        INSERT INTO "Room" (id, propertyId, name, level, area, updatedAt) VALUES ('r1', 'p1', 'Kitchen', 'Main floor', 180, '${t}'), ('r2', 'p2', 'Loft', NULL, NULL, '${t}');
        INSERT INTO "RoomPaint" (id, roomId, surface, brand, colorName, sortOrder) VALUES ('rp1', 'r1', 'Walls', 'Behr', 'Soft Sage', 0);
        INSERT INTO "Equipment" (id, name, category, propertyId, roomId, updatedAt) VALUES ('e9', 'Fridge', 'APPLIANCE', 'p1', 'r1', '${t}');
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, roomId) VALUES
          ('a5', 'ROOM', 'f-a5.jpg', 'kitchen.jpg', 'image/jpeg', 1, 'u1', 'r1'), ('a6', 'ROOM', 'f-a6.jpg', 'loft.jpg', 'image/jpeg', 1, 'u1', 'r2');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const all = await loadReadable(db, { kind: "all", includeHealth: false }, rawPlacement)
    expect(all.data.rooms.map((r) => r.name).sort()).toEqual(["Kitchen", "Loft"])
    const kitchen = all.data.rooms.find((r) => r.id === "r1")!
    expect(kitchen).toMatchObject({ assetId: "p1", assetType: "property", level: "Main floor", area: 180 })
    expect(kitchen.paints).toEqual([{ surface: "Walls", brand: "Behr", colorName: "Soft Sage", colorCode: null, finish: null }])
    expect(kitchen.files[0]).toMatchObject({ name: "kitchen.jpg", path: "../files/room/r1/f-a5.jpg" })
    expect(all.data.assets.find((a) => a.id === "e9")?.details.Location).toBe("Kitchen")
    const one = await loadReadable(db, { kind: "asset", assetType: "PROPERTY", assetId: "p1" }, rawPlacement)
    expect(one.data.rooms.map((r) => r.id)).toEqual(["r1"])
    expect(one.files.map((f) => f.rel)).toContain("room/r1/f-a5.jpg")
    expect(one.files.map((f) => f.rel)).not.toContain("room/r2/f-a6.jpg")
    const csv = csvTables(all.data)
    expect(csv["rooms.csv"]).toContain("Main House,Kitchen,Main floor,180")
    expect(csv["room-paints.csv"]).toContain("Main House,Kitchen,Walls,Behr,Soft Sage")
  })


  it("reminders: manual names the file and page", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, assetType, assetId) VALUES
          ('d1', 'DOCUMENT', 'f-d1.pdf', 'Owner manual.pdf', 'application/pdf', 1, 'u1', 'VEHICLE', 'v1');
        INSERT INTO "MaintenanceSchedule" (id, assetId, assetType, title, referenceAttachmentId, referencePage, updatedAt) VALUES
          ('m1', 'v1', 'VEHICLE', 'Oil', 'd1', 42, '${t}'),
          ('m2', 'v1', 'VEHICLE', 'Tires', 'd1', NULL, '${t}'),
          ('m3', 'v1', 'VEHICLE', 'Wipers', NULL, NULL, '${t}');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data } = await loadReadable(db, { kind: "all", includeHealth: false }, rawPlacement)
    const manual = (title: string) => data.reminders.find((r) => r.title === title)!.manual
    expect(manual("Oil")).toBe("Owner manual.pdf, p. 42")
    expect(manual("Tires")).toBe("Owner manual.pdf")
    expect(manual("Wipers")).toBeNull()
    expect(csvTables(data)["reminders.csv"].split("\n")[0]).toContain("estimatedCost,manual,")
  })

  it("equipment details: counts as, expected life, replacement cost", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Equipment" (id, name, category, valueClass, expectedLifeYears, replacementCost, propertyId, updatedAt) VALUES
          ('e7', 'Gas Furnace', 'HVAC', NULL, 18, 5200, 'p1', '${t}'),
          ('e8', 'Built-in Oven', 'APPLIANCE', 'FIXTURE', NULL, NULL, 'p1', '${t}'),
          ('e6', 'Chest Freezer', 'APPLIANCE', NULL, NULL, NULL, 'p1', '${t}');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data } = await loadReadable(db, { kind: "all", includeHealth: false }, rawPlacement)
    const details = (id: string) => data.assets.find((a) => a.id === id)!.details
    expect(details("e7")).toMatchObject({ "Counts as": "Part of the home", "Expected life (years)": 18, "Replacement cost": 5200 })
    expect(details("e8")).toMatchObject({ "Counts as": "Part of the home", "Expected life (years)": null, "Replacement cost": null })
    expect(details("e6")).toMatchObject({ "Counts as": "Belongings" })
  })

  it("everything: assets, records with file links, health", async () => {
    const { data, files } = await loadReadable(await snap(), { kind: "all", includeHealth: true }, rawPlacement)
    expect(data.assets.map((a) => a.name).sort()).toEqual(["Daily Driver", "Main House", "Pat"])
    const oil = data.serviceRecords.find((r) => r.title === "Oil change")!
    expect(oil).toMatchObject({ assetId: "v1", cost: 49.5 })
    expect(oil.files[0]).toMatchObject({ name: "receipt.pdf", path: "../files/service/s1/f-a1.pdf" })
    expect(data.health?.medications.map((m) => m.name)).toEqual(["Ibuprofen"])
    expect(files.map((f) => f.rel).sort()).toEqual(["properties/p1/img-p1.jpg", "service/s1/f-a1.pdf", "service/s2/f-a2.pdf"])
  })

  it("labels square footage with the household area unit; the number stays raw", async () => {
    const db = await snap()
    const before = await loadReadable(db, { kind: "all", includeHealth: false }, rawPlacement)
    expect(before.regional).toEqual({ currency: "USD", areaUnit: "SQFT" })
    const house = before.data.assets.find((a) => a.name === "Main House")!
    const sqFt = house.details["Square feet"]
    const c = createClient({ url: fileUrl(db) })
    await c.execute(`INSERT INTO "RegionalSettings" ("id","currency","distanceUnit","areaUnit","dateFormat","hour12","updatedAt") VALUES ('singleton','EUR','KM','SQM','ISO',0,0)`)
    c.close()
    const after = await loadReadable(db, { kind: "all", includeHealth: false }, rawPlacement)
    expect(after.regional).toEqual({ currency: "EUR", areaUnit: "SQM" })
    const h = after.data.assets.find((a) => a.name === "Main House")!
    expect(h.details["Square feet"]).toBeUndefined()
    expect(h.details["Square metres"]).toBe(sqFt)
  })

  it("excluding health drops people, their records and their files", async () => {
    const { data, files } = await loadReadable(await snap(), { kind: "all", includeHealth: false }, rawPlacement)
    expect(data.assets.some((a) => a.type === "person")).toBe(false)
    expect(data.serviceRecords.map((r) => r.title)).toEqual(["Oil change"])
    expect(data.health).toBeNull()
    expect(files.map((f) => f.rel)).not.toContain("service/s2/f-a2.pdf")
  })

  it("one asset", async () => {
    const { data } = await loadReadable(await snap(), { kind: "asset", assetType: "VEHICLE", assetId: "v1" }, rawPlacement)
    expect(data.assets.map((a) => a.id)).toEqual(["v1"])
    expect(data.serviceRecords).toHaveLength(1)
  })

  const asset = (name: string) => ({ id: "v1", type: "vehicle" as const, name, details: {}, photo: null, propertyId: null })

  it("export paths are flattened and never escape", () => {
    const place = exportPlacement()
    const a = asset("../../Daily/Driver")
    const first = place({ rel: "x", asset: a, section: "service", originalName: "../../etc/passwd" })
    expect(first).toBe("files/Vehicles/_._Daily_Driver/service/_._etc_passwd")
    expect(place({ rel: "y", asset: a, section: "service", originalName: "../../etc/passwd" })).toBe(`${first} (2)`)
    expect(place({ rel: "z", asset: null, section: "insurance", originalName: "CON" })).toBe("files/Other/insurance/_CON")
  })

  it("odd asset names stay inside files/ with safe segments", () => {
    const place = exportPlacement()
    const names = ["../../x", "CON", "", "a".repeat(500), "🚗".repeat(200), "  ..hidden. ", 'a:b*c?d"e<f>g|h', "nul.txt", "x\u0000y\tz", "COM1", "lpt9.log", "CON .txt", "con  ", "Prn. "]
    for (const [i, name] of names.entries()) {
      for (const originalName of ["ok.pdf", "..", "", "AUX.pdf", "b".repeat(400) + ".pdf", "\\server\\share"]) {
        const p = place({ rel: `r${i}`, asset: asset(name), section: "service", originalName })
        expect(p.startsWith("files/Vehicles/")).toBe(true)
        const segs = p.split("/")
        expect(segs).toHaveLength(5)
        for (const seg of segs) {
          expect(seg).not.toBe("")
          expect(seg).not.toMatch(/[\\:*?"<>|\u0000-\u001f]/)
          expect(seg).not.toMatch(/\.\./)
          expect(seg).not.toMatch(/[. ]$/)
          expect(seg).not.toMatch(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i)
          expect(Buffer.byteLength(seg)).toBeLessThanOrEqual(150)
        }
        expect(segs[2]).not.toMatch(/^\./)
        expect(segs[4]).not.toMatch(/^\./)
      }
    }
    expect(place({ rel: "e", asset: asset(""), section: "service", originalName: "k.pdf" })).toBe("files/Vehicles/_/service/k.pdf")
  })

  it("numbers duplicate file names, keeping the extension, ignoring case", () => {
    const place = exportPlacement()
    const a = asset("Car")
    const f = (rel: string, originalName: string) => place({ rel, asset: a, section: "service", originalName })
    expect(f("1", "receipt.pdf")).toBe("files/Vehicles/Car/service/receipt.pdf")
    expect(f("2", "receipt.pdf")).toBe("files/Vehicles/Car/service/receipt (2).pdf")
    expect(f("3", "RECEIPT.PDF")).toBe("files/Vehicles/Car/service/RECEIPT (3).PDF")
    expect(f("4", "receipt (2).pdf")).toBe("files/Vehicles/Car/service/receipt (2) (2).pdf")
  })

  it("rawPlacement paths from unsafe DB values are skipped, not planned", async () => {
    const db = await snap()
    const c = openDb(db)
    try {
      await c.execute(`UPDATE "Attachment" SET filename = '../../outside.pdf' WHERE id = 'a1'`)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data, files } = await loadReadable(db, { kind: "all", includeHealth: true }, rawPlacement)
    expect(files.map((f) => f.rel)).not.toContain("service/s1/../../outside.pdf")
    expect(files.every((f) => !f.archivePath.includes(".."))).toBe(true)
    expect(data.serviceRecords.find((r) => r.id === "s1")!.files).toEqual([])
  })

  it("loadReadable releases the snapshot so it can be deleted right away", async () => {
    const db = await snap()
    await loadReadable(db, { kind: "all", includeHealth: true }, rawPlacement)
    await rm(db) // EBUSY on Windows if the handle were still held
  })

  it("odd reserved names with spaces or dots are caught", () => {
    const place = exportPlacement()
    expect(place({ rel: "a", asset: asset("CON ."), section: "s", originalName: "con .txt" })).toBe("files/Vehicles/_CON/s/_con.txt")
    expect(place({ rel: "b", asset: asset("con  "), section: "s", originalName: "x" })).toBe("files/Vehicles/_con/s/x")
  })

  it("property scope includes its equipment, their records and files, and nothing out of scope", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Equipment" (id, name, propertyId, updatedAt) VALUES ('e1', 'Furnace', 'p1', '${t}'), ('e2', 'Loose Mower', NULL, '${t}');
        INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('u2', 'Other', 'o@example.test', 'h', 'ADMIN');
        INSERT INTO "ServiceRecord" (id, assetId, assetType, date, title, createdById, updatedAt) VALUES
          ('s3', 'e1', 'EQUIPMENT', '${t}', 'Filter', 'u2', '${t}'), ('s4', 'e2', 'EQUIPMENT', '${t}', 'Blade', 'u2', '${t}');
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, serviceRecordId) VALUES
          ('a3', 'SERVICE', 'f-a3.pdf', 'filter.pdf', 'application/pdf', 1, 'u2', 's3'),
          ('a4', 'SERVICE', 'f-a4.pdf', 'blade.pdf', 'application/pdf', 1, 'u2', 's4');
        INSERT INTO "Warranty" (id, assetId, assetType, productName, updatedAt) VALUES ('w1', 'e1', 'EQUIPMENT', 'Furnace plan', '${t}'), ('w2', 'v1', 'VEHICLE', 'Car plan', '${t}');
        INSERT INTO "MaintenanceSchedule" (id, assetId, assetType, title, dueMonths, dueDay, estimatedCost, updatedAt) VALUES ('m1x', 'e2', 'EQUIPMENT', 'Sharpen', NULL, NULL, NULL, '${t}'), ('m2x', 'e1', 'EQUIPMENT', 'Change filter', '4,10', 1, 120.5, '${t}');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data, files } = await loadReadable(db, { kind: "asset", assetType: "PROPERTY", assetId: "p1" }, rawPlacement)
    expect(data.assets.map((a) => a.id).sort()).toEqual(["e1", "p1"])
    expect(data.serviceRecords.map((r) => r.title)).toEqual(["Filter"])
    expect(data.warranties.map((w) => w.id)).toEqual(["w1"])
    expect(data.reminders.map((r) => r.title)).toEqual(["Change filter"])
    expect(data.reminders[0]).toMatchObject({ repeats: "Apr, Oct", estimatedCost: 120.5 })
    expect(files.map((f) => f.rel).sort()).toEqual(["properties/p1/img-p1.jpg", "service/s3/f-a3.pdf"])
    expect(data.health).toBeNull()
  })

  it("person scope gets only that person's health data and files", async () => {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "Person" (id, name, updatedAt) VALUES ('h2', 'Sam', '${t}');
        INSERT INTO "Medication" (id, name, personId, updatedAt) VALUES ('m2', 'Aspirin', 'h2', '${t}');
        INSERT INTO "InsurancePolicy" (id, carrier, updatedAt) VALUES ('i1', 'Pat Mutual', '${t}'), ('i2', 'Sam Mutual', '${t}'), ('i3', 'Nobody Mutual', '${t}');
        INSERT INTO "_InsurancePolicyToPerson" (A, B) VALUES ('i1', 'h1'), ('i2', 'h2');
        INSERT INTO "Provider" (id, name, updatedAt) VALUES ('pr1', 'Dr Who', '${t}');
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, insurancePolicyId) VALUES
          ('ai1', 'INSURANCE', 'card1.pdf', 'pat-card.pdf', 'application/pdf', 1, 'u1', 'i1'),
          ('ai2', 'INSURANCE', 'card2.pdf', 'sam-card.pdf', 'application/pdf', 1, 'u1', 'i2');
        INSERT INTO "Warranty" (id, assetId, assetType, productName, updatedAt) VALUES ('w2', 'v1', 'VEHICLE', 'Car plan', '${t}');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    const { data, files } = await loadReadable(db, { kind: "asset", assetType: "PERSON", assetId: "h1" }, rawPlacement)
    expect(data.assets.map((a) => a.id)).toEqual(["h1"])
    expect(data.health!.medications.map((m) => m.name)).toEqual(["Ibuprofen"])
    expect(data.health!.insurance.map((p) => p.carrier)).toEqual(["Pat Mutual"])
    expect(data.health!.providers).toEqual([])
    expect(data.warranties).toEqual([])
    expect(files.map((f) => f.rel).sort()).toEqual(["insurance/i1/card1.pdf", "service/s2/f-a2.pdf"])
  })

  it("csv quotes, escapes and starts with a BOM", () => {
    const csv = toCsv([{ a: 'say "hi"', b: "x,y", c: null }], ["a", "b", "c"])
    expect(csv).toBe('\uFEFFa,b,c\r\n"say ""hi""","x,y",\r\n')
  })

  it("csv quotes embedded newlines and neutralises formulas", () => {
    const row = { a: "line1\nline2", b: "=SUM(A1)", c: "+1", d: "-2x", e: "@cmd", f: "\tx", g: "\rx", h: -5, i: "ok=fine", j: '="q",z' }
    const csv = toCsv([row], ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])
    expect(csv).toBe("\uFEFFa,b,c,d,e,f,g,h,i,j\r\n" + [`"line1\nline2"`, "'=SUM(A1)", "'+1", "'-2x", "'@cmd", "'\tx", `"'\rx"`, "-5", "ok=fine", `"'=""q"",z"`].join(",") + "\r\n")
  })

  async function snapWithPolicies() {
    const db = await snap()
    const t = "2026-01-01T00:00:00.000Z"
    const c = createClient({ url: fileUrl(db) })
    try {
      await c.executeMultiple(`
        INSERT INTO "InsurancePolicy" (id, carrier, kind, updatedAt) VALUES ('i1', 'Acme Mutual', 'HOME', '${t}'), ('i2', 'Blue Cross', 'MEDICAL', '${t}'), ('i3', 'Lifeco', 'LIFE', '${t}');
        INSERT INTO "_InsurancePolicyToProperty" (A, B) VALUES ('i1', 'p1');
        INSERT INTO "_InsurancePolicyToVehicle" (A, B) VALUES ('i1', 'v1');
        INSERT INTO "_InsurancePolicyToPerson" (A, B) VALUES ('i3', 'h1'), ('i2', 'h1');
        INSERT INTO "InsurancePremium" (id, policyId, effectiveDate, amount, period) VALUES
          ('pr1', 'i1', '2023-11-01T00:00:00.000Z', 1500, 'ANNUAL'), ('pr2', 'i1', '2024-11-01T00:00:00.000Z', 140, 'MONTHLY');
        INSERT INTO "InsuranceCoverage" (id, policyId, label, "limit", sortOrder) VALUES ('c1', 'i1', 'Personal property', 225000, 0);
        INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, insurancePolicyId) VALUES
          ('ai1', 'INSURANCE', 'dec.pdf', 'dec.pdf', 'application/pdf', 1, 'u1', 'i1');
      `)
    } finally {
      c.close()
    }
    await releaseDbHandles()
    return db
  }

  it("insurance: non-health policies export without health, with premiums, coverages and what they cover", async () => {
    const db = await snapWithPolicies()
    const { data, files } = await loadReadable(db, { kind: "all", includeHealth: false }, rawPlacement)
    expect(data.insurance.map((p) => p.carrier)).toEqual(["Acme Mutual", "Lifeco"])
    expect(data.health).toBeNull()
    const acme = data.insurance[0]
    expect(acme).toMatchObject({ propertyIds: ["p1"], vehicleIds: ["v1"], personIds: [], annualPremium: 1680 })
    expect(acme.premiums.map((p) => p.annual)).toEqual([1680, 1500])
    expect(acme.coverages).toEqual([{ id: expect.any(String), policyId: "i1", label: "Personal property", limit: 225000, deductible: null }])
    expect(acme.files[0].name).toBe("dec.pdf")
    expect(data.insurance[1].personIds).toEqual([])
    expect(files.map((f) => f.rel)).toContain("insurance/i1/dec.pdf")
    const csv = csvTables(data)
    expect(Object.keys(csv)).toEqual(expect.arrayContaining(["insurance.csv", "insurance-premiums.csv", "insurance-coverages.csv"]))
    expect(csv["insurance.csv"].startsWith("\uFEFFpeople,covers,carrier,plan,kind,")).toBe(true)
    expect(csv["insurance.csv"]).toContain("Main House; Daily Driver")
  })

  it("insurance: health kinds stay under health", async () => {
    const db = await snapWithPolicies()
    const { data } = await loadReadable(db, { kind: "all", includeHealth: true }, rawPlacement)
    expect(data.health!.insurance.map((p) => p.carrier)).toEqual(["Blue Cross"])
    expect(data.insurance.find((p) => p.carrier === "Lifeco")!.personIds).toEqual(["h1"])
  })

  it("insurance: one vehicle's export carries the policies that cover it", async () => {
    const db = await snapWithPolicies()
    const { data } = await loadReadable(db, { kind: "asset", assetType: "VEHICLE", assetId: "v1" }, rawPlacement)
    expect(data.insurance.map((p) => p.carrier)).toEqual(["Acme Mutual"])
  })

  it("builds the csv set", async () => {
    const { data } = await loadReadable(await snap(), { kind: "all", includeHealth: true }, rawPlacement)
    expect(Object.keys(csvTables(data)).sort()).toEqual(
      ["allergies.csv", "assets.csv", "conditions.csv", "documents.csv", "immunizations.csv", "insurance-coverages.csv", "insurance-premiums.csv", "insurance.csv", "medications.csv", "observations.csv", "providers.csv", "reminders.csv", "room-paints.csv", "rooms.csv", "service-records.csv", "warranties.csv"])
  })
})
